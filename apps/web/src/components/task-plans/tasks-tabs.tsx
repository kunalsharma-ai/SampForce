'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from '@/components/revenue/tabs';
import { TasksBoard } from '@/components/workspace-work/tasks';
import { useT } from '@/lib/i18n';
import { RecurringTasks } from './task-plans';

type Tab = 'today' | 'recurring' | 'oneoff';

/**
 * The Tasks page (ADR 0096): today's recurring tasks first, then the recurring tasks themselves, then the one-off
 * tasks of ADR 0071. `?task=` opens a one-off task, `?plan=` opens a recurring one.
 */
export function TasksTabs() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const plan = params.get('plan');
  const asked = params.get('tab');
  const tab: Tab = asked === 'recurring' || asked === 'oneoff' || asked === 'today' ? asked : params.get('task') ? 'oneoff' : plan ? 'recurring' : 'today';
  const go = (next: Tab, planId: string | null = null) => {
    const q = new URLSearchParams();
    if (next !== 'today') q.set('tab', next);
    if (planId) q.set('plan', planId);
    const s = q.toString();
    router.replace(s ? `/app/tasks?${s}` : '/app/tasks', { scroll: false });
  };
  return (
    <div>
      <Tabs
        label={t('Tasks')}
        value={tab}
        onChange={(k) => go(k)}
        tabs={[
          { key: 'today', label: t('Today') },
          { key: 'recurring', label: t('Recurring tasks') },
          { key: 'oneoff', label: t('One-off tasks') },
        ]}
      />
      {tab === 'oneoff' ? <TasksBoard /> : <RecurringTasks tab={tab === 'today' ? 'today' : 'plans'} openPlan={plan} onOpenPlan={(id) => go(tab, id)} />}
    </div>
  );
}
