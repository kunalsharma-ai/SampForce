import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, type EmailTemplate, type TenantTx } from '@dealflow/database';
import { designedTemplateBody, emailDesignSchema, emailDesignStrings, mergeTags, renderEmailDesign, renderMerge, type EmailDesign, type EmailTemplateInput, type EmailTemplateRow, type SequenceStep, type TemplatePreview, type EmailVariableInput, type EmailVariableRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { loadPerson, senderValues, undefinedTags, variableValues } from './people';

/**
 * Email templates. Personal templates are visible to their owner only; shared ones to everyone with
 * sequences:read. Sharing, and editing someone else's shared template, needs marketing:manage.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, q: { category?: string; campaignId?: string } = {}): Promise<EmailTemplateRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.emailTemplate.findMany({
        where: {
          tenantId: auth.tenantId,
          OR: [{ shared: true }, { ownerId: auth.userId }],
          ...(q.category ? { category: { equals: q.category, mode: 'insensitive' as const } } : {}),
          ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        },
        orderBy: [{ shared: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<EmailTemplateRow> {
    return this.prisma.run(auth, async (tx) => (await this.rows(tx, auth.tenantId, [await this.visible(tx, auth, id)]))[0]!);
  }

  create(auth: AuthContext, input: EmailTemplateInput, meta: RequestMeta): Promise<EmailTemplateRow> {
    if (input.shared) this.assertCanShare(auth);
    return this.prisma.run(auth, async (tx) => {
      await this.check(tx, auth.tenantId, input);
      const t = await tx.emailTemplate.create({ data: { ...stored(input), tenantId: auth.tenantId, ownerId: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.created', entityType: 'email_template', entityId: t.id, metadata: { name: t.name, shared: t.shared }, meta });
      return (await this.rows(tx, auth.tenantId, [t]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: EmailTemplateInput, meta: RequestMeta): Promise<EmailTemplateRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.editable(tx, auth, id);
      if (input.shared !== t.shared) this.assertCanShare(auth);
      await this.check(tx, auth.tenantId, input);
      const updated = await tx.emailTemplate.update({ where: { id: t.id }, data: stored(input) });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.updated', entityType: 'email_template', entityId: t.id, metadata: { name: updated.name, shared: updated.shared }, meta });
      return (await this.rows(tx, auth.tenantId, [updated]))[0]!;
    });
  }

  /** A personal copy of a template the caller can see, to edit without changing the original. */
  duplicate(auth: AuthContext, id: string, meta: RequestMeta): Promise<EmailTemplateRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.visible(tx, auth, id);
      const copy = await tx.emailTemplate.create({
        data: { tenantId: auth.tenantId, ownerId: auth.userId, name: `${t.name} (copy)`.slice(0, 120), subject: t.subject, body: t.body, design: t.design ?? Prisma.DbNull, category: t.category, campaignId: t.campaignId, shared: false },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.created', entityType: 'email_template', entityId: copy.id, metadata: { name: copy.name, copiedFrom: t.id }, meta });
      return (await this.rows(tx, auth.tenantId, [copy]))[0]!;
    });
  }

  /** Categories in use, for the filter. */
  categories(auth: AuthContext): Promise<string[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.emailTemplate.findMany({ where: { tenantId: auth.tenantId, category: { not: null }, OR: [{ shared: true }, { ownerId: auth.userId }] }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' } });
      return rows.map((r) => r.category!);
    });
  }

  /** Custom fields and variables must exist, and a campaign must belong to the workspace. */
  private async check(tx: TenantTx, tenantId: string, input: EmailTemplateInput): Promise<void> {
    const designed = input.design ? emailDesignStrings(input.design).join('\n') : '';
    const missing = await undefinedTags(tx, tenantId, [...mergeTags(input.subject), ...mergeTags(input.body), ...mergeTags(designed)]);
    if (missing.length) throw new BadRequestException({ code: 'UNKNOWN_MERGE_FIELD', message: `{{${missing[0]}}} does not exist. Add the custom field or email variable first.` });
    if (input.campaignId && !(await tx.campaign.findFirst({ where: { id: input.campaignId, tenantId }, select: { id: true } }))) throw notFound('Campaign');
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.editable(tx, auth, id);
      const users = (await this.usage(tx, auth.tenantId)).get(t.id) ?? 0;
      if (users > 0) throw new ConflictException({ code: 'TEMPLATE_IN_USE', message: users === 1 ? 'This template is used by 1 sequence. Change those steps first.' : `This template is used by ${users} sequences. Change those steps first.` });
      await tx.emailTemplate.delete({ where: { id: t.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.deleted', entityType: 'email_template', entityId: t.id, metadata: { name: t.name }, meta });
    });
  }

  /** Renders a subject and body (and a design as HTML) for a real lead or contact, or with blanks, using the caller as sender. */
  preview(auth: AuthContext, input: { subject: string; body: string; design?: EmailDesign | null; leadId?: string; contactId?: string }): Promise<TemplatePreview> {
    return this.prisma.run(auth, async (tx) => {
      const person = await loadPerson(tx, auth.tenantId, input);
      if ((input.leadId || input.contactId) && !person) throw notFound(input.leadId ? 'Lead' : 'Contact');
      const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
      const mailbox = await tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'CONNECTED' }, select: { accountEmail: true } });
      const values = { ...(await variableValues(tx, auth.tenantId)), ...(person?.values ?? {}), ...senderValues(user, mailbox?.accountEmail) };
      const subject = renderMerge(input.subject, values);
      const body = renderMerge(input.design ? emailDesignStrings(input.design).join('\n') : input.body, values);
      const designed = input.design ? renderEmailDesign(input.design, { merge: (text) => renderMerge(text, values).text }) : null;
      return {
        subject: subject.text,
        body: designed ? designed.text : body.text,
        html: designed?.html ?? null,
        missing: [...new Set([...subject.missing, ...body.missing])],
        recipient: person ? { name: person.name, email: person.email } : null,
      };
    });
  }

  private assertCanShare(auth: AuthContext): void {
    if (!auth.permissions.includes('marketing:manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only people who manage marketing can share templates with the workspace.' });
    }
  }

  private async visible(tx: TenantTx, auth: AuthContext, id: string): Promise<EmailTemplate> {
    const t = await tx.emailTemplate.findFirst({ where: { id, tenantId: auth.tenantId, OR: [{ shared: true }, { ownerId: auth.userId }] } });
    if (!t) throw notFound('Template');
    return t;
  }

  private async editable(tx: TenantTx, auth: AuthContext, id: string): Promise<EmailTemplate> {
    const t = await this.visible(tx, auth, id);
    if (t.ownerId !== auth.userId && !auth.permissions.includes('marketing:manage')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only its owner or someone who manages marketing can change this template.' });
    }
    return t;
  }

  /** Template id → number of sequences whose steps use it. */
  private async usage(tx: TenantTx, tenantId: string): Promise<Map<string, number>> {
    const seqs = await tx.sequence.findMany({ where: { tenantId, status: { not: 'ARCHIVED' } }, select: { steps: true } });
    const counts = new Map<string, number>();
    for (const s of seqs) {
      const ids = new Set((s.steps as unknown as SequenceStep[]).flatMap((st) => (st.type === 'email' && st.templateId ? [st.templateId] : [])));
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  private async rows(tx: TenantTx, tenantId: string, rows: EmailTemplate[]): Promise<EmailTemplateRow[]> {
    const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
    const campaignIds = [...new Set(rows.flatMap((r) => (r.campaignId ? [r.campaignId] : [])))];
    const campaigns = new Map((campaignIds.length ? await tx.campaign.findMany({ where: { tenantId, id: { in: campaignIds } }, select: { id: true, name: true } }) : []).map((c) => [c.id, c]));
    const usage = await this.usage(tx, tenantId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      body: r.body,
      design: storedDesign(r.design),
      shared: r.shared,
      category: r.category,
      campaign: r.campaignId ? (campaigns.get(r.campaignId) ?? null) : null,
      owner: r.ownerId ? (names.get(r.ownerId) ?? null) : null,
      usedBy: usage.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

}

/** What is written for a template: a designed one keeps its blocks and stores their plain-text version as the body. */
function stored(input: EmailTemplateInput) {
  return {
    ...input,
    body: input.design ? designedTemplateBody(input.design) : input.body,
    design: input.design ? (input.design as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  };
}

function storedDesign(raw: Prisma.JsonValue): EmailDesign | null {
  if (!raw) return null;
  const parsed = emailDesignSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Workspace email variables. Everyone who can read sequences sees them; marketing managers change them. */
@Injectable()
export class EmailVariablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<EmailVariableRow[]> {
    return this.prisma.run(auth, async (tx) => (await tx.emailVariable.findMany({ where: { tenantId: auth.tenantId }, orderBy: { key: 'asc' } })).map(toVariableRow));
  }

  upsert(auth: AuthContext, input: EmailVariableInput, meta: RequestMeta): Promise<EmailVariableRow> {
    return this.prisma.run(auth, async (tx) => {
      const count = await tx.emailVariable.count({ where: { tenantId: auth.tenantId } });
      const exists = await tx.emailVariable.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key: input.key } } });
      if (!exists && count >= 50) throw new BadRequestException({ code: 'LIMIT', message: 'A workspace can have up to 50 email variables.' });
      const row = await tx.emailVariable.upsert({
        where: { tenantId_key: { tenantId: auth.tenantId, key: input.key } },
        create: { tenantId: auth.tenantId, key: input.key, label: input.label, value: input.value, updatedById: auth.userId },
        update: { label: input.label, value: input.value, updatedById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: exists ? 'email_variable.updated' : 'email_variable.created', entityType: 'email_variable', entityId: row.id, metadata: { key: row.key }, meta });
      return toVariableRow(row);
    });
  }

  remove(auth: AuthContext, key: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.emailVariable.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key } } });
      if (!row) throw notFound('Variable');
      // Parse the tags rather than substring-match, so {{ var.key }} with spaces counts and var.key_two does not.
      const tag = `var.${key}`;
      const uses = (text: string) => mergeTags(text).includes(tag);
      const templates = await tx.emailTemplate.findMany({ where: { tenantId: auth.tenantId }, select: { subject: true, body: true } });
      const inTemplates = templates.filter((t) => uses(t.subject) || uses(t.body)).length;
      const seqs = await tx.sequence.findMany({ where: { tenantId: auth.tenantId, status: { not: 'ARCHIVED' } }, select: { steps: true } });
      const inSequences = seqs.filter((s) => uses(JSON.stringify(s.steps))).length;
      if (inTemplates + inSequences > 0) throw new ConflictException({ code: 'VARIABLE_IN_USE', message: `{{var.${key}}} is used in ${inTemplates} template(s) and ${inSequences} sequence(s). Remove it there first.` });
      await tx.emailVariable.delete({ where: { id: row.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_variable.deleted', entityType: 'email_variable', entityId: row.id, metadata: { key }, meta });
    });
  }
}

function toVariableRow(r: { id: string; key: string; label: string; value: string; updatedAt: Date }): EmailVariableRow {
  return { id: r.id, key: r.key, label: r.label, value: r.value, updatedAt: r.updatedAt.toISOString() };
}
