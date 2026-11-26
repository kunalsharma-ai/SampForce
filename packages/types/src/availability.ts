import { z } from 'zod';
import type { WorkspaceLevel } from './workspaces';

/*
 * Working status (redesign R1, ADR 0081). Each person checks in, takes breaks, resumes and checks out from the
 * header; SampForce records every step and works out break and working time. The status is shown in the header and
 * to the people allowed to see it: the Super Workspace sees everyone, a manager its team, an executive themself (and
 * their team mates when the manager lets them chat with peers).
 */

export const AVAILABILITY_STATUSES = ['AVAILABLE', 'WORKING', 'ON_BREAK', 'AWAY', 'CHECKED_OUT'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  WORKING: 'Working',
  ON_BREAK: 'On break',
  AWAY: 'Away',
  CHECKED_OUT: 'Checked out',
};

/** The statuses a checked-in person may pick by hand (breaks have their own buttons; Away also comes by itself). */
export const CHOOSABLE_STATUSES = ['AVAILABLE', 'WORKING', 'AWAY'] as const;
export type ChoosableStatus = (typeof CHOOSABLE_STATUSES)[number];

/** A checked-in person with no SampForce page open for this long shows as Away. */
export const AUTO_AWAY_MS = 10 * 60_000;
/** The header refreshes the person's presence this often while a page is open. */
export const AVAILABILITY_BEAT_MS = 60_000;
/** A session left open this long (someone forgot to check out) is closed at the person's last sign of life. */
export const STALE_SESSION_MS = 18 * 60 * 60_000;

export const AVAILABILITY_EVENT_KINDS = ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'STATUS', 'CHECK_OUT', 'AUTO_CHECK_OUT'] as const;
export type AvailabilityEventKind = (typeof AVAILABILITY_EVENT_KINDS)[number];

export const availabilityStatusSchema = z.object({ status: z.enum(CHOOSABLE_STATUSES) }).strict();
export type AvailabilityStatusInput = z.infer<typeof availabilityStatusSchema>;

export const availabilityTeamQuerySchema = z.object({ workspaceId: z.string().uuid().optional() }).strict();

/** One break of today's session. `end` is null while it is running. */
export interface AvailabilityBreak {
  start: string;
  end: string | null;
}

/** Today's working session (from check-in to check-out). */
export interface WorkSessionView {
  id: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  breaks: AvailabilityBreak[];
  /** Whole minutes on break so far, the running break included. */
  breakMinutes: number;
  /** Whole minutes worked so far: from check-in to now (or check-out), less breaks. */
  workedMinutes: number;
}

/** What the header shows for the signed-in person. */
export interface AvailabilityMe {
  status: AvailabilityStatus;
  /** When the current status began (check-in, the break's start, the last change); null when never checked in. */
  since: string | null;
  /** True when Away comes from no open page, not a choice. */
  autoAway: boolean;
  /** The open session, or the last one closed today. */
  session: WorkSessionView | null;
}

/** A person as the team status board shows them. */
export interface AvailabilityPerson {
  userId: string;
  name: string;
  photoUrl: string | null;
  workspace: { id: string; name: string; level: WorkspaceLevel } | null;
  status: AvailabilityStatus;
  since: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  isMe: boolean;
}

export interface AvailabilityTeam {
  people: AvailabilityPerson[];
  counts: Record<AvailabilityStatus, number>;
  /** Which people the caller may see: everyone, one team, or only themself (and their team mates). */
  scope: 'ORGANISATION' | 'TEAM' | 'SELF';
}

export interface SessionTimes {
  checkedInAt: Date;
  checkedOutAt: Date | null;
  breaks: { start: Date; end: Date | null }[];
}

/** Minutes on break and minutes worked in a session, counted up to `now` while it is open. */
export function sessionMinutes(s: SessionTimes, now: Date = new Date()): { breakMinutes: number; workedMinutes: number } {
  const end = s.checkedOutAt ?? now;
  let breakMs = 0;
  for (const b of s.breaks) {
    const bEnd = b.end ?? end;
    breakMs += Math.max(0, Math.min(bEnd.getTime(), end.getTime()) - b.start.getTime());
  }
  const total = Math.max(0, end.getTime() - s.checkedInAt.getTime());
  return { breakMinutes: Math.floor(breakMs / 60_000), workedMinutes: Math.floor(Math.max(0, total - breakMs) / 60_000) };
}

/**
 * The status shown for a session: Checked out without an open one, On break during a break, Away when the person
 * chose it or has had no page open for AUTO_AWAY_MS, else the status they chose (Working by default).
 */
export function effectiveStatus(
  s: { checkedOutAt: Date | null; breaks: { end: Date | null }[]; chosen: string; lastSeenAt: Date } | null,
  now: Date = new Date(),
): { status: AvailabilityStatus; autoAway: boolean } {
  if (!s || s.checkedOutAt) return { status: 'CHECKED_OUT', autoAway: false };
  if (s.breaks.some((b) => !b.end)) return { status: 'ON_BREAK', autoAway: false };
  if (s.chosen === 'AWAY') return { status: 'AWAY', autoAway: false };
  if (now.getTime() - s.lastSeenAt.getTime() > AUTO_AWAY_MS) return { status: 'AWAY', autoAway: true };
  return { status: s.chosen === 'AVAILABLE' ? 'AVAILABLE' : 'WORKING', autoAway: false };
}

/** "2 h 05 min", "45 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
