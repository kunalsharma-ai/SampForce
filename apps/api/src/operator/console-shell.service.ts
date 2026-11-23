import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import {
  type ConsolePreferences,
  type ConsolePreferencesUpdate,
  type ConsoleSearchHit,
  type ConsoleSearchResult,
  normaliseConsolePreferences,
  type OperatorMe,
} from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { ConsoleService } from './console.service';
import type { OperatorContext } from './operator-auth';
import { writePlatformAudit } from './platform-audit';

const PER_KIND = 6;
const LEVEL_LABEL: Record<string, string> = {
  SUPER: 'Super Workspace',
  MANAGER: 'Manager Workspace',
  EXECUTIVE: 'Executive Workspace',
};

/**
 * The Console shell (ADR 0074): the signed-in operator with their palette, mode, sidebar and sound, and the global
 * search behind Ctrl/⌘ K. Search reads names, emails, invoice numbers and ticket subjects only, never CRM records.
 */
@Injectable()
export class ConsoleShellService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
  ) {}

  async me(op: OperatorContext): Promise<OperatorMe> {
    const row = await this.prisma.platformOperator.findUnique({
      where: { id: op.id },
      select: { preferences: true },
    });
    const { sessionId: _session, ...me } = op;
    return { ...me, mfaSetupRequired: !!op.mfaSetupRequired, preferences: normaliseConsolePreferences(row?.preferences) };
  }

  async setPreferences(
    op: OperatorContext,
    input: ConsolePreferencesUpdate,
  ): Promise<ConsolePreferences> {
    const row = await this.prisma.platformOperator.findUnique({
      where: { id: op.id },
      select: { preferences: true },
    });
    if (!row)
      // The account was removed while signed in: the session is no longer valid.
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Sign in to the operator console.',
      });
    const next = normaliseConsolePreferences({
      ...normaliseConsolePreferences(row.preferences),
      ...input,
    });
    await this.prisma.platformOperator.update({
      where: { id: op.id },
      data: { preferences: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  async search(op: OperatorContext, q: string, ip: string | null): Promise<ConsoleSearchResult> {
    const text = { contains: q, mode: 'insensitive' as const };
    const ticketNumber = /^#?(\d{1,7})$/.exec(q)?.[1];
    // Each kind is searched only when the operator's role may open it (ADR 0074).
    const can = (p: OperatorContext['permissions'][number]) => op.permissions.includes(p);
    const none = Promise.resolve([] as never[]);

    const [scanned, users, plans] = await Promise.all([
      this.prisma.run({ operatorScan: true }, async (tx) => {
        const [clients, workspaces, invoices, tickets] = await Promise.all([
          !can('clients.view') ? none : tx.tenant.findMany({
            where: { deletedAt: null, OR: [{ name: text }, { slug: text }] },
            select: { id: true, name: true, slug: true },
            orderBy: { name: 'asc' },
            take: PER_KIND,
          }),
          !can('workspaces.view') ? none : tx.workspaceNode.findMany({
            where: { archivedAt: null, name: text },
            select: { id: true, tenantId: true, name: true, level: true },
            orderBy: { name: 'asc' },
            take: PER_KIND,
          }),
          !can('billing.view') ? none : tx.invoice.findMany({
            where: { OR: [{ number: text }, { providerInvoiceId: text }] },
            select: {
              id: true,
              tenantId: true,
              number: true,
              status: true,
              totalCents: true,
              currency: true,
            },
            orderBy: { issuedAt: 'desc' },
            take: PER_KIND,
          }),
          !can('support.handle') ? none : tx.supportTicket.findMany({
            where: ticketNumber
              ? { OR: [{ subject: text }, { number: Number(ticketNumber) }] }
              : { subject: text },
            select: { id: true, tenantId: true, number: true, subject: true, status: true },
            orderBy: { updatedAt: 'desc' },
            take: PER_KIND,
          }),
        ]);
        return { clients, workspaces, invoices, tickets };
      }),
      !can('users.view') ? none : this.prisma.user.findMany({
        where: { OR: [{ email: text }, { name: text }] },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
        take: PER_KIND,
      }),
      can('clients.view') ? this.console.plans() : none,
    ]);

    // The client of each person (their first active membership) and the names of every client mentioned.
    const memberships = users.length
      ? await this.prisma.run({ operatorScan: true }, (tx) =>
          tx.membership.findMany({
            where: { userId: { in: users.map((u) => u.id) }, status: 'ACTIVE' },
            select: { userId: true, tenantId: true },
            orderBy: { createdAt: 'asc' },
          }),
        )
      : [];
    const tenantOfUser = new Map<string, string>();
    for (const m of memberships)
      if (!tenantOfUser.has(m.userId)) tenantOfUser.set(m.userId, m.tenantId);
    const tenantIds = [
      ...new Set([
        ...scanned.workspaces.map((w) => w.tenantId),
        ...scanned.invoices.map((i) => i.tenantId),
        ...scanned.tickets.map((t) => t.tenantId),
        ...tenantOfUser.values(),
      ]),
    ];
    const names = new Map(
      tenantIds.length
        ? (
            await this.prisma.run({ operatorScan: true }, (tx) =>
              tx.tenant.findMany({
                where: { id: { in: tenantIds } },
                select: { id: true, name: true },
              }),
            )
          ).map((t) => [t.id, t.name])
        : [],
    );
    const clientName = (id: string) => names.get(id) ?? 'Unknown client';
    const lower = q.toLowerCase();

    const hits: ConsoleSearchHit[] = [
      ...scanned.clients.map((c) => ({
        kind: 'client' as const,
        id: c.id,
        title: c.name,
        detail: c.slug,
        href: `/operator/clients/${c.id}`,
      })),
      ...users.map((u) => {
        const tenantId = tenantOfUser.get(u.id);
        return {
          kind: 'user' as const,
          id: u.id,
          title: u.name,
          detail: tenantId
            ? `${u.email} · ${clientName(tenantId)}`
            : `${u.email} · no organisation`,
          href: tenantId ? `/operator/clients/${tenantId}` : '/operator/clients',
        };
      }),
      ...scanned.workspaces.map((w) => ({
        kind: 'workspace' as const,
        id: w.id,
        title: w.name,
        detail: `${LEVEL_LABEL[w.level] ?? w.level} · ${clientName(w.tenantId)}`,
        href: `/operator/clients/${w.tenantId}`,
      })),
      ...scanned.invoices.map((i) => ({
        kind: 'invoice' as const,
        id: i.id,
        title: i.number ? `Invoice ${i.number}` : 'Invoice',
        detail: `${clientName(i.tenantId)} · ${(i.totalCents / 100).toFixed(2)} ${i.currency.toUpperCase()} · ${i.status.toLowerCase()}`,
        href: `/operator/clients/${i.tenantId}`,
      })),
      ...scanned.tickets.map((t) => ({
        kind: 'ticket' as const,
        id: t.id,
        title: `#${t.number} ${t.subject}`,
        detail: clientName(t.tenantId),
        href: `/operator/support?ticket=${t.id}`,
      })),
      ...plans
        .filter((p) => p.name.toLowerCase().includes(lower) || p.code.toLowerCase().includes(lower))
        .slice(0, PER_KIND)
        .map((p) => ({
          kind: 'plan' as const,
          id: p.code,
          title: p.name,
          detail: p.code,
          href: '/operator/plans',
        })),
    ];
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'console.searched', target: null, metadata: { q, results: hits.length }, ip });
    return { q, hits };
  }
}
