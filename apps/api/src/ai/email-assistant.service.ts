import { BadRequestException, ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  type EmailAnalysis,
  type EmailDraft,
  type EmailDraftRequest,
  type EmailRewrite,
  type EmailRewriteRequest,
  type EmailSubjects,
  EMAIL_INTENTS,
  EMAIL_NEXT_ACTIONS,
  MERGE_FIELD_KEYS,
  mergeTags,
  z,
} from '@dealflow/types';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { AgentOutputError, AgentsService } from './agents.service';
import { PROMPTS } from './prompts';
import { PermissionDenied, RecordContextBuilder, type RecordType } from './record-context';
import { untrusted } from './redact';

const draftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  subjectAlternatives: z.array(z.string().max(200)).max(5),
  basedOn: z.array(z.string().max(300)).max(20),
  checkBeforeSending: z.array(z.string().max(300)).max(20),
});
const rewriteSchema = z.object({ subject: z.string().max(200), body: z.string().min(1).max(20_000), changes: z.array(z.string().max(300)).max(15) });
const subjectsSchema = z.object({ subjects: z.array(z.object({ text: z.string().min(1).max(200), why: z.string().max(300) })).min(1).max(8) });
const analysisSchema = z.object({
  summary: z.string().min(1).max(2000),
  intent: z.enum(EMAIL_INTENTS),
  confidence: z.enum(['high', 'medium', 'low']),
  objections: z.array(z.string().max(300)).max(10),
  buyingSignals: z.array(z.string().max(300)).max(10),
  nextAction: z.enum(EMAIL_NEXT_ACTIONS),
  followUpInDays: z.number().int().min(0).max(365).nullable(),
  reason: z.string().max(500),
  suggestedReply: z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(10_000) }).nullable(),
});

const LENGTH_HINT = { short: 'under 90 words', medium: '90 to 160 words', long: '160 to 250 words' } as const;
const unusable = (message: string) => new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message });
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));

/**
 * Enhancement feature 5: the Email Assistant. It drafts, rewrites and reads email on top of the existing AI
 * gateway, run log and recommendation store. It never sends: every result goes into an editor the person reviews,
 * and sending still goes through the normal send path with its own checks.
 */
@Injectable()
export class EmailAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly records: RecordContextBuilder,
  ) {}

  async draft(auth: AuthContext, req: EmailDraftRequest, meta: RequestMeta): Promise<EmailDraft & { runId: string }> {
    const received = req.emailId ? await this.loadEmail(auth, req.emailId) : null;
    if (req.mode === 'reply' && received?.direction !== 'INBOUND') throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Pick an email you received to reply to.' });
    const target = this.targetOf(req, received);
    const record = target ? await this.facts(auth, target.type, target.id) : null;
    const sender = await this.sender(auth);
    const availableTags = req.asTemplate ? await this.availableTags(auth) : [];
    let runId = '';
    const out = await this.agents.withRun(auth, 'email_assistant', target?.type ?? null, target?.id ?? null, { op: 'draft', mode: req.mode, tone: req.tone, asTemplate: req.asTemplate }, undefined, async (run) => {
      runId = run.id;
      const draft = await this.call(auth, run, 'emailDraft', draftSchema, {
        mode: req.mode,
        objective: req.objective || null,
        tone: req.tone,
        length: LENGTH_HINT[req.length],
        asTemplate: req.asTemplate,
        availableTags: req.asTemplate ? availableTags : undefined,
        sender,
        recipient: record,
        receivedEmail: received && { from: received.fromAddress, subject: received.subject, sentAt: received.sentAt.toISOString(), body: untrusted('email', (received.bodyText ?? received.snippet ?? '').slice(0, 6000)) },
      });
      const used = [...new Set([...mergeTags(draft.subject), ...mergeTags(draft.body)])];
      const check = [...draft.checkBeforeSending];
      if (req.asTemplate) {
        const unknown = used.filter((t) => !availableTags.includes(t));
        if (unknown.length) throw unusable(`The draft used merge fields that do not exist (${unknown.map((t) => `{{${t}}}`).join(', ')}). Try again.`);
      } else if (used.length) {
        check.push(`The draft contains merge fields (${used.map((t) => `{{${t}}}`).join(', ')}); replace them with real details before sending.`);
      }
      const result: EmailDraft = { ...draft, checkBeforeSending: check, mergeTags: used };
      if (target) await this.agents.saveRec(auth, run.id, 'email_assistant', 'email_draft', target.type, target.id, result, PROMPTS.emailDraft.version, meta);
      return { output: result, rec: result };
    });
    return { ...out, runId };
  }

  async rewrite(auth: AuthContext, req: EmailRewriteRequest): Promise<EmailRewrite & { runId: string }> {
    let runId = '';
    const tags = [...new Set([...mergeTags(req.subject), ...mergeTags(req.body)])];
    const out = await this.agents.withRun(auth, 'email_assistant', null, null, { op: 'rewrite', action: req.action, tone: req.tone ?? null, length: req.body.length }, undefined, async (run) => {
      runId = run.id;
      const r = await this.call(auth, run, 'emailRewrite', rewriteSchema, { action: req.action, tone: req.tone ?? null, subject: req.subject ? untrusted('email', req.subject) : '', body: untrusted('email', req.body) });
      const subject = req.subject ? r.subject || req.subject : '';
      const after = [...new Set([...mergeTags(subject), ...mergeTags(r.body)])];
      // Merge fields are how a template personalises; a rewrite that drops or invents one would send the wrong thing.
      if (!sameTags(tags, after)) throw unusable('The rewrite changed the merge fields, so it was not used. Try again.');
      const result: EmailRewrite = { subject, body: r.body, changes: r.changes };
      return { output: result, rec: result };
    });
    return { ...out, runId };
  }

  async subjects(auth: AuthContext, body: string, current: string): Promise<EmailSubjects & { runId: string }> {
    let runId = '';
    const known = mergeTags(body);
    const out = await this.agents.withRun(auth, 'email_assistant', null, null, { op: 'subjects', length: body.length }, undefined, async (run) => {
      runId = run.id;
      const r = await this.call(auth, run, 'emailSubjects', subjectsSchema, { current: current || null, body: untrusted('email', body) });
      // Keep subjects short and only with merge fields the email already uses.
      const subjects = r.subjects.filter((s) => s.text.length <= 120 && mergeTags(s.text).every((t) => known.includes(t) || (MERGE_FIELD_KEYS as string[]).includes(t))).slice(0, 5);
      if (!subjects.length) throw unusable('The AI did not suggest usable subject lines. Try again.');
      return { output: { subjects }, rec: { subjects } };
    });
    return { ...out, runId };
  }

  async analyse(auth: AuthContext, emailId: string, meta: RequestMeta): Promise<EmailAnalysis & { runId: string }> {
    const email = await this.loadEmail(auth, emailId);
    if (email.direction !== 'INBOUND') throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Only emails you received can be read for intent.' });
    const thread = await this.prisma.run(auth, (tx) =>
      tx.emailMessage.findMany({
        where: {
          tenantId: auth.tenantId,
          id: { not: email.id },
          sentAt: { lte: email.sentAt },
          OR: [
            ...(email.threadId ? [{ threadId: email.threadId, connectionId: email.connectionId }] : []),
            ...(email.contactId ? [{ contactId: email.contactId }] : []),
            ...(email.leadId ? [{ leadId: email.leadId }] : []),
          ],
        },
        orderBy: { sentAt: 'desc' },
        take: 6,
      }),
    );
    const target = this.targetOf({}, email);
    const record = target ? await this.facts(auth, target.type, target.id) : null;
    let runId = '';
    const out = await this.agents.withRun(auth, 'email_assistant', 'email_message', email.id, { op: 'analyse', emailId: email.id, earlier: thread.length }, undefined, async (run) => {
      runId = run.id;
      const a = await this.call(auth, run, 'emailAnalysis', analysisSchema, {
        sender: { from: email.fromAddress },
        record,
        email: { subject: email.subject, sentAt: email.sentAt.toISOString(), body: untrusted('email', (email.bodyText ?? email.snippet ?? '').slice(0, 8000)) },
        earlier: [...thread].reverse().map((m) => ({ direction: m.direction, subject: m.subject, sentAt: m.sentAt.toISOString(), body: untrusted('email', (m.bodyText ?? m.snippet ?? '').slice(0, 2000)) })),
      });
      // Someone who asked not to be emailed gets no reply draft and a stop, whatever the model wrote.
      const stop = a.intent === 'unsubscribe' || a.intent === 'not_interested';
      const result: EmailAnalysis = {
        ...a,
        emailId: email.id,
        nextAction: stop ? 'stop_outreach' : a.nextAction,
        suggestedReply: a.intent === 'unsubscribe' || a.intent === 'out_of_office' ? null : a.suggestedReply,
        followUpInDays: stop ? null : a.followUpInDays,
        messagesRead: thread.length + 1,
      };
      await this.prisma.run(auth, (tx) => tx.emailMessage.update({ where: { id: email.id }, data: { aiIntent: result.intent, aiAnalysedAt: new Date() } }));
      await this.agents.saveRec(auth, run.id, 'email_assistant', 'email_analysis', 'email_message', email.id, result, PROMPTS.emailAnalysis.version, meta);
      return { output: result, rec: result };
    });
    return { ...out, runId };
  }

  /** The latest analysis of an email, if someone ran one. */
  async latestAnalysis(auth: AuthContext, emailId: string): Promise<EmailAnalysis | null> {
    await this.loadEmail(auth, emailId);
    const rec = await this.prisma.run(auth, (tx) =>
      tx.aiRecommendation.findFirst({ where: { tenantId: auth.tenantId, kind: 'email_analysis', entityType: 'email_message', entityId: emailId }, orderBy: { createdAt: 'desc' } }),
    );
    return (rec?.payload as EmailAnalysis | undefined) ?? null;
  }

  // ───────────── helpers ─────────────

  private async call<T>(auth: AuthContext, run: Parameters<AgentsService['structured']>[1], prompt: 'emailDraft' | 'emailRewrite' | 'emailSubjects' | 'emailAnalysis', schema: z.ZodType<T>, input: unknown): Promise<T> {
    try {
      return await this.agents.structured(auth, run, 'email_assistant', prompt, schema, input);
    } catch (err) {
      throw this.httpError(err);
    }
  }

  private httpError(err: unknown): unknown {
    if (err instanceof AgentOutputError) return new UnprocessableEntityException({ code: 'AI_OUTPUT_UNUSABLE', message: err.message });
    if (err instanceof PermissionDenied) return new ForbiddenException({ code: 'FORBIDDEN', message: err.message });
    return err;
  }

  private loadEmail(auth: AuthContext, id: string) {
    if (!auth.permissions.includes('activities:read')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow reading email (activities:read).' });
    return this.prisma.run(auth, async (tx) => {
      const e = await tx.emailMessage.findFirst({ where: { id, tenantId: auth.tenantId } });
      if (!e) throw notFound('Email');
      return e;
    });
  }

  private targetOf(req: { leadId?: string; contactId?: string; dealId?: string }, email: { contactId: string | null; leadId: string | null } | null): { type: RecordType; id: string } | null {
    if (req.dealId) return { type: 'deal', id: req.dealId };
    const contactId = req.contactId ?? email?.contactId;
    if (contactId) return { type: 'contact', id: contactId };
    const leadId = req.leadId ?? email?.leadId;
    if (leadId) return { type: 'lead', id: leadId };
    return null;
  }

  private async facts(auth: AuthContext, type: RecordType, id: string): Promise<Record<string, unknown>> {
    try {
      return (await this.records.load(auth, type, id, { emails: true })).facts;
    } catch (err) {
      throw this.httpError(err);
    }
  }

  private sender(auth: AuthContext) {
    return this.prisma.run(auth, async (tx) => {
      const [user, tenant] = await Promise.all([
        tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
        tx.tenant.findUnique({ where: { id: auth.tenantId }, select: { name: true } }),
      ]);
      return { name: user?.name ?? null, firstName: user?.name.split(/\s+/)[0] ?? null, company: tenant?.name ?? null };
    });
  }

  private availableTags(auth: AuthContext): Promise<string[]> {
    return this.prisma.run(auth, async (tx) => {
      const [fields, vars] = await Promise.all([
        tx.customField.findMany({ where: { tenantId: auth.tenantId, entity: { in: ['LEAD', 'CONTACT'] } }, select: { key: true } }),
        tx.emailVariable.findMany({ where: { tenantId: auth.tenantId }, select: { key: true } }),
      ]);
      return [...MERGE_FIELD_KEYS, ...new Set(fields.map((f) => `custom.${f.key}`)), ...vars.map((v) => `var.${v.key}`)];
    });
  }
}
