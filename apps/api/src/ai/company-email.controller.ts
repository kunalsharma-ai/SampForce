import { Body, Controller, ForbiddenException, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UnprocessableEntityException } from '@nestjs/common';
import {
  type CompanyEmailDraft,
  type CompanyEmailRequest,
  companyEmailRequestSchema,
  COMPANY_EMAIL_CTA_LABELS,
  COMPANY_EMAIL_PURPOSE_LABELS,
  COMPANY_EMAIL_RECIPIENT_LABELS,
  salesProfileGaps,
  salesProfileSchema,
  z,
} from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { CompaniesService } from '../crm/companies.service';
import { CompanyWorkService } from '../crm/company-work.service';
import { AgentOutputError, AgentsService } from './agents.service';
import { untrusted } from './redact';

const LENGTH_HINT = { short: 'under 90 words', medium: '90 to 160 words', long: '160 to 250 words' } as const;
const PERSONALISATION_HINT = { light: 'light', balanced: 'balanced', deep: 'deep' } as const;

const outputSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  subjectAlternatives: z.array(z.string().max(200)).max(5),
  followUps: z.array(z.object({ waitDays: z.number().int(), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(6000) })).max(5),
  basedOn: z.array(z.string().max(300)).max(20),
  checkBeforeSending: z.array(z.string().max(300)).max(20),
});

/**
 * The AI sales email assistant on the company page (ADR 0077). It writes for the user's own organisation, from the
 * sales profile the Super Workspace keeps in Settings, to the company described by its Business Information. It
 * never sends and never changes the company: the draft goes into an editor and then the normal send path.
 */
@Controller('companies/:id')
export class CompanyEmailController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly work: CompanyWorkService,
    private readonly agents: AgentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ai-email')
  @HttpCode(200)
  @RequirePermissions('companies:read', 'ai:use')
  async draft(@Auth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(companyEmailRequestSchema)) req: CompanyEmailRequest): Promise<CompanyEmailDraft> {
    const c = await this.companies.get(auth, id);
    if (c.restricted) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });

    let recipient: CompanyEmailDraft['recipient'] = null;
    if (req.contactId) {
      // Through the employee list, so the caller's record visibility applies.
      const row = (await this.work.employees(auth, id)).find((e) => e.id === req.contactId);
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
      if (!row.details) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to do that.' });
      const extra = await this.prisma.run(auth, (tx) => tx.contact.findFirst({ where: { tenantId: auth.tenantId, id: row.id }, select: { marketingConsent: true, emailStatus: true } }));
      recipient = {
        contactId: row.id,
        name: row.name,
        jobTitle: row.jobTitle,
        email: row.email,
        optedOut: extra?.marketingConsent === 'OPTED_OUT',
        emailProblem: ['invalid', 'bounced'].includes(extra?.emailStatus ?? ''),
      };
    }

    const { profile, workspaceName, writer, history } = await this.prisma.run(auth, async (tx) => {
      const [tenant, user, acts, lastEmail] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true, salesProfile: true } }),
        tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
        tx.activity.findMany({ where: { tenantId: auth.tenantId, companyId: id, deletedAt: null, ...(recipient ? { contactId: recipient.contactId } : {}) }, orderBy: { occurredAt: 'desc' }, take: 5, select: { subject: true, interaction: true, type: true, occurredAt: true } }),
        recipient
          ? tx.emailMessage.findFirst({ where: { tenantId: auth.tenantId, contactId: recipient.contactId }, orderBy: { sentAt: 'desc' }, select: { subject: true, direction: true, sentAt: true } })
          : Promise.resolve(null),
      ]);
      const parsed = salesProfileSchema.safeParse(tenant.salesProfile ?? {});
      return {
        profile: parsed.success ? parsed.data : salesProfileSchema.parse({}),
        workspaceName: tenant.name,
        writer: user?.name ?? null,
        history: {
          interactions: acts.map((a) => ({ kind: a.interaction ?? a.type, on: a.occurredAt.toISOString().slice(0, 10), subject: untrusted('crm_note', a.subject) })),
          lastEmail: lastEmail && { direction: lastEmail.direction, on: lastEmail.sentAt.toISOString().slice(0, 10), subject: untrusted('email', lastEmail.subject) },
        },
      };
    });
    const senderCompany = profile.companyName || workspaceName;
    const to = recipient?.email ?? (recipient ? null : c.primaryEmail);

    let runId = '';
    const out = await this.agents.withRun(auth, 'email_assistant', 'company', id, { op: 'company_email', purpose: req.purpose, tone: req.tone, followUps: req.followUps, contact: !!recipient }, undefined, async (run) => {
      runId = run.id;
      let d: z.infer<typeof outputSchema>;
      try {
        d = await this.agents.structured(auth, run, 'email_assistant', 'companyEmail', outputSchema, {
          settings: {
            purpose: COMPANY_EMAIL_PURPOSE_LABELS[req.purpose],
            recipientType: COMPANY_EMAIL_RECIPIENT_LABELS[req.recipientType],
            tone: req.tone,
            length: LENGTH_HINT[req.length],
            cta: req.cta === 'none' ? 'none' : COMPANY_EMAIL_CTA_LABELS[req.cta],
            personalisation: PERSONALISATION_HINT[req.personalisation],
            objective: req.objective || null,
            followUps: req.followUps,
          },
          sender: {
            organisation: senderCompany,
            about: profile.about || null,
            services: profile.services,
            valueProposition: profile.valueProposition || null,
            differentiators: profile.differentiators,
            industriesServed: profile.industriesServed,
            website: profile.website || null,
            writer: writer && { name: writer, firstName: writer.split(/\s+/)[0] },
          },
          recipient: recipient ? { name: recipient.name, firstName: recipient.name.split(/\s+/)[0], jobTitle: recipient.jobTitle } : { role: COMPANY_EMAIL_RECIPIENT_LABELS[req.recipientType], name: null },
          company: {
            name: c.name,
            industry: c.industry,
            businessCategory: c.businessCategory,
            description: c.aiSummary ? untrusted('ai_summary', c.aiSummary) : c.overview ? untrusted('website_text', c.overview.slice(0, 2000)) : null,
            specialties: c.specialties ? untrusted('website_text', c.specialties.slice(0, 600)) : null,
            services: c.services.slice(0, 15),
            products: c.products.slice(0, 15),
            industriesServed: c.industriesServed.slice(0, 10),
            city: c.city,
            country: c.country,
            foundedYear: c.foundedYear,
            employees: c.employeeCount,
            companySize: c.companySize,
            certifications: c.certifications.slice(0, 10),
          },
          history,
        });
      } catch (err) {
        if (err instanceof AgentOutputError) throw new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
        throw err;
      }
      const sign = (body: string) => (profile.signature && !body.includes(profile.signature) ? `${body.trimEnd()}\n\n${profile.signature}` : body);
      const result = {
        subject: d.subject,
        body: sign(d.body),
        subjectAlternatives: d.subjectAlternatives.filter((s) => s && s !== d.subject).slice(0, 3),
        followUps: d.followUps.slice(0, req.followUps).map((f) => ({ waitDays: Math.min(14, Math.max(2, f.waitDays)), subject: f.subject, body: sign(f.body) })),
        basedOn: d.basedOn,
        checkBeforeSending: d.checkBeforeSending,
      };
      return { output: result, rec: result };
    });
    return { ...out, recipient, to, sender: { company: senderCompany, gaps: salesProfileGaps(profile) }, runId };
  }
}
