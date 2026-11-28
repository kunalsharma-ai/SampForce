'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@dealflow/ui';
import { Tabs } from '@/components/revenue/tabs';
import { useT } from '@/lib/i18n';
import { useRecognitionView } from '@/lib/recognition';
import { PlansBoard } from './plans-board';
import { RecognitionBoard, RecognitionSettings } from './recognition-board';
import './recognition.css';

type Tab = 'eom' | 'plans' | 'settings';

/** The Recognition page (ADR 0102): Employee of the Month, improvement plans and, for the Super Workspace, the rules. `?plan=` opens a plan. */
export function RecognitionTabs() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const view = useRecognitionView(null);
  const plan = params.get('plan');
  const asked = params.get('tab');
  const canSettings = !!view.data?.canEditPolicy;
  const tab: Tab = asked === 'plans' || plan ? 'plans' : asked === 'settings' && canSettings ? 'settings' : 'eom';
  const go = (next: Tab, planId: string | null = null) => {
    const q = new URLSearchParams();
    if (next !== 'eom') q.set('tab', next);
    if (planId) q.set('plan', planId);
    const s = q.toString();
    router.replace(s ? `/app/recognition?${s}` : '/app/recognition', { scroll: false });
  };
  return (
    <div>
      <Tabs
        label={t('Recognition')}
        value={tab}
        onChange={(k) => go(k)}
        tabs={[
          { key: 'eom', label: t('Employee of the Month – targets and winners') },
          { key: 'plans', label: t('Improvement plans') },
          ...(canSettings ? [{ key: 'settings' as const, label: t('Rules') }] : []),
        ]}
      />
      {tab === 'plans' ? (
        <PlansBoard openPlan={plan} onOpenPlan={(id) => go('plans', id)} />
      ) : tab === 'settings' ? (
        view.data ? <RecognitionSettings policy={view.data.policy} /> : <Skeleton className="h-64" />
      ) : (
        <RecognitionBoard />
      )}
    </div>
  );
}
