import { type AchievementRow, TARGET_METRIC_LABEL, type TargetMetric } from '@dealflow/types';
import type { Translator } from '@/lib/i18n';

/** What a celebration says: every figure comes from the stored achievement, which was read from the records. */
export interface AchievementCopy {
  title: string;
  message: string;
  facts: { label: string; value: string }[];
  /** A gentle extra line (the consistency card's reminder that breaks are part of good work). */
  note?: string;
  linkLabel: string;
}

function money(amount: number | null | undefined, currency: string | null | undefined, locale: string): string | null {
  if (amount === null || amount === undefined || !currency) return null;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatAchievedAt(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function hours(minutes: number, t: Translator): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return t('{h} h {m} min', { h, m });
}

export function achievementCopy(a: AchievementRow, t: Translator): AchievementCopy {
  const d = a.details;
  const loc = t.formatLocale;
  const num = (n: number | undefined) => new Intl.NumberFormat(loc).format(n ?? 0);
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) facts.push({ label, value });
  };
  const when = formatAchievedAt(a.achievedAt, loc);

  switch (a.kind) {
    case 'DEAL_CONVERTED':
    case 'PROSPECT_CONVERTED':
      add(t('Company'), d.companyName);
      add(t('Deal'), d.dealNumber ? `${d.dealNumber} · ${d.dealName ?? ''}` : d.dealName);
      add(t('Deal value'), money(d.amount, d.currency, loc));
      add(t('Pipeline stage'), d.stage ? t.maybe(d.stage) : null);
      add(t('Achieved'), when);
      return a.kind === 'DEAL_CONVERTED'
        ? { title: t('Company converted into a deal!'), message: t('Congratulations! You’ve successfully converted a new company into a deal!'), facts, linkLabel: t('View deal') }
        : { title: t('Prospect converted!'), message: t('Your lead is now a deal in the pipeline.'), facts, linkLabel: t('View deal') };
    case 'RFQ_SUBMITTED':
      add(t('Company'), d.companyName);
      add(t('RFQ'), d.rfqNumber ? `${d.rfqNumber} · ${d.rfqTitle ?? ''}` : d.rfqTitle);
      add(t('SampBidx reference'), d.reference);
      add(t('Submitted'), when);
      return { title: t('RFQ Successfully Submitted!'), message: t('Another opportunity is now in motion.'), facts, linkLabel: t('View RFQ') };
    case 'TASK_IMPORTANT':
      add(t('Company'), d.companyName);
      return { title: d.followUp ? t('Client follow-up completed') : t('High-priority task completed'), message: d.taskTitle ?? '', facts, linkLabel: d.followUp ? t('View follow-ups') : t('View tasks') };
    case 'ALL_TASKS_DONE':
      add(t('Tasks done today'), num(d.tasksDone));
      add(t('Deadlines'), d.onTime ? t('All done before their deadlines') : t('All done'));
      return { title: t('All Tasks Completed!'), message: t('You’ve successfully cleared your daily workload.'), facts, linkLabel: t('View tasks') };
    case 'LEAD_MILESTONE':
      add(t('Leads today'), t('{actual} of {target}', { actual: num(d.actual), target: num(d.target) }));
      add(t('Still to go'), num(d.remaining));
      return { title: t('{percent}% of today’s lead target', { percent: d.percent ?? 0 }), message: t('Keep going: {remaining} more qualified leads reach your target.', { remaining: num(d.remaining) }), facts, linkLabel: t('View my achievements') };
    case 'LEAD_TARGET': {
      add(t('Target'), num(d.target));
      add(t('Valid leads added'), num(d.actual));
      add(t('Achieved'), when);
      const title = d.period === 'WEEK' ? t('Weekly Lead Target Achieved!') : d.period === 'MONTH' ? t('Monthly Lead Target Achieved!') : t('Daily Lead Target Achieved!');
      return { title, message: t('You’ve successfully reached your target of {target} qualified leads.', { target: num(d.target) }), facts, linkLabel: t('View my achievements') };
    }
    case 'SALES_TARGET': {
      const value = (n: number | undefined) => (d.metric === 'REVENUE' ? (money(n, d.currency, loc) ?? num(n)) : t('{n} deals won', { n: num(n) }));
      add(t('Target'), value(d.target));
      add(t('Actual'), value(d.actual));
      add(t('Deal'), d.dealName);
      add(t('Achieved'), when);
      const quarter = d.period === 'QUARTER';
      return {
        title: t('Sales Target Achieved!'),
        message: quarter ? t('You’ve successfully reached {percent}% of your quarterly sales target.', { percent: Math.floor(d.percent ?? 100) }) : t('You’ve successfully reached {percent}% of your monthly sales target.', { percent: Math.floor(d.percent ?? 100) }),
        facts,
        linkLabel: t('View my achievements'),
      };
    }
    case 'DEALS_WON_MILESTONE':
      add(t('Deal'), d.dealName);
      add(t('Deal value'), money(d.amount, d.currency, loc));
      add(t('Achieved'), when);
      return d.count === 1
        ? { title: t('Your first won deal!'), message: t('The first of many. Well done!'), facts, linkLabel: t('View deal') }
        : { title: t('{n} deals won!', { n: num(d.count) }), message: t('A milestone worth celebrating.'), facts, linkLabel: t('View deal') };
    case 'MAJOR_DEAL':
      add(t('Deal'), d.dealName);
      add(t('Company'), d.companyName);
      add(t('Deal value'), money(d.amount, d.currency, loc));
      add(t('Your previous best'), money(d.previousBest, d.currency, loc));
      return {
        title: t('Major deal closed!'),
        message: d.previousBest !== null && d.previousBest !== undefined && (d.amount ?? 0) > d.previousBest ? t('Your biggest win yet.') : t('An exceptional win.'),
        facts,
        linkLabel: t('View deal'),
      };
    case 'TASK_PLAN_DONE': {
      for (const i of d.items ?? []) add(t.maybe(TARGET_METRIC_LABEL[i.metric as TargetMetric] ?? i.metric), t('{actual} of {target}', { actual: num(i.done), target: num(i.amount) }));
      if ((d.streak ?? 0) > 1) add(t('Streak'), t('{n} in a row', { n: num(d.streak) }));
      const first = d.items?.[0];
      const one = d.items?.length === 1 && first ? t.maybe(TARGET_METRIC_LABEL[first.metric as TargetMetric] ?? first.metric).toLowerCase() : null;
      return {
        title: d.cadence === 'WEEK' ? t('This week’s task completed!') : d.cadence === 'MONTH' ? t('This month’s task completed!') : t('Today’s task completed!'),
        message: one ? t('Great work! You completed your {measure} target: {title}.', { measure: one, title: d.taskTitle ?? '' }) : t('Great work! You achieved 100% of {title}.', { title: d.taskTitle ?? '' }),
        facts,
        linkLabel: t('View tasks'),
      };
    }
    case 'TASK_PLAN_HALF':
      for (const i of d.items ?? []) add(t.maybe(TARGET_METRIC_LABEL[i.metric as TargetMetric] ?? i.metric), t('{actual} of {target}', { actual: num(i.done), target: num(i.amount) }));
      return { title: t('Halfway there!'), message: t('{title} is {percent}% done. Keep going.', { title: d.taskTitle ?? '', percent: d.percent ?? 50 }), facts, linkLabel: t('View tasks') };
    case 'CONSISTENCY':
      add(t('Working time'), hours(d.workedMinutes ?? 0, t));
      add(t('Breaks taken'), d.breaks ? t('{n} ({time})', { n: num(d.breaks), time: hours(d.breakMinutes ?? 0, t) }) : t('None'));
      add(t('Tasks done today'), num(d.tasksDone));
      return {
        title: t('Outstanding Consistency!'),
        message: t('You’ve completed your scheduled work without an unplanned interruption.'),
        note: d.breaks ? t('Your breaks were part of a healthy day.') : t('Remember to take your breaks too: rest is part of great work.'),
        facts,
        linkLabel: t('View my achievements'),
      };
  }
}
