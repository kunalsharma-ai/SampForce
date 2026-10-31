import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { EmailTemplate, TenantTx } from '@dealflow/database';
import { renderMerge, type EmailTemplateInput, type EmailTemplateRow, type SequenceStep, type TemplatePreview } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { loadPerson, senderValues } from './people';

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

  list(auth: AuthContext): Promise<EmailTemplateRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.emailTemplate.findMany({
        where: { tenantId: auth.tenantId, OR: [{ shared: true }, { ownerId: auth.userId }] },
        orderBy: [{ shared: 'desc' }, { name: 'asc' }],
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
      const t = await tx.emailTemplate.create({ data: { ...input, tenantId: auth.tenantId, ownerId: auth.userId } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.created', entityType: 'email_template', entityId: t.id, metadata: { name: t.name, shared: t.shared }, meta });
      return (await this.rows(tx, auth.tenantId, [t]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: EmailTemplateInput, meta: RequestMeta): Promise<EmailTemplateRow> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.editable(tx, auth, id);
      if (input.shared !== t.shared) this.assertCanShare(auth);
      const updated = await tx.emailTemplate.update({ where: { id: t.id }, data: input });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.updated', entityType: 'email_template', entityId: t.id, metadata: { name: updated.name, shared: updated.shared }, meta });
      return (await this.rows(tx, auth.tenantId, [updated]))[0]!;
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.editable(tx, auth, id);
      const users = (await this.usage(tx, auth.tenantId)).get(t.id) ?? 0;
      if (users > 0) throw new ConflictException({ code: 'TEMPLATE_IN_USE', message: `This template is used by ${users} sequence${users === 1 ? '' : 's'}. Change those steps first.` });
      await tx.emailTemplate.delete({ where: { id: t.id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'email_template.deleted', entityType: 'email_template', entityId: t.id, metadata: { name: t.name }, meta });
    });
  }

  /** Renders a subject and body for a real lead or contact (or with blanks), using the caller as sender. */
  preview(auth: AuthContext, input: { subject: string; body: string; leadId?: string; contactId?: string }): Promise<TemplatePreview> {
    return this.prisma.run(auth, async (tx) => {
      const person = await loadPerson(tx, auth.tenantId, input);
      if ((input.leadId || input.contactId) && !person) throw notFound(input.leadId ? 'Lead' : 'Contact');
      const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
      const mailbox = await tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'CONNECTED' }, select: { accountEmail: true } });
      const values = { ...(person?.values ?? {}), ...senderValues(user, mailbox?.accountEmail) };
      const subject = renderMerge(input.subject, values);
      const body = renderMerge(input.body, values);
      return {
        subject: subject.text,
        body: body.text,
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
    const usage = await this.usage(tx, tenantId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      body: r.body,
      shared: r.shared,
      owner: r.ownerId ? (names.get(r.ownerId) ?? null) : null,
      usedBy: usage.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
