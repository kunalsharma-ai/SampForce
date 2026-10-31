import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailMessage, IntegrationConnection, Meeting, TenantTx } from '@dealflow/database';
import type { EmailRow, IntegrationProviderKey, MeetingRow, SendEmailInput } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { assertRefs, notFound } from '../crm/crm-helpers';
import { IntegrationsService, matchPeople } from './integrations.service';
import { ProviderError, ReauthRequiredError } from './providers';

export interface EmailQuery {
  contactId?: string;
  leadId?: string;
  limit: number;
}

@Injectable()
export class CommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly activities: ActivitiesService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  listEmails(auth: AuthContext, q: EmailQuery): Promise<EmailRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.emailMessage.findMany({
        where: { tenantId: auth.tenantId, ...(q.contactId ? { contactId: q.contactId } : {}), ...(q.leadId ? { leadId: q.leadId } : {}) },
        include: { connection: { select: { provider: true } } },
        orderBy: { sentAt: 'desc' },
        take: q.limit,
      });
      return rows.map(toEmailRow);
    });
  }

  getEmail(auth: AuthContext, id: string): Promise<EmailRow & { bodyText: string | null }> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.emailMessage.findFirst({ where: { id, tenantId: auth.tenantId }, include: { connection: { select: { provider: true } } } });
      if (!row) throw notFound('Email');
      return { ...toEmailRow(row), bodyText: row.bodyText };
    });
  }

  listMeetings(auth: AuthContext, range: { from: Date; to: Date; contactId?: string }): Promise<MeetingRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.meeting.findMany({
        where: {
          tenantId: auth.tenantId,
          startsAt: { gte: range.from, lt: range.to },
          ...(range.contactId ? { contactIds: { has: range.contactId } } : {}),
        },
        include: { connection: { select: { provider: true } } },
        orderBy: { startsAt: 'asc' },
        take: 500,
      });
      return rows.map(toMeetingRow);
    });
  }

  /** The sender's connected mailbox (most recently updated if several), or null. */
  mailboxFor(tx: TenantTx, tenantId: string, userId: string): Promise<IntegrationConnection | null> {
    return tx.integrationConnection.findFirst({ where: { tenantId, userId, status: 'CONNECTED' }, orderBy: { updatedAt: 'desc' } });
  }

  /** Emails DealFlow sent from a mailbox in the last 24 hours, direct and sequence sends together. */
  sentInLastDay(tx: TenantTx, connectionId: string): Promise<number> {
    return tx.emailMessage.count({ where: { connectionId, direction: 'OUTBOUND', createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  }

  /**
   * Sends one email from the caller's connected mailbox and logs it on the matching record. A daily
   * per-mailbox cap applies to everything DealFlow sends, including sequences.
   */
  async send(auth: AuthContext, input: SendEmailInput, meta: RequestMeta): Promise<EmailRow> {
    const conn = await this.prisma.run(auth, async (tx) => {
      await assertRefs(tx, auth.tenantId, { contactId: input.contactId, leadId: input.leadId });
      const c = await this.mailboxFor(tx, auth.tenantId, auth.userId);
      if (!c) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect your Google or Microsoft mailbox before sending email.' });
      if ((await this.sentInLastDay(tx, c.id)) >= this.env.EMAIL_DAILY_SEND_LIMIT) {
        throw new HttpException(
          { code: 'SEND_LIMIT_REACHED', message: `You have reached the limit of ${this.env.EMAIL_DAILY_SEND_LIMIT} emails per day from DealFlow.` },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return c;
    });
    const row = await this.deliver(auth, conn, { to: input.to, subject: input.subject, body: input.body }, { contactId: input.contactId, leadId: input.leadId }, meta);
    return toEmailRow(row);
  }

  /**
   * Sends through one connection and records the message, the audit entry and an activity. Callers check
   * limits first. Provider failures surface as ConflictException with REAUTH_REQUIRED or PROVIDER_ERROR.
   */
  async deliver(
    auth: AuthContext,
    conn: IntegrationConnection,
    mail: { to: string; subject: string; body: string; html?: string; headers?: Record<string, string> },
    links: { contactId?: string | null; leadId?: string | null },
    meta: RequestMeta,
    audit: { action: string; metadata?: Record<string, unknown> } = { action: 'email.sent' },
  ): Promise<WithProvider<EmailMessage>> {
    let result: { providerMessageId: string | null; threadId: string | null };
    try {
      const token = await this.prisma.run(auth, (tx) => this.integrations.accessToken(tx, conn));
      result = await this.integrations.adapters[conn.provider].sendMail(token, { from: conn.accountEmail, ...mail });
    } catch (err) {
      if (err instanceof ReauthRequiredError) throw new ConflictException({ code: 'REAUTH_REQUIRED', message: 'Your mailbox sign-in expired. Reconnect it in Integrations.' });
      if (err instanceof ProviderError) throw new ConflictException({ code: 'PROVIDER_ERROR', message: err.message });
      throw err;
    }

    const row = await this.prisma.run(auth, async (tx) => {
      let contactId = links.contactId ?? undefined;
      let leadId = links.leadId ?? undefined;
      if (!contactId && !leadId) {
        const hit = (await matchPeople(tx, auth.tenantId, [mail.to])).get(mail.to);
        contactId = hit?.contactId;
        leadId = hit?.contactId ? undefined : hit?.leadId;
      }
      const email = await tx.emailMessage.create({
        data: {
          tenantId: auth.tenantId,
          connectionId: conn.id,
          providerMessageId: result.providerMessageId ?? `dealflow:${randomUUID()}`,
          threadId: result.threadId,
          direction: 'OUTBOUND',
          fromAddress: conn.accountEmail,
          toAddresses: [mail.to],
          ccAddresses: [],
          subject: mail.subject,
          snippet: mail.body.slice(0, 200),
          bodyText: mail.body,
          sentAt: new Date(),
          contactId: contactId ?? null,
          leadId: leadId ?? null,
        },
        include: { connection: { select: { provider: true } } },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: audit.action, entityType: 'email', entityId: email.id,
        metadata: { provider: conn.provider, contactId, leadId, ...audit.metadata }, meta,
      });
      return email;
    });

    if (row.contactId || row.leadId) {
      await this.activities.create(
        auth,
        { type: 'EMAIL', subject: mail.subject.slice(0, 200), body: mail.body.slice(0, 10_000), contactId: row.contactId ?? undefined, leadId: row.leadId ?? undefined },
        meta,
      );
    }
    return row;
  }
}

export type WithProvider<T> = T & { connection: { provider: IntegrationProviderKey } };

export function toEmailRow(r: WithProvider<EmailMessage>): EmailRow {
  return {
    id: r.id,
    direction: r.direction,
    from: r.fromAddress,
    to: r.toAddresses,
    subject: r.subject,
    snippet: r.snippet,
    sentAt: r.sentAt.toISOString(),
    contactId: r.contactId,
    leadId: r.leadId,
    provider: r.connection.provider,
  };
}

export function toMeetingRow(r: WithProvider<Meeting>): MeetingRow {
  return {
    id: r.id,
    title: r.title,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    location: r.location,
    attendees: r.attendees,
    canceled: r.canceled,
    contactIds: r.contactIds,
    provider: r.connection.provider,
  };
}

