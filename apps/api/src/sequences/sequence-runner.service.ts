import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma, type IntegrationConnection, type Sequence, type SequenceEnrollment, type TenantTx } from '@dealflow/database';
import { MERGE_FIELDS, nextSendSlot, pickVariant, renderMerge, type MergeField, type SequenceTestSendInput, type SequenceTestSendResult, type EmailEvent, type EnrollmentStatus, type RuleAction } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { LeadsService } from '../crm/leads.service';
import { TasksService } from '../crm/tasks.service';
import { CommunicationService } from '../integrations/communication.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { parseAddresses, type ProviderEmail } from '../integrations/providers';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { loadPerson, senderValues } from './people';
import { SequencesService, seqRules, seqSettings, seqSteps } from './sequences.service';
import { buildSequenceEmail, TrackingSigner } from './tracking';

const DAY = 86_400_000;
const MINUTE = 60_000;
const MAX_ATTEMPTS = 3;
const SYSTEM_META: RequestMeta = { requestId: 'sequence-worker', ipAddress: null, userAgent: null };

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (sub)?system)/i;
const BOUNCE_SUBJECT = /(undeliver|delivery status notification|delivery has failed|failure notice|returned mail|mail delivery failed|delivery failure|could not be delivered)/i;
const AUTO_REPLY = /^(auto(matic)?[ -]?reply|out of (the )?office|automatische antwort|réponse automatique)/i;

type Live = SequenceEnrollment & { sequence: Sequence };

/**
 * Sends sequence steps, and turns replies, bounces, opens, clicks and unsubscribes into the sequence's
 * rules. Sending happens from the worker loop, inside each sequence's send window and under both the
 * sequence's and the mailbox's daily limits.
 */
@Injectable()
export class SequenceRunner implements OnModuleInit {
  private readonly log = new Logger(SequenceRunner.name);
  readonly signer: TrackingSigner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly communication: CommunicationService,
    private readonly notifications: NotificationsService,
    private readonly tasks: TasksService,
    private readonly leads: LeadsService,
    private readonly sequences: SequencesService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    const secret = env.TRACKING_SECRET ?? createHmac('sha256', env.JWT_ACCESS_SECRET).update('dealflow-tracking-secret').digest('hex');
    this.signer = new TrackingSigner(secret, (env.TRACKING_BASE_URL ?? env.PUBLIC_WEB_URL).replace(/\/+$/, ''));
  }

  onModuleInit(): void {
    this.integrations.onInbound((tx, conn, messages) => this.detectRepliesAndBounces(tx, conn, messages));
  }

  // ───────────── Test sends ─────────────

  /**
   * Sends one step to the caller's own mailbox address, filled in for a chosen lead or contact. Nothing is
   * tracked and no run is created; it counts toward the mailbox's daily limit like any other send.
   */
  async testSend(auth: AuthContext, sequenceId: string, input: SequenceTestSendInput, meta: RequestMeta): Promise<SequenceTestSendResult> {
    const prep = await this.prisma.run(auth, async (tx) => {
      const seq = await this.sequences.findIn(tx, auth.tenantId, sequenceId);
      const step = seqSteps(seq).find((st) => st.id === input.stepId);
      if (!step || step.type !== 'email') throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Save the sequence first, then send a test of one of its emails.' });
      if (input.variant === 'B' && !step.variantB) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This email has no version B.' });
      const version = input.variant === 'B' && step.variantB ? step.variantB : step;
      let subject = version.subject;
      let body = version.body;
      if (version.templateId) {
        const t = await tx.emailTemplate.findFirst({ where: { id: version.templateId, tenantId: auth.tenantId } });
        subject ||= t?.subject ?? '';
        body ||= t?.body ?? '';
      }
      if (!subject || !body) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'This email has no subject or body yet.' });
      const person = await loadPerson(tx, auth.tenantId, input);
      if ((input.leadId || input.contactId) && !person) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'That lead or contact was not found.' });
      const conn = await this.communication.mailboxFor(tx, auth.tenantId, auth.userId);
      if (!conn) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect your Google or Microsoft mailbox in Integrations to send yourself a test.' });
      if ((await this.communication.sentInLastDay(tx, conn.id)) >= this.env.EMAIL_DAILY_SEND_LIMIT) {
        throw new HttpException({ code: 'SEND_LIMIT_REACHED', message: `You have reached the limit of ${this.env.EMAIL_DAILY_SEND_LIMIT} emails per day from DealFlow.` }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
      const values = { ...(person?.values ?? {}), ...senderValues(user, conn.accountEmail) };
      const first = [renderMerge(subject, values), renderMerge(body, values)];
      const missing = [...new Set(first.flatMap((r) => r.missing))] as MergeField[];
      // In a test, show gaps visibly instead of leaving them blank.
      for (const m of missing) values[m] = `[${MERGE_FIELDS[m]} missing]`;
      const index = seqSteps(seq).filter((st) => st.type === 'email').findIndex((st) => st.id === step.id) + 1;
      return { conn, seq, index, missing, subject: renderMerge(subject, values).text, body: renderMerge(body, values).text };
    });
    const version = input.variant === 'B' ? ', version B' : '';
    const footer = `\n\n--\nTest of email ${prep.index}${version} in the sequence "${prep.seq.name}", sent only to you. Opens and clicks are not tracked in tests, and the real email adds an unsubscribe link.`;
    const subject = `[Test] ${prep.subject}`;
    await this.communication.deliver(auth, prep.conn, { to: prep.conn.accountEmail, subject, body: prep.body + footer }, {}, meta, {
      action: 'sequence.test_sent',
      metadata: { sequenceId, stepId: input.stepId, variant: input.variant },
    });
    return { to: prep.conn.accountEmail, subject, missing: prep.missing };
  }

  // ───────────── Sending ─────────────

  async runDue(limit = 25): Promise<number> {
    const due = await claim<{ id: string; tenant_id: string }>(
      this.prisma,
      Prisma.sql`
        UPDATE sequence_enrollments SET next_run_at = now() + interval '10 minutes'
        WHERE id IN (
          SELECT id FROM sequence_enrollments WHERE status = 'ACTIVE' AND next_run_at <= now()
          ORDER BY next_run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id`,
    );
    for (const d of due) {
      try {
        await this.step(d.tenant_id, d.id);
      } catch (err) {
        this.log.error({ err: errorMessage(err), enrollmentId: d.id }, 'sequence step failed');
        await this.prisma.run({ tenantId: d.tenant_id }, (tx) =>
          tx.sequenceEnrollment.update({ where: { id: d.id }, data: { attempts: { increment: 1 }, lastError: errorMessage(err), nextRunAt: new Date(Date.now() + 30 * MINUTE) } }),
        ).catch(() => undefined);
      }
    }
    return due.length;
  }

  private async step(tenantId: string, id: string): Promise<void> {
    const e = await this.prisma.run({ tenantId }, (tx) => tx.sequenceEnrollment.findFirst({ where: { id, tenantId, status: 'ACTIVE' }, include: { sequence: true } }));
    if (!e) return;
    const set = (data: Prisma.SequenceEnrollmentUpdateInput) => this.prisma.run({ tenantId }, (tx) => tx.sequenceEnrollment.update({ where: { id }, data }));
    const finish = (status: EnrollmentStatus, lastError: string | null = null) => set({ status, finishedAt: new Date(), nextRunAt: null, lastError });

    if (e.sequence.status !== 'ACTIVE') return void (await set({ nextRunAt: new Date(Date.now() + 60 * MINUTE) }));
    const steps = seqSteps(e.sequence);
    const step = steps[e.stepIndex];
    if (!step) return void (await finish('COMPLETED'));
    const scheduleFrom = (index: number) => {
      const next = steps[index];
      return next ? { stepIndex: index, nextRunAt: new Date(Date.now() + next.delayDays * DAY + Math.floor(Math.random() * 4 * MINUTE)), attempts: 0, lastError: null } : null;
    };

    if (step.type === 'condition') {
      const hit = await this.prisma.run({ tenantId }, (tx) =>
        tx.sequenceMessage.count({ where: { enrollmentId: id, [step.check === 'replied' ? 'repliedAt' : step.check === 'opened' ? 'openedAt' : 'clickedAt']: { not: null } } }),
      );
      const target = hit > 0 ? step.ifYes : step.ifNo;
      const index = target === 'next' ? e.stepIndex + 1 : target === 'stop' ? -1 : steps.findIndex((s) => s.id === target);
      const next = index >= 0 ? scheduleFrom(index) : null;
      return void (await (next ? set(next) : finish('COMPLETED')));
    }

    const actor = await this.actorFor(tenantId, e.senderId);
    if (!actor) return void (await finish('FAILED', 'The sender is no longer an active member who can use sequences.'));

    if (step.type === 'task') {
      await this.tasks.create(actor, { title: await this.renderTitle(e, step.title), assigneeId: e.senderId, leadId: e.leadId ?? undefined, contactId: e.contactId ?? undefined, dueAt: new Date(Date.now() + DAY).toISOString() }, SYSTEM_META);
      const next = scheduleFrom(e.stepIndex + 1);
      return void (await (next ? set(next) : finish('COMPLETED')));
    }

    // Email step: window, suppression, consent, mailbox and limits, then render and send.
    const settings = seqSettings(e.sequence);
    const slot = nextSendSlot(new Date(), settings);
    if (slot.getTime() > Date.now() + MINUTE) return void (await set({ nextRunAt: slot }));

    const prep = await this.prisma.run({ tenantId }, async (tx) => {
      const suppressed = await tx.emailSuppression.findUnique({ where: { tenantId_email: { tenantId, email: e.email } } });
      if (suppressed) return { kind: 'stop' as const, stop: suppressed.reason === 'UNSUBSCRIBED' ? 'UNSUBSCRIBED' as const : 'STOPPED' as const, why: 'The address is on the do-not-email list.' };
      const person = await loadPerson(tx, tenantId, e);
      if (!person) return { kind: 'stop' as const, stop: 'STOPPED' as const, why: 'The lead or contact was deleted.' };
      if (person.consent === 'OPTED_OUT') return { kind: 'stop' as const, stop: 'UNSUBSCRIBED' as const, why: 'The person opted out of marketing.' };
      const conn = await this.communication.mailboxFor(tx, tenantId, e.senderId);
      if (!conn) return { kind: 'pause' as const, pause: "The sender's mailbox is not connected. Reconnect it in Integrations, then resume." };
      const variant = step.variantB ? pickVariant(id, step.id) : 'A';
      const version = variant === 'B' && step.variantB ? step.variantB : step;
      let subject = version.subject;
      let body = version.body;
      if (version.templateId) {
        const t = await tx.emailTemplate.findFirst({ where: { id: version.templateId, tenantId } });
        if (!t && (!subject || !body)) return { kind: 'pause' as const, pause: 'The template for this step was deleted. Edit the step, then resume.' };
        subject ||= t?.subject ?? '';
        body ||= t?.body ?? '';
      }
      const user = await tx.user.findUnique({ where: { id: e.senderId }, select: { name: true, email: true } });
      const values = { ...person.values, ...senderValues(user, conn.accountEmail) };
      const s = renderMerge(subject, values);
      const b = renderMerge(body, values);
      const missing = [...new Set([...s.missing, ...b.missing])];
      if (missing.length) return { kind: 'pause' as const, pause: `Missing ${missing.join(', ')} with no fallback. Fill it in on the record or add a fallback like {{${missing[0]}|there}}, then resume.` };
      if ((await this.communication.sentInLastDay(tx, conn.id)) >= this.env.EMAIL_DAILY_SEND_LIMIT) return { kind: 'later' as const, later: 60 };
      const sentBySequence = await tx.sequenceMessage.count({ where: { tenantId, senderId: e.senderId, sentAt: { gte: new Date(Date.now() - DAY) }, enrollment: { sequenceId: e.sequenceId } } });
      if (sentBySequence >= settings.dailyLimit) return { kind: 'later' as const, later: 60 };
      const msg = await tx.sequenceMessage.create({ data: { tenantId, enrollmentId: id, stepId: step.id, variant, senderId: e.senderId, toAddress: e.email, subject: s.text.slice(0, 500) } });
      return { kind: 'send' as const, conn, msg, subject: s.text, body: b.text };
    });

    if (prep.kind === 'stop') return void (await finish(prep.stop, prep.why));
    if (prep.kind === 'pause') return void (await this.pause(e, prep.pause));
    if (prep.kind === 'later') return void (await set({ nextRunAt: new Date(Date.now() + prep.later * MINUTE) }));

    const token = this.signer.token(tenantId, prep.msg.id);
    const built = buildSequenceEmail(prep.body, { signer: this.signer, token, trackOpens: settings.trackOpens, trackClicks: settings.trackClicks });
    try {
      const sent = await this.communication.deliver(
        actor,
        prep.conn,
        { to: e.email, subject: prep.subject, body: built.body, html: built.html, headers: built.headers },
        { leadId: e.leadId, contactId: e.contactId },
        SYSTEM_META,
        { action: 'sequence.email_sent', metadata: { sequenceId: e.sequenceId, enrollmentId: id, stepId: step.id } },
      );
      const next = scheduleFrom(e.stepIndex + 1);
      await this.prisma.run({ tenantId }, async (tx) => {
        await tx.sequenceMessage.update({ where: { id: prep.msg.id }, data: { emailMessageId: sent.id, sentAt: new Date() } });
        await tx.sequenceEnrollment.update({ where: { id }, data: next ?? { status: 'COMPLETED', stepIndex: e.stepIndex + 1, finishedAt: new Date(), nextRunAt: null, attempts: 0, lastError: null } });
      });
    } catch (err) {
      await this.prisma.run({ tenantId }, (tx) => tx.sequenceMessage.delete({ where: { id: prep.msg.id } }));
      const code = err instanceof ConflictException ? (err.getResponse() as { code?: string }).code : undefined;
      if (code === 'REAUTH_REQUIRED') return void (await this.pause(e, "The sender's mailbox sign-in expired. Reconnect it in Integrations, then resume."));
      const attempts = e.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return void (await finish('FAILED', `Sending failed ${attempts} times: ${errorMessage(err)}`));
      await set({ attempts, lastError: errorMessage(err), nextRunAt: new Date(Date.now() + 15 * MINUTE * 2 ** (attempts - 1)) });
    }
  }

  private async pause(e: Live, why: string): Promise<void> {
    await this.prisma.run({ tenantId: e.tenantId }, async (tx) => {
      await tx.sequenceEnrollment.update({ where: { id: e.id }, data: { status: 'PAUSED', lastError: why, nextRunAt: null } });
      await this.notifications.send(tx, e.tenantId, [e.senderId], { type: 'sequence.paused', title: `Paused: ${e.email} in ${e.sequence.name}`, body: why, link: `/app/sequences/${e.sequenceId}` });
    });
  }

  /** Fills merge fields in task titles; empty fields fall back to the person's email address. */
  private renderTitle(e: SequenceEnrollment, title: string): Promise<string> {
    return this.prisma.run({ tenantId: e.tenantId }, async (tx) => {
      const person = await loadPerson(tx, e.tenantId, e);
      const user = await tx.user.findUnique({ where: { id: e.senderId }, select: { name: true, email: true } });
      const r = renderMerge(title, { ...(person?.values ?? {}), ...senderValues(user) });
      return (r.missing.length ? renderMerge(title, { ...(person?.values ?? {}), ...senderValues(user), ...Object.fromEntries(r.missing.map((m) => [m, e.email])) }).text : r.text).slice(0, 200);
    });
  }

  /** The sender as an actor: their current role, if they may still use sequences. */
  private async actorFor(tenantId: string, userId: string): Promise<AuthContext | null> {
    const m = await this.prisma.run({ tenantId, userId }, (tx) =>
      tx.membership.findFirst({ where: { tenantId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' }, tenant: { status: 'ACTIVE', deletedAt: null } }, include: { role: true } }),
    );
    if (!m || !m.role.permissions.includes('sequences:write')) return null;
    return { userId, tenantId, sessionId: 'sequence', membershipId: m.id, roleKey: m.role.key, permissions: m.role.permissions, authMethod: 'password' };
  }

  // ───────────── What recipients did ─────────────

  /** Called from mailbox sync with every new message, before unrelated mail is dropped. */
  private async detectRepliesAndBounces(tx: TenantTx, conn: IntegrationConnection, messages: ProviderEmail[]): Promise<void | (() => Promise<void>)> {
    const found: { messageId: string; type: 'REPLIED' | 'BOUNCED' }[] = [];
    for (const m of messages) {
      if (m.outbound) continue;
      const window = { gte: new Date(m.sentAt.getTime() - 90 * DAY), lte: m.sentAt };
      if (BOUNCE_FROM.test(m.from) || BOUNCE_SUBJECT.test(m.subject)) {
        const addresses = parseAddresses(`${m.bodyText ?? ''} ${m.snippet ?? ''}`).filter((a) => a !== conn.accountEmail && a !== m.from);
        if (!addresses.length) continue;
        const hit = await tx.sequenceMessage.findFirst({ where: { tenantId: conn.tenantId, senderId: conn.userId, toAddress: { in: addresses }, bouncedAt: null, sentAt: { gte: new Date(m.sentAt.getTime() - 14 * DAY), lte: m.sentAt } }, orderBy: { sentAt: 'desc' } });
        if (hit) found.push({ messageId: hit.id, type: 'BOUNCED' });
        continue;
      }
      if (AUTO_REPLY.test(m.subject)) continue;
      const hit = await tx.sequenceMessage.findFirst({ where: { tenantId: conn.tenantId, senderId: conn.userId, toAddress: m.from, sentAt: window }, orderBy: { sentAt: 'desc' } });
      if (hit && !hit.repliedAt) found.push({ messageId: hit.id, type: 'REPLIED' });
    }
    // Rules run after the sync transaction commits, each in its own transaction.
    if (found.length) {
      return async () => {
        for (const f of found) await this.record(conn.tenantId, f.messageId, f.type);
      };
    }
  }

  /**
   * Records one event and, the first time it happens for an enrolment, applies the sequence's rules.
   * Bounces and unsubscribes always stop sending to that address, whatever the rules say.
   */
  async record(tenantId: string, messageId: string, type: 'REPLIED' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'UNSUBSCRIBED', url?: string): Promise<boolean> {
    const plan = await this.prisma.run({ tenantId }, async (tx) => {
      const msg = await tx.sequenceMessage.findFirst({ where: { id: messageId, tenantId }, include: { enrollment: { include: { sequence: true } } } });
      if (!msg) return null;
      const e = msg.enrollment;
      const now = new Date();
      const first = {
        REPLIED: !e.repliedAt,
        OPENED: !e.openedAt,
        CLICKED: !e.clickedAt,
        BOUNCED: !msg.bouncedAt,
        UNSUBSCRIBED: e.status !== 'UNSUBSCRIBED',
      }[type];
      await tx.emailEvent.create({ data: { tenantId, messageId, type, url: url?.slice(0, 2000) ?? null } });
      if (type === 'OPENED') await tx.sequenceMessage.update({ where: { id: msg.id }, data: { openCount: { increment: 1 }, openedAt: msg.openedAt ?? now } });
      if (type === 'CLICKED') await tx.sequenceMessage.update({ where: { id: msg.id }, data: { clickCount: { increment: 1 }, clickedAt: msg.clickedAt ?? now, openedAt: msg.openedAt ?? now } });
      if (type === 'REPLIED' && !msg.repliedAt) await tx.sequenceMessage.update({ where: { id: msg.id }, data: { repliedAt: now } });
      if (type === 'BOUNCED' && !msg.bouncedAt) await tx.sequenceMessage.update({ where: { id: msg.id }, data: { bouncedAt: now } });
      await tx.sequenceEnrollment.update({
        where: { id: e.id },
        data: {
          ...(type === 'REPLIED' && !e.repliedAt ? { repliedAt: now } : {}),
          ...((type === 'OPENED' || type === 'CLICKED') && !e.openedAt ? { openedAt: now } : {}),
          ...(type === 'CLICKED' && !e.clickedAt ? { clickedAt: now } : {}),
        },
      });

      if (type === 'BOUNCED' || type === 'UNSUBSCRIBED') {
        await tx.emailSuppression.upsert({
          where: { tenantId_email: { tenantId, email: msg.toAddress } },
          create: { tenantId, email: msg.toAddress, reason: type },
          update: type === 'UNSUBSCRIBED' ? { reason: 'UNSUBSCRIBED' } : {},
        });
        // Stop every live run to this address, in every sequence.
        await tx.sequenceEnrollment.updateMany({
          where: { tenantId, email: msg.toAddress, status: { in: ['ACTIVE', 'PAUSED'] } },
          data: { status: type, finishedAt: now, nextRunAt: null },
        });
        if (type === 'UNSUBSCRIBED') {
          await tx.lead.updateMany({ where: { tenantId, email: { equals: msg.toAddress, mode: 'insensitive' }, deletedAt: null }, data: { marketingConsent: 'OPTED_OUT' } });
          await tx.contact.updateMany({ where: { tenantId, email: { equals: msg.toAddress, mode: 'insensitive' }, deletedAt: null }, data: { marketingConsent: 'OPTED_OUT' } });
          await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'email.unsubscribed', entityType: 'sequence_enrollment', entityId: e.id, metadata: { email: msg.toAddress, sequenceId: e.sequenceId } });
        }
      }
      // Rules fire once per event per enrolment, while the run is live or just finished.
      const eligible = first && (e.status === 'ACTIVE' || e.status === 'PAUSED' || e.status === 'COMPLETED' || type === 'BOUNCED' || type === 'UNSUBSCRIBED');
      return eligible ? { e, msg } : null;
    });
    if (!plan) return false;

    const event = type.toLowerCase() as EmailEvent;
    const rule = seqRules(plan.e.sequence).find((r) => r.on === event);
    const flowStatus: EnrollmentStatus = type === 'REPLIED' ? 'REPLIED' : 'STOPPED';
    for (const action of rule?.actions ?? []) {
      try {
        await this.apply(plan.e, action, flowStatus, event);
      } catch (err) {
        this.log.warn({ err: errorMessage(err), enrollmentId: plan.e.id, action: action.type }, 'sequence rule action failed');
      }
    }
    return true;
  }

  private async apply(e: Live, action: RuleAction, flowStatus: EnrollmentStatus, event: EmailEvent): Promise<void> {
    const tenantId = e.tenantId;
    const label = { replied: 'replied', opened: 'opened an email', clicked: 'clicked a link', bounced: 'bounced', unsubscribed: 'unsubscribed' }[event];
    switch (action.type) {
      case 'stop':
        await this.prisma.run({ tenantId }, (tx) =>
          tx.sequenceEnrollment.updateMany({ where: { id: e.id, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: flowStatus, finishedAt: new Date(), nextRunAt: null } }),
        );
        return;
      case 'move_sequence': {
        await this.prisma.run({ tenantId }, async (tx) => {
          const stopped = await tx.sequenceEnrollment.updateMany({ where: { id: e.id, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } }, data: { status: 'MOVED', finishedAt: new Date(), nextRunAt: null } });
          if (!stopped.count) return;
          const target = await tx.sequence.findFirst({ where: { id: action.sequenceId, tenantId, status: 'ACTIVE' } });
          const person = await loadPerson(tx, tenantId, e);
          if (target && person) await this.sequences.enrollPeople(tx, tenantId, target, [person], e.senderId, null);
        });
        return;
      }
      case 'set_lead_status': {
        if (!e.leadId) return;
        const actor = await this.actorFor(tenantId, e.senderId);
        if (actor?.permissions.includes('leads:write')) await this.leads.update(actor, e.leadId, { status: action.status }, SYSTEM_META);
        return;
      }
      case 'create_task': {
        const actor = await this.actorFor(tenantId, e.senderId);
        if (actor?.permissions.includes('activities:write')) {
          await this.tasks.create(actor, { title: await this.renderTitle(e, action.title), assigneeId: e.senderId, leadId: e.leadId ?? undefined, contactId: e.contactId ?? undefined, dueAt: new Date(Date.now() + action.dueInDays * DAY).toISOString() }, SYSTEM_META);
        }
        return;
      }
      case 'notify_owner':
        await this.prisma.run({ tenantId }, (tx) =>
          this.notifications.send(tx, tenantId, [e.senderId], { type: `sequence.${event}`, title: `${e.email} ${label}`, body: `In the sequence "${e.sequence.name}".`, link: e.leadId ? `/app/leads/${e.leadId}` : e.contactId ? `/app/contacts/${e.contactId}` : `/app/sequences/${e.sequenceId}` }),
        );
    }
  }

  /** Public tracking endpoints call these with a verified token. */
  async unsubscribeInfo(tenantId: string, messageId: string): Promise<{ email: string; workspace: string; done: boolean } | null> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const msg = await tx.sequenceMessage.findFirst({ where: { id: messageId, tenantId } });
      if (!msg) return null;
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const sup = await tx.emailSuppression.findUnique({ where: { tenantId_email: { tenantId, email: msg.toAddress } } });
      return { email: msg.toAddress, workspace: tenant?.name ?? 'the sender', done: sup?.reason === 'UNSUBSCRIBED' };
    });
  }
}
