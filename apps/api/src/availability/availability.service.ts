import type { TenantTx } from '@dealflow/database';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { AchievementsService } from '../achievements/achievements.service';
import {
  AVAILABILITY_STATUSES,
  type AvailabilityEventKind,
  type AvailabilityMe,
  type AvailabilityPerson,
  type AvailabilityStatus,
  type AvailabilityTeam,
  type ChoosableStatus,
  effectiveStatus,
  sessionMinutes,
  STALE_SESSION_MS,
  type WorkSessionView,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { photoUrl } from '../profile-photos/profile-photos.service';
import { NotificationsService } from '../notifications/notifications.service';
import { branchIds, resolveOrganisation } from '../workspaces/access';
import { callerOf, type Org } from '../workspace-work/hierarchy';

type Row = {
  id: string;
  userId: string;
  workspaceNodeId: string | null;
  checkedInAt: Date;
  checkedOutAt: Date | null;
  breaks: unknown;
  chosenStatus: string;
  statusSince: Date;
  lastSeenAt: Date;
};
type Break = { start: Date; end: Date | null };

function breaksOf(json: unknown): Break[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((b): b is { start: string; end?: string | null } => !!b && typeof (b as { start?: unknown }).start === 'string')
    .map((b) => ({ start: new Date(b.start), end: b.end ? new Date(b.end) : null }));
}
const breaksJson = (list: Break[]) => list.map((b) => ({ start: b.start.toISOString(), end: b.end?.toISOString() ?? null }));

function viewOf(s: Row, now: Date): WorkSessionView {
  const breaks = breaksOf(s.breaks);
  const m = sessionMinutes({ checkedInAt: s.checkedInAt, checkedOutAt: s.checkedOutAt, breaks }, now);
  return {
    id: s.id,
    checkedInAt: s.checkedInAt.toISOString(),
    checkedOutAt: s.checkedOutAt?.toISOString() ?? null,
    breaks: breaks.map((b) => ({ start: b.start.toISOString(), end: b.end?.toISOString() ?? null })),
    ...m,
  };
}

function statusOf(s: Row | null, now: Date) {
  return effectiveStatus(s ? { checkedOutAt: s.checkedOutAt, breaks: breaksOf(s.breaks), chosen: s.chosenStatus, lastSeenAt: s.lastSeenAt } : null, now);
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Check-in, breaks and check-out (redesign R1, ADR 0081). Every step is stored on the person's open WorkSession and
 * logged in availability_events; the times shown are always worked out from those, never typed in.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly achievements?: AchievementsService,
  ) {}

  /** The person's open session, closing it first when it was forgotten for a whole day. */
  private async openSession(tx: TenantTx, tenantId: string, userId: string, now: Date): Promise<Row | null> {
    const open = await tx.workSession.findFirst({ where: { tenantId, userId, checkedOutAt: null }, orderBy: { checkedInAt: 'desc' } });
    if (!open) return null;
    if (now.getTime() - open.checkedInAt.getTime() > STALE_SESSION_MS) {
      const at = open.lastSeenAt > open.checkedInAt ? open.lastSeenAt : open.checkedInAt;
      const breaks = breaksOf(open.breaks).map((b) => ({ ...b, end: b.end ?? at }));
      await tx.workSession.update({ where: { id: open.id }, data: { checkedOutAt: at, breaks: breaksJson(breaks), autoClosed: true, statusSince: at } });
      await tx.availabilityEvent.create({ data: { tenantId, userId, sessionId: open.id, kind: 'AUTO_CHECK_OUT', status: 'CHECKED_OUT', at } });
      return null;
    }
    return open;
  }

  /** The open session, else the last one closed today (so the header can still show today's times). */
  private async todaySession(tx: TenantTx, tenantId: string, userId: string, now: Date): Promise<Row | null> {
    const open = await this.openSession(tx, tenantId, userId, now);
    if (open) return open;
    return tx.workSession.findFirst({ where: { tenantId, userId, checkedInAt: { gte: startOfUtcDay(now) } }, orderBy: { checkedInAt: 'desc' } });
  }

  private meOf(s: Row | null, now: Date): AvailabilityMe {
    const st = statusOf(s, now);
    return {
      status: st.status,
      autoAway: st.autoAway,
      since: s ? (st.status === 'CHECKED_OUT' ? (s.checkedOutAt ?? s.statusSince).toISOString() : st.autoAway ? s.lastSeenAt.toISOString() : s.statusSince.toISOString()) : null,
      session: s ? viewOf(s, now) : null,
    };
  }

  me(auth: AuthContext): Promise<AvailabilityMe> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      return this.meOf(await this.todaySession(tx, auth.tenantId, auth.userId, now), now);
    });
  }

  /** A SampForce page is open: refreshes presence, so Away goes back to the chosen status. */
  beat(auth: AuthContext): Promise<AvailabilityMe> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      const open = await this.openSession(tx, auth.tenantId, auth.userId, now);
      if (open) {
        const wasAway = statusOf(open, now).autoAway;
        const row = await tx.workSession.update({ where: { id: open.id }, data: { lastSeenAt: now, ...(wasAway ? { statusSince: now } : {}) } });
        // Coming back after Away came by itself is an unplanned interruption, kept so the day can be judged fairly (ADR 0090).
        if (wasAway) await tx.availabilityEvent.create({ data: { tenantId: auth.tenantId, userId: auth.userId, sessionId: open.id, kind: 'AWAY_ENDED', status: statusOf(row, now).status, at: now } });
        return this.meOf(row, now);
      }
      return this.meOf(await this.todaySession(tx, auth.tenantId, auth.userId, now), now);
    });
  }

  checkIn(auth: AuthContext): Promise<AvailabilityMe> {
    return this.change(auth, 'CHECK_IN', async (tx, open, now) => {
      if (open) throw new BadRequestException({ code: 'ALREADY_CHECKED_IN', message: 'You are already checked in.' });
      return tx.workSession.create({
        data: { tenantId: auth.tenantId, userId: auth.userId, workspaceNodeId: auth.workspaceNodeId ?? null, checkedInAt: now, breaks: [], chosenStatus: 'WORKING', statusSince: now, lastSeenAt: now },
      });
    });
  }

  startBreak(auth: AuthContext): Promise<AvailabilityMe> {
    return this.change(auth, 'BREAK_START', async (tx, open, now) => {
      const s = this.mustBeOpen(open);
      const breaks = breaksOf(s.breaks);
      if (breaks.some((b) => !b.end)) throw new BadRequestException({ code: 'ALREADY_ON_BREAK', message: 'You are already on a break.' });
      return tx.workSession.update({ where: { id: s.id }, data: { breaks: breaksJson([...breaks, { start: now, end: null }]), statusSince: now, lastSeenAt: now } });
    });
  }

  resume(auth: AuthContext): Promise<AvailabilityMe> {
    return this.change(auth, 'BREAK_END', async (tx, open, now) => {
      const s = this.mustBeOpen(open);
      const breaks = breaksOf(s.breaks);
      if (!breaks.some((b) => !b.end)) throw new BadRequestException({ code: 'NOT_ON_BREAK', message: 'You are not on a break.' });
      return tx.workSession.update({
        where: { id: s.id },
        data: { breaks: breaksJson(breaks.map((b) => (b.end ? b : { ...b, end: now }))), chosenStatus: 'WORKING', statusSince: now, lastSeenAt: now },
      });
    });
  }

  setStatus(auth: AuthContext, status: ChoosableStatus): Promise<AvailabilityMe> {
    return this.change(auth, 'STATUS', async (tx, open, now) => {
      const s = this.mustBeOpen(open);
      const breaks = breaksOf(s.breaks);
      // Choosing a status ends a running break.
      return tx.workSession.update({
        where: { id: s.id },
        data: { chosenStatus: status, breaks: breaksJson(breaks.map((b) => (b.end ? b : { ...b, end: now }))), statusSince: now, lastSeenAt: now },
      });
    });
  }

  checkOut(auth: AuthContext): Promise<AvailabilityMe> {
    return this.change(auth, 'CHECK_OUT', async (tx, open, now) => {
      const s = this.mustBeOpen(open);
      const breaks = breaksOf(s.breaks).map((b) => (b.end ? b : { ...b, end: now }));
      this.achievements?.checkedOut(tx, auth.tenantId, auth.userId, s.id);
      return tx.workSession.update({ where: { id: s.id }, data: { checkedOutAt: now, breaks: breaksJson(breaks), statusSince: now } });
    });
  }

  private mustBeOpen(open: Row | null): Row {
    if (!open) throw new BadRequestException({ code: 'NOT_CHECKED_IN', message: 'Check in first.' });
    return open;
  }

  /** Runs one step, logs it, and tells the people who look after this person. */
  private change(auth: AuthContext, kind: AvailabilityEventKind, step: (tx: TenantTx, open: Row | null, now: Date) => Promise<Row>): Promise<AvailabilityMe> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      const open = await this.openSession(tx, auth.tenantId, auth.userId, now);
      const before = statusOf(open, now).status;
      const row = await step(tx, open, now);
      const me = this.meOf(row, now);
      await tx.availabilityEvent.create({ data: { tenantId: auth.tenantId, userId: auth.userId, sessionId: row.id, kind, status: me.status, at: now } });
      if (me.status !== before) await this.tellWatchers(tx, auth, me, before, now);
      return me;
    });
  }

  /** People who see this person's status and are told when it changes: the manager above them and Super admins. */
  private async tellWatchers(tx: TenantTx, auth: AuthContext, me: AvailabilityMe, before: AvailabilityStatus, now: Date): Promise<void> {
    const org = await resolveOrganisation(tx, auth.tenantId);
    const mine = callerOf(auth, org);
    if (mine === org.root) return;
    const watchers = new Set<string>();
    if (mine.level === 'EXECUTIVE' && mine.node.parentId && mine.node.parentId !== org.root.node.id) {
      for (const m of await tx.membership.findMany({ where: { tenantId: auth.tenantId, status: 'ACTIVE', workspaceNodeId: mine.node.parentId }, select: { userId: true } })) watchers.add(m.userId);
    }
    for (const u of await this.notifications.usersWithPermission(tx, auth.tenantId, 'members:manage')) watchers.add(u);
    watchers.delete(auth.userId);
    if (watchers.size === 0) return;
    const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
    const name = user?.name ?? 'Someone';
    const title: Record<AvailabilityStatus, string> = {
      WORKING: before === 'ON_BREAK' ? `${name} is back at work` : before === 'CHECKED_OUT' ? `${name} checked in` : `${name} is working`,
      AVAILABLE: `${name} is available`,
      ON_BREAK: `${name} is on a break`,
      AWAY: `${name} is away`,
      CHECKED_OUT: `${name} checked out`,
    };
    await this.notifications.send(tx, auth.tenantId, [...watchers], {
      // The change itself is in the type (team.status.checked_in, .on_break, .back...), so the on-screen pop-up can
      // show the right picture in any language.
      type: `team.status.${statusEvent(me.status, before)}`,
      title: title[me.status],
      link: '/app/team-status',
      senderId: auth.userId,
      // One notification per change, even if the request is retried.
      eventId: `team.status:${auth.userId}:${now.getTime()}`,
    });
  }

  /** The people the caller may see, with their status now and today's times. */
  team(auth: AuthContext, workspaceId?: string): Promise<AvailabilityTeam> {
    return this.prisma.run(auth, async (tx) => {
      const now = new Date();
      const org: Org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const nodes = [...org.byId.values()].map((a) => a.node);
      let scope: AvailabilityTeam['scope'];
      let nodeIds: Set<string>;
      if (me.level === 'SUPER') {
        scope = 'ORGANISATION';
        nodeIds = new Set(nodes.map((n) => n.id));
      } else if (me.level === 'MANAGER') {
        scope = 'TEAM';
        nodeIds = branchIds(nodes, me.node.id);
      } else {
        scope = 'SELF';
        nodeIds = new Set([me.node.id]);
        // Team mates, when the manager lets this executive talk with peers (and they may too).
        if (me.node.canChatWithPeers)
          for (const n of nodes) if (n.level === 'EXECUTIVE' && n.parentId === me.node.parentId && n.canChatWithPeers && !n.archivedAt) nodeIds.add(n.id);
      }
      if (workspaceId) {
        if (!nodeIds.has(workspaceId)) throw new BadRequestException({ code: 'WORKSPACE_NOT_VISIBLE', message: 'That workspace is not one you can see.' });
        nodeIds = me.level === 'EXECUTIVE' ? new Set([workspaceId]) : branchIds(nodes, workspaceId);
      }
      const includeUnplaced = nodeIds.has(org.root.node.id);
      const members = await tx.membership.findMany({
        where: {
          tenantId: auth.tenantId,
          status: 'ACTIVE',
          ...(me.level === 'EXECUTIVE' && !me.node.canChatWithPeers
            ? { userId: auth.userId }
            : { OR: [{ workspaceNodeId: { in: [...nodeIds] } }, ...(includeUnplaced ? [{ workspaceNodeId: null }, { workspaceNodeId: { isSet: false } }] : [])] }),
        },
        include: { user: { select: { id: true, name: true, status: true, photo: { select: { updatedAt: true } } } } },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      const people = members.filter((m) => m.user.status === 'ACTIVE');
      const userIds = people.map((m) => m.userId);
      const since = new Date(now.getTime() - STALE_SESSION_MS);
      const sessions = await tx.workSession.findMany({
        where: { tenantId: auth.tenantId, userId: { in: userIds }, OR: [{ checkedOutAt: null, checkedInAt: { gte: since } }, { checkedInAt: { gte: startOfUtcDay(now) } }] },
        orderBy: { checkedInAt: 'desc' },
      });
      const latest = new Map<string, Row>();
      for (const s of sessions) if (!latest.has(s.userId) || (!s.checkedOutAt && latest.get(s.userId)!.checkedOutAt)) latest.set(s.userId, s);
      const rows: AvailabilityPerson[] = people.map((m) => {
        const s = latest.get(m.userId) ?? null;
        const st = statusOf(s, now);
        const node = m.workspaceNodeId ? org.byId.get(m.workspaceNodeId) : null;
        const mins = s ? sessionMinutes({ checkedInAt: s.checkedInAt, checkedOutAt: s.checkedOutAt, breaks: breaksOf(s.breaks) }, now) : { breakMinutes: 0, workedMinutes: 0 };
        return {
          userId: m.userId,
          name: m.user.name,
          photoUrl: photoUrl(m.userId, m.user.photo?.updatedAt),
          workspace: node && node !== org.root ? { id: node.node.id, name: node.node.name, level: node.level } : null,
          status: st.status,
          since: s ? (st.status === 'CHECKED_OUT' ? (s.checkedOutAt ?? s.statusSince).toISOString() : st.autoAway ? s.lastSeenAt.toISOString() : s.statusSince.toISOString()) : null,
          checkedInAt: s?.checkedInAt.toISOString() ?? null,
          checkedOutAt: s?.checkedOutAt?.toISOString() ?? null,
          ...mins,
          isMe: m.userId === auth.userId,
        };
      });
      const order: Record<AvailabilityStatus, number> = { WORKING: 0, AVAILABLE: 1, ON_BREAK: 2, AWAY: 3, CHECKED_OUT: 4 };
      rows.sort((a, b) => Number(b.isMe) - Number(a.isMe) || order[a.status] - order[b.status] || a.name.localeCompare(b.name));
      const counts = Object.fromEntries(AVAILABILITY_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<AvailabilityStatus, number>;
      return { people: rows, counts, scope };
    });
  }
}

/** What a status change means for the people watching: the last part of its notification type. */
export function statusEvent(now: AvailabilityStatus, before: AvailabilityStatus): string {
  if (now === 'WORKING') return before === 'ON_BREAK' ? 'back' : before === 'CHECKED_OUT' ? 'checked_in' : 'working';
  return { AVAILABLE: 'available', ON_BREAK: 'on_break', AWAY: 'away', CHECKED_OUT: 'checked_out' }[now];
}
