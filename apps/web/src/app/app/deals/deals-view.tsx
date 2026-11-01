'use client';

import { CalendarDays, Columns2, GanttChart, HeartPulse, KanbanSquare, LineChart, List, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { DealsBoard } from '@/components/crm/deals-board';
import { RecordList } from '@/components/crm/record-list';
import { Select } from '@/components/crm/select';
import { DealSheet } from '@/components/deals/deal-panel';
import { CalendarView, ForecastView, PriorityView, SplitView, TimelineView } from '@/components/deals/views';
import { usePipelines } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useIsPhone } from '@/lib/use-is-phone';

const VIEWS = [
  { key: 'board', label: 'Board', icon: KanbanSquare },
  { key: 'list', label: 'Table', icon: List },
  { key: 'split', label: 'Split', icon: Columns2 },
  { key: 'timeline', label: 'Timeline', icon: GanttChart },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'forecast', label: 'Forecast', icon: LineChart },
  { key: 'priority', label: 'Priority', icon: Sparkles },
] as const satisfies readonly { key: string; label: MessageKey; icon: unknown }[];
type View = (typeof VIEWS)[number]['key'];
const isView = (v: string | null): v is View => VIEWS.some((x) => x.key === v);
const STORE = 'df-deals-view';

export function DealsView() {
  const router = useRouter();
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const pipelines = usePipelines();
  const view: View = isView(params.get('view')) ? (params.get('view') as View) : 'board';
  const dealId = params.get('deal');
  const pipelineId = params.get('pipeline') ?? undefined;
  const mine = params.get('owner') === 'me';

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  // Reopen the last view used on this device when the URL does not name one.
  useEffect(() => {
    if (params.get('view')) return;
    try {
      const saved = localStorage.getItem(STORE);
      if (isView(saved) && saved !== 'board') setParams({ view: saved });
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (v: View) => {
    try {
      localStorage.setItem(STORE, v);
    } catch {
      /* storage unavailable */
    }
    setParams({ view: v === 'board' ? null : v, ...(v === 'split' ? {} : { deal: null }) });
  };

  const open = (id: string) => setParams({ deal: id });
  const filter = { pipelineId, ownerId: mine ? session?.user.id : undefined };

  const toggle = (
    <div role="group" aria-label={t('View')} className="inline-flex flex-wrap rounded-md border border-border p-0.5">
      {VIEWS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => choose(key)}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-3.5" aria-hidden /> {t(label)}
        </button>
      ))}
    </div>
  );

  const filters =
    view === 'list' ? null : (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(pipelines.data?.length ?? 0) > 1 && (
          <>
            <label htmlFor="deals-pipeline" className="text-xs font-medium text-muted-foreground">
              {t('Pipeline')}
            </label>
            <Select id="deals-pipeline" className="h-8 w-48 text-xs" value={pipelineId ?? (view === 'board' ? pipelines.data?.find((p) => p.isDefault)?.id : '')} onChange={(e) => setParams({ pipeline: e.target.value || null })}>
              {view !== 'board' && <option value="">{t('All pipelines')}</option>}
              {pipelines.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        )}
        {view !== 'board' && (
          <>
            <label htmlFor="deals-owner" className="text-xs font-medium text-muted-foreground">
              {t('Owner')}
            </label>
            <Select id="deals-owner" className="h-8 w-36 text-xs" value={mine ? 'me' : ''} onChange={(e) => setParams({ owner: e.target.value || null })}>
              <option value="">{t('Everyone')}</option>
              <option value="me">{t('Just me')}</option>
            </Select>
          </>
        )}
      </div>
    );

  return (
    <div>
      <RecordList
        entity="deals"
        description="Opportunities across your pipelines. Open any deal in a side panel without leaving the view."
        headerExtra={
          <>
            {toggle}
            <Link href="/app/deals/health" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
              <HeartPulse className="size-3.5" aria-hidden /> {t('Deal health')}
            </Link>
          </>
        }
        hideTable={view !== 'list'}
      />
      {filters}
      {view === 'board' && <DealsBoard pipelineId={pipelineId} onOpen={open} />}
      {view === 'split' && <SplitView filter={filter} selected={dealId} onOpen={open} />}
      {view === 'timeline' && <TimelineView filter={filter} onOpen={open} />}
      {view === 'calendar' && <CalendarView filter={filter} onOpen={open} />}
      {view === 'forecast' && <ForecastView filter={filter} onOpen={open} />}
      {view === 'priority' && <PriorityView filter={filter} onOpen={open} />}
      {/* In split view the deal opens beside the list; on phones (no room) and in other views it slides over. */}
      <DealSheet id={view === 'split' ? null : dealId} onClose={() => setParams({ deal: null })} />
      {view === 'split' && <SplitPhoneSheet id={dealId} onClose={() => setParams({ deal: null })} />}
    </div>
  );
}


function SplitPhoneSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const phone = useIsPhone();
  return <DealSheet id={phone ? id : null} onClose={onClose} />;
}
