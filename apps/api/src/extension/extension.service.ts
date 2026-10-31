import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EXTENSION_TOKEN_DAYS,
  EXTENSION_TOKEN_PREFIX,
  EXTENSION_USER_AGENT,
  type ExtensionCaptureInput,
  type ExtensionCaptureResult,
  type ExtensionLookupInput,
  type ExtensionLookupResult,
  type ExtensionMatch,
  type ExtensionMe,
  type ExtensionTokenCreated,
  type ExtensionTokenRow,
  isPersonalEmail,
  MAX_EXTENSION_TOKENS,
  nameFromEmail,
  siteDomain,
} from '@dealflow/types';
import type { Session, TenantTx } from '@dealflow/database';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { LeadsService } from '../crm/leads.service';
import { SequencesService } from '../sequences/sequences.service';

const DAY = 86_400_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function toRow(s: Session): ExtensionTokenRow {
  return {
    id: s.id,
    name: s.extensionName ?? 'Browser extension',
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
    expiresAt: s.expiresAt.toISOString(),
  };
}

/**
 * The browser extension's side of DealFlow. Connections are sessions with their own token, so they show
 * in the person's devices and end with any sign-out. Leads are created through LeadsService, so the
 * usual audit trail, duplicate rules and workflows apply.
 */
@Injectable()
export class ExtensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly sequences: SequencesService,
  ) {}

  // ───── Connections ─────

  private live(auth: AuthContext) {
    return { userId: auth.userId, activeTenantId: auth.tenantId, extensionTokenHash: { not: null }, revokedAt: null, expiresAt: { gt: new Date() } };
  }

  async listTokens(auth: AuthContext): Promise<ExtensionTokenRow[]> {
    const rows = await this.prisma.session.findMany({ where: this.live(auth), orderBy: { createdAt: 'desc' } });
    return rows.map(toRow);
  }

  async createToken(auth: AuthContext, name: string, meta: RequestMeta): Promise<ExtensionTokenCreated> {
    const count = await this.prisma.session.count({ where: this.live(auth) });
    if (count >= MAX_EXTENSION_TOKENS) {
      throw new ConflictException({ code: 'TOO_MANY_CONNECTIONS', message: `You can have ${MAX_EXTENSION_TOKENS} extension connections. Remove one you no longer use first.` });
    }
    const token = EXTENSION_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId: auth.userId,
        activeTenantId: auth.tenantId,
        // Never handed out: an extension connection cannot be refreshed into a web session.
        refreshTokenHash: hash(randomBytes(32).toString('hex')),
        extensionTokenHash: hash(token),
        extensionName: name,
        userAgent: `${EXTENSION_USER_AGENT} (${name})`,
        ipAddress: meta.ipAddress,
        authMethod: auth.authMethod,
        ssoTenantId: auth.ssoTenantId ?? null,
        expiresAt: new Date(Date.now() + EXTENSION_TOKEN_DAYS * DAY),
      },
    });
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'extension.connected', entityType: 'user', entityId: auth.userId, metadata: { name }, meta }),
    );
    return { token, connection: toRow(session) };
  }

  async revokeToken(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    const { count } = await this.prisma.session.updateMany({ where: { ...this.live(auth), id }, data: { revokedAt: new Date() } });
    if (count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That connection has already ended.' });
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'extension.disconnected', entityType: 'user', entityId: auth.userId, meta }),
    );
  }

  // ───── What the extension calls ─────

  me(auth: AuthContext): Promise<ExtensionMe> {
    return this.prisma.run(auth, async (tx) => {
      const [user, tenant, mailbox, sequences] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { id: true, name: true, email: true } }),
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { id: true, name: true } }),
        tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'CONNECTED' }, select: { id: true } }),
        auth.permissions.includes('sequences:read')
          ? tx.sequence.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 })
          : [],
      ]);
      return {
        user,
        workspace: tenant,
        canSave: auth.permissions.includes('leads:write'),
        canEnroll: auth.permissions.includes('sequences:write'),
        mailboxConnected: !!mailbox,
        sequences,
      };
    });
  }

  private async matches(tx: TenantTx, tenantId: string, emails: string[]) {
    const out = new Map<string, ExtensionMatch>();
    if (!emails.length) return { out, suppressed: new Set<string>() };
    const base = { tenantId, deletedAt: null, email: { in: emails, mode: 'insensitive' as const } };
    const [contacts, leads, suppressed] = await Promise.all([
      tx.contact.findMany({ where: base, select: { id: true, email: true, firstName: true, lastName: true } }),
      tx.lead.findMany({ where: base, select: { id: true, email: true, fullName: true }, orderBy: { createdAt: 'asc' } }),
      tx.emailSuppression.findMany({ where: { tenantId, email: { in: emails } }, select: { email: true } }),
    ]);
    // A contact is the better match: the lead may already have been converted into it.
    for (const c of contacts) {
      const e = c.email!.toLowerCase();
      if (!out.has(e)) out.set(e, { entity: 'contact', id: c.id, label: [c.firstName, c.lastName].filter(Boolean).join(' ') || e });
    }
    for (const l of leads) {
      const e = l.email!.toLowerCase();
      if (!out.has(e)) out.set(e, { entity: 'lead', id: l.id, label: l.fullName });
    }
    return { out, suppressed: new Set(suppressed.map((s) => s.email)) };
  }

  lookup(auth: AuthContext, input: ExtensionLookupInput): Promise<ExtensionLookupResult> {
    return this.prisma.run(auth, async (tx) => {
      const emails = [...new Set(input.emails)];
      const { out, suppressed } = await this.matches(tx, auth.tenantId, emails);
      const domain = siteDomain(input.website);
      const company = domain
        ? await tx.company.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, domain: { in: [domain, `www.${domain}`], mode: 'insensitive' } }, select: { id: true, name: true } })
        : null;
      return {
        people: emails.map((email) => ({ email, match: out.get(email) ?? null, suppressed: suppressed.has(email), personal: isPersonalEmail(email) })),
        company,
      };
    });
  }

  async capture(auth: AuthContext, input: ExtensionCaptureInput, meta: RequestMeta): Promise<ExtensionCaptureResult> {
    // Check the sequence first, so nothing is saved when the enrolment would be refused.
    if (input.sequenceId) {
      if (!auth.permissions.includes('sequences:write')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role does not allow enrolling people in sequences.' });
      await this.prisma.run(auth, async (tx) => {
        const s = await tx.sequence.findFirst({ where: { id: input.sequenceId, tenantId: auth.tenantId }, select: { status: true } });
        if (!s) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Sequence not found.' });
        if (s.status !== 'ACTIVE') throw new ConflictException({ code: 'SEQUENCE_NOT_ACTIVE', message: 'That sequence is not running. Choose another or start it in DealFlow.' });
        const mailbox = await tx.integrationConnection.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, status: 'CONNECTED' }, select: { id: true } });
        if (!mailbox) throw new ConflictException({ code: 'NOT_CONNECTED', message: 'Connect your Google or Microsoft mailbox in DealFlow before enrolling people. Emails go from your own mailbox.' });
      });
    }

    const people = [...new Map(input.people.map((p) => [p.email, p])).values()];
    const { out, suppressed } = await this.prisma.run(auth, (tx) => this.matches(tx, auth.tenantId, people.map((p) => p.email)));
    const domain = siteDomain(input.website) ?? siteDomain(input.sourceUrl);
    const results: ExtensionCaptureResult['results'] = [];

    for (const p of people) {
      const existing = out.get(p.email);
      if (existing) {
        results.push({ email: p.email, outcome: 'existing', match: existing });
        continue;
      }
      // Automatic capture leaves private individuals and do-not-email addresses alone. Saving by hand can still add them.
      const reason = input.auto && isPersonalEmail(p.email) ? 'personal' : input.auto && suppressed.has(p.email) ? 'suppressed' : null;
      if (reason) {
        results.push({ email: p.email, outcome: 'skipped', reason });
        continue;
      }
      const { lead } = await this.leads.create(
        auth,
        {
          fullName: p.fullName || nameFromEmail(p.email),
          email: p.email,
          jobTitle: p.jobTitle || undefined,
          companyName: input.companyName || undefined,
          website: isPersonalEmail(p.email) ? undefined : domain ?? undefined,
          source: 'Browser extension',
          tags: input.auto ? ['browser-extension', 'auto-captured'] : ['browser-extension'],
        },
        meta,
      );
      results.push({ email: p.email, outcome: 'created', match: { entity: 'lead', id: lead.id, label: lead.fullName } });
    }

    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'extension.captured', entityType: 'user', entityId: auth.userId,
        metadata: { sourceUrl: input.sourceUrl.slice(0, 500), auto: input.auto, created: results.filter((r) => r.outcome === 'created').length, existing: results.filter((r) => r.outcome === 'existing').length },
        meta,
      }),
    );

    if (!input.sequenceId) return { results };
    const targets = results.flatMap((r) => (r.match ? [r.match] : []));
    const enrollment = targets.length
      ? await this.sequences.enroll(
          auth,
          input.sequenceId,
          { leadIds: targets.filter((t) => t.entity === 'lead').map((t) => t.id), contactIds: targets.filter((t) => t.entity === 'contact').map((t) => t.id) },
          meta,
        )
      : { enrolled: 0, skipped: [] };
    return { results, enrollment };
  }
}
