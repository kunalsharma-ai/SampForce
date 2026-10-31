import type { DealHealth, LeadQualification, Signal } from '@dealflow/types';

/**
 * Explainable, rule-based signals. They run without any AI provider; the model only writes the
 * summary or next step on top of them, so a score never depends on model output.
 */
export const SCORING_VERSION = 'signals-v2';

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY);

export interface LeadFacts {
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyName: string | null;
  industry: string | null;
  estimatedValue: number | null;
  source: string | null;
  status: string;
  activityDates: Date[];
}

const SENIOR = /\b(chief|ceo|cto|cfo|coo|cmo|cro|vp|vice[- ]president|head|director|founder|co-founder|owner|president|partner)\b/i;
const MANAGER = /\b(manager|lead|principal)\b/i;

export function scoreLead(f: LeadFacts, now = new Date()): Omit<LeadQualification, 'summary' | 'suggestedNextStep' | 'summaryUnavailable'> {
  const signals: Signal[] = [];
  const add = (key: string, label: string, points: number, detail: string) => signals.push({ key, label, points, detail });

  if (f.email) add('email', 'Has an email address', 10, f.email);
  if (f.phone) add('phone', 'Has a phone number', 5, 'Phone on file');
  if (f.jobTitle && SENIOR.test(f.jobTitle)) add('seniority', 'Senior decision maker', 15, f.jobTitle);
  else if (f.jobTitle && MANAGER.test(f.jobTitle)) add('seniority', 'Manager-level contact', 8, f.jobTitle);
  else if (f.jobTitle) add('title', 'Job title known', 3, f.jobTitle);
  if (f.companyName) add('company', 'Company known', 5, f.companyName);
  if (f.industry) add('industry', 'Industry known', 5, f.industry);

  const value = f.estimatedValue ?? 0;
  if (value >= 50_000) add('value', 'High estimated value', 20, `Estimated ${value}`);
  else if (value >= 10_000) add('value', 'Medium estimated value', 12, `Estimated ${value}`);
  else if (value > 0) add('value', 'Estimated value recorded', 5, `Estimated ${value}`);

  const source = (f.source ?? '').toLowerCase();
  if (/referr|partner/.test(source)) add('source', 'Referral or partner source', 10, f.source!);
  else if (/inbound|website|web|demo|contact form/.test(source)) add('source', 'Inbound source', 6, f.source!);
  else if (/event|webinar|conference/.test(source)) add('source', 'Event source', 5, f.source!);

  const recent = f.activityDates.filter((d) => daysBetween(now, d) <= 30).length;
  if (recent > 0) add('engagement', 'Recent activity', Math.min(15, recent * 5), `${recent} in the last 30 days`);
  else if (f.activityDates.length === 0) add('no_activity', 'No activity logged yet', 0, 'Nothing logged');

  if (f.status === 'DISQUALIFIED') add('disqualified', 'Marked disqualified', -40, 'Status is Disqualified');

  const score = Math.max(0, Math.min(100, signals.reduce((s, x) => s + x.points, 0)));
  const grade = score >= 75 ? 'A' : score >= 50 ? 'B' : score >= 25 ? 'C' : 'D';
  return { score, grade, signals };
}

export interface DealFacts {
  status: string;
  amount: number;
  expectedCloseDate: Date | null;
  createdAt: Date;
  stageEnteredAt: Date | null;
  lastActivityAt: Date | null;
  openTasks: number;
  overdueTasks: number;
  hasContact: boolean;
  /** Engagement (signals-v2). Optional so callers without email data still score; missing means "not known". */
  engagement?: {
    /** Activities logged plus emails exchanged with the deal's people, last 14 days and the 14 before. */
    touches14: number;
    touchesPrev14: number;
    /** Last email received from and sent to the deal's people. */
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    /** Distinct people at the buyer who wrote, met or were logged against, last 30 days and the 30 before. */
    people30: number;
    peoplePrev30: number;
  };
}

export function dealHealth(f: DealFacts, now = new Date()): Omit<DealHealth, 'nextStep' | 'nextStepUnavailable'> {
  const signals: Signal[] = [];
  const risk = (key: string, label: string, points: number, detail: string) => signals.push({ key, label, points: -points, detail });

  if (f.status !== 'OPEN') return { health: 100, risk: 'low', signals: [{ key: 'closed', label: `Deal is ${f.status.toLowerCase()}`, points: 0, detail: 'Closed deals are not scored' }] };

  if (!f.lastActivityAt) risk('no_activity', 'No activity logged', 25, 'Nothing has been logged on this deal');
  else {
    const idle = daysBetween(now, f.lastActivityAt);
    if (idle >= 30) risk('stale', 'No activity for 30+ days', 30, `Last activity ${idle} days ago`);
    else if (idle >= 14) risk('quiet', 'No activity for 14+ days', 20, `Last activity ${idle} days ago`);
  }
  if (!f.expectedCloseDate) risk('no_close_date', 'No expected close date', 10, 'Add a close date to forecast this deal');
  else if (f.expectedCloseDate.getTime() < now.getTime() - DAY) {
    risk('close_date_passed', 'Close date has passed', 25, `Expected ${f.expectedCloseDate.toISOString().slice(0, 10)}`);
  }
  const inStage = daysBetween(now, f.stageEnteredAt ?? f.createdAt);
  if (inStage > 30) risk('stuck', 'Long time in current stage', 15, `${inStage} days in this stage`);
  if (f.overdueTasks > 0) risk('overdue_tasks', 'Overdue tasks', 10, `${f.overdueTasks} overdue`);
  else if (f.openTasks === 0) risk('no_next_step', 'No open task', 10, 'No next step is scheduled');
  if (!f.hasContact) risk('no_contact', 'No contact linked', 5, 'Link the main buyer');
  if (f.amount <= 0) risk('no_amount', 'No amount', 5, 'Amount is 0');
  const e = f.engagement;
  if (e) {
    if (e.touchesPrev14 >= 3 && e.touches14 * 2 <= e.touchesPrev14) {
      risk('declining_engagement', 'Engagement is declining', 10, `${e.touches14} touches in the last 14 days, ${e.touchesPrev14} in the 14 before`);
    }
    if (e.lastOutboundAt && (!e.lastInboundAt || e.lastInboundAt < e.lastOutboundAt)) {
      const waiting = daysBetween(now, e.lastOutboundAt);
      if (waiting >= 7) risk('buyer_silent', 'Buyer has not replied', 10, `Your last email was ${waiting} days ago with no answer`);
    }
    if (e.peoplePrev30 >= 2 && e.people30 < e.peoplePrev30) {
      risk('fewer_stakeholders', 'Fewer people involved', 5, `${e.people30} people engaged in the last 30 days, ${e.peoplePrev30} in the 30 before`);
    }
  }

  const health = Math.max(0, 100 + signals.reduce((s, x) => s + x.points, 0));
  return { health, risk: health >= 70 ? 'low' : health >= 40 ? 'medium' : 'high', signals };
}
