import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Prisma, TenantTx } from '@dealflow/database';
import { formSubmissionSchema, type LeadFormInput, type LeadFormRow, type PublicFormView, type z, type formFieldSchema } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { hasFeature } from '../billing/entitlements';
import { PrismaService } from '../common/prisma.service';
import { assertCampaign, assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';

type Field = z.infer<typeof formFieldSchema>;
const MAX_PER_IP_PER_10_MIN = 5;
const formGone = () => new NotFoundException({ code: 'NOT_FOUND', message: 'This form is not available.' });

/**
 * Hosted lead-capture forms. The public page posts to an unauthenticated endpoint that finds the form by
 * its token, validates exactly the fields the form asks for, records the submission (with the consent
 * text the person saw) and creates or updates a lead in the form's workspace.
 */
@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  list(auth: AuthContext): Promise<LeadFormRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.leadForm.findMany({ where: { tenantId: auth.tenantId }, include: { campaign: { select: { id: true, name: true } }, _count: { select: { submissions: true } } }, orderBy: { createdAt: 'desc' } });
      const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return rows.map((r) => toRow(r, names));
    });
  }

  save(auth: AuthContext, id: string | null, input: LeadFormInput, meta: RequestMeta): Promise<LeadFormRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId });
      await assertCampaign(tx, auth.tenantId, input.campaignId);
      const data = { ...input, ownerId, campaignId: input.campaignId ?? null, fields: input.fields as unknown as Prisma.InputJsonValue };
      let formId = id;
      if (id) {
        const { count } = await tx.leadForm.updateMany({ where: { id, tenantId: auth.tenantId }, data });
        if (!count) throw notFound('Form');
      } else formId = (await tx.leadForm.create({ data: { ...data, tenantId: auth.tenantId, publicToken: randomBytes(18).toString('base64url') } })).id;
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'form.updated' : 'form.created', entityType: 'lead_form', entityId: formId!, metadata: { name: input.name, active: input.active }, meta });
      const row = await tx.leadForm.findFirstOrThrow({ where: { id: formId! }, include: { campaign: { select: { id: true, name: true } }, _count: { select: { submissions: true } } } });
      return toRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  submissions(auth: AuthContext, id: string) {
    return this.prisma.run(auth, async (tx) => {
      const form = await tx.leadForm.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!form) throw notFound('Form');
      const rows = await tx.formSubmission.findMany({ where: { formId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
      return rows.map((r) => ({ id: r.id, leadId: r.leadId, data: r.data as Record<string, unknown>, consent: r.consent, createdAt: r.createdAt.toISOString() }));
    });
  }

  async publicView(token: string): Promise<PublicFormView> {
    const { tenantId } = await this.resolve(token);
    return this.prisma.run({ tenantId }, async (tx) => {
      const f = await tx.leadForm.findFirst({ where: { publicToken: token, active: true } });
      if (!f) throw formGone();
      return { title: f.title, intro: f.intro, fields: f.fields as unknown as Field[], consentText: f.consentText };
    });
  }

  async submit(token: string, body: unknown, ip: string | null): Promise<{ message: string }> {
    const { tenantId } = await this.resolve(token);
    return this.prisma.run({ tenantId }, async (tx) => {
      const form = await tx.leadForm.findFirst({ where: { publicToken: token, active: true }, include: { campaign: true } });
      if (!form) throw formGone();
      const parsed = formSubmissionSchema(form.fields as unknown as Field[]).safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Please check the highlighted fields.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      }
      const data = parsed.data as Record<string, string | boolean | undefined>;
      const ipHash = ip ? createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(`form-ip:${ip}`).digest('hex') : null;
      if (ipHash) {
        const recent = await tx.formSubmission.count({ where: { tenantId, ipHash, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } });
        if (recent >= MAX_PER_IP_PER_10_MIN) throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      // Consent counts only if the form showed consent text and the person ticked it.
      const consent = !!form.consentText && data.consent === true;
      const leadId = await this.upsertLead(tx, form, data, consent);
      const { consent: _c, website: _w, ...fields } = data;
      await tx.formSubmission.create({
        data: { tenantId, formId: form.id, leadId, data: { ...fields, consentText: consent ? form.consentText : null } as Prisma.InputJsonValue, consent, ipHash },
      });
      return { message: form.successMessage };
    });
  }

  /**
   * Creates a lead, or attaches the submission to an open lead with the same email so repeat visitors do
   * not create duplicates. A message becomes a note on the lead. Workflows and auto-qualification see the
   * normal `lead.created` event.
   */
  private async upsertLead(tx: TenantTx, form: Prisma.LeadFormGetPayload<{ include: { campaign: true } }>, d: Record<string, string | boolean | undefined>, consent: boolean): Promise<string> {
    const tenantId = form.tenantId;
    const str = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null);
    const email = str('email');
    const consentData = consent ? { marketingConsent: 'OPTED_IN' as const, consentSource: `form:${form.name}`, consentUpdatedAt: new Date() } : {};
    const owner = await tx.membership.findFirst({ where: { tenantId, userId: form.ownerId, status: 'ACTIVE' }, select: { userId: true } });
    const existing = email ? await tx.lead.findFirst({ where: { tenantId, email: { equals: email, mode: 'insensitive' }, deletedAt: null, status: { not: 'CONVERTED' } } }) : null;
    let leadId: string;
    if (existing) {
      await tx.lead.update({ where: { id: existing.id }, data: { ...consentData, ...(existing.campaignId ? {} : { campaignId: form.campaignId }) } });
      leadId = existing.id;
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'lead.form_submitted', entityType: 'lead', entityId: leadId, metadata: { formId: form.id, consent } });
    } else {
      const lead = await tx.lead.create({
        data: {
          tenantId, fullName: str('fullName') ?? 'Unknown', email, phone: str('phone'), companyName: str('companyName'), jobTitle: str('jobTitle'), country: str('country'),
          source: form.source, campaignId: form.campaignId, campaignSource: form.campaign?.utmCampaign ?? null, ownerId: owner?.userId ?? null, ...consentData,
        },
      });
      leadId = lead.id;
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'lead.created', entityType: 'lead', entityId: leadId, metadata: { source: form.source, formId: form.id, consent } });
    }
    const message = str('message');
    if (message) await tx.activity.create({ data: { tenantId, type: 'NOTE', subject: `Message from form “${form.name}”`, body: message, leadId, ownerId: owner?.userId ?? null } });
    return leadId;
  }

  private async resolve(token: string): Promise<{ tenantId: string }> {
    if (!/^[\w-]{10,64}$/.test(token)) throw formGone();
    const rows = await this.prisma.$queryRaw<{ t: string | null }[]>`SELECT app_form_tenant(${token})::text AS t`;
    const tenantId = rows[0]?.t;
    if (!tenantId) throw formGone();
    // A form whose workspace's plan no longer has lead forms (ADR 0057) reads as gone to the public.
    if (!(await this.prisma.run({ tenantId }, (tx) => hasFeature(tx, tenantId, 'marketing')))) throw formGone();
    return { tenantId };
  }
}

function toRow(r: Prisma.LeadFormGetPayload<{ include: { campaign: { select: { id: true; name: true } }; _count: { select: { submissions: true } } } }>, names: Map<string, { id: string; name: string }>): LeadFormRow {
  return {
    id: r.id, name: r.name, publicToken: r.publicToken, title: r.title, intro: r.intro, fields: r.fields as unknown as Field[], consentText: r.consentText,
    successMessage: r.successMessage, source: r.source, campaign: r.campaign, owner: names.get(r.ownerId) ?? null, active: r.active, submissions: r._count.submissions, createdAt: r.createdAt.toISOString(),
  };
}
