'use client';

import type { OrgActivityRow } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { Activity, Building2, Download, Eye, FileStack, FileUp, KeyRound, Pencil, RefreshCw, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import * as React from 'react';
import { type MessageKey, useT } from '@/lib/i18n';
import { useOrgActivity } from '@/lib/my-organization';
import { EmptyState, formatDay, HubCard, TONES, type Tone } from './parts';

type Group = 'all' | 'profile' | 'documents' | 'credentials' | 'sharing';
const GROUPS: { key: Group; label: MessageKey }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'profile', label: 'Profile' },
  { key: 'documents', label: 'Documents' },
  { key: 'credentials', label: 'Credentials' },
  { key: 'sharing', label: 'Client sharing' },
];

function groupOf(action: string): Exclude<Group, 'all'> {
  if (action.includes('credential')) return 'credentials';
  if (action.includes('document')) return 'documents';
  if (action.includes('share')) return 'sharing';
  return 'profile';
}

function iconOf(action: string): { icon: typeof Activity; tone: Tone } {
  if (action.endsWith('_deleted') || action.endsWith('logo_removed') || action.endsWith('share_revoked') || action.endsWith('_unapproved')) return { icon: Trash2, tone: 'rose' };
  if (action.endsWith('document_uploaded') || action.endsWith('logo_uploaded')) return { icon: FileUp, tone: 'primary' };
  if (action.endsWith('document_replaced')) return { icon: RefreshCw, tone: 'sky' };
  if (action.endsWith('document_approved')) return { icon: ShieldCheck, tone: 'emerald' };
  if (action.endsWith('document_downloaded')) return { icon: Download, tone: 'slate' };
  if (action.includes('credential')) return { icon: KeyRound, tone: 'violet' };
  if (action.endsWith('share_viewed')) return { icon: Eye, tone: 'teal' };
  if (action.endsWith('.shared')) return { icon: Share2, tone: 'emerald' };
  if (action.includes('profile_created')) return { icon: Building2, tone: 'primary' };
  return { icon: Pencil, tone: 'amber' };
}

/** The full history: every upload, edit, replacement, deletion, reveal and client share, newest first, by day. */
export function ActivityPanel() {
  const t = useT();
  const [limit, setLimit] = React.useState(100);
  const [group, setGroup] = React.useState<Group>('all');
  const activity = useOrgActivity(limit);
  const rows = (activity.data ?? []).filter((r) => group === 'all' || groupOf(r.action) === group);
  const days = React.useMemo(() => {
    const out: { day: string; rows: OrgActivityRow[] }[] = [];
    for (const r of rows) {
      const day = new Date(r.createdAt).toLocaleDateString('en-CA');
      const last = out[out.length - 1];
      if (last?.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);

  return (
    <HubCard title={t('Activity history')} icon={Activity} tone="slate" id="org-activity-all">
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label={t('Show')}>
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
            className={cn('min-h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition', group === g.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {t(g.label)}
          </button>
        ))}
      </div>
      {activity.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-busy />
      ) : activity.isError ? (
        <p className="text-sm text-critical">{t('Could not load the history. Refresh to try again.')}</p>
      ) : days.length === 0 ? (
        <EmptyState icon={FileStack} title={t('Nothing here yet')} text={t('Uploads, edits, replacements, deletions and client shares appear here.')} />
      ) : (
        <div className="space-y-5">
          {days.map(({ day, rows: list }) => (
            <section key={day} aria-label={formatDay(day, t.formatLocale)}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatDay(day, t.formatLocale)}</h3>
              <ol className="relative space-y-3 border-s border-border ps-5">
                {list.map((r) => (
                  <ActivityItem key={r.id} r={r} />
                ))}
              </ol>
            </section>
          ))}
          {(activity.data?.length ?? 0) >= limit && limit < 500 && (
            <button type="button" onClick={() => setLimit((n) => Math.min(500, n + 100))} className="text-sm font-medium text-primary hover:underline">
              {t('Show older activity')}
            </button>
          )}
        </div>
      )}
    </HubCard>
  );
}

function ActivityItem({ r, compact = false }: { r: OrgActivityRow; compact?: boolean }) {
  const t = useT();
  const { icon: Icon, tone } = iconOf(r.action);
  const time = new Date(r.createdAt).toLocaleTimeString(t.formatLocale, { hour: '2-digit', minute: '2-digit' });
  return (
    <li className={cn('relative text-sm', compact && 'flex items-start gap-2.5')}>
      <span className={cn('inline-flex size-7 items-center justify-center rounded-full ring-4 ring-surface', TONES[tone], compact ? 'shrink-0' : 'absolute -start-[1.95rem] top-0')}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="break-words">
          <span className="font-medium">{t.maybe(r.label)}</span>
          {r.subject && <span className="text-foreground"> · {r.subject}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {r.actor?.name ?? (r.action.endsWith('share_viewed') ? t('A client') : t('Someone'))} · {compact ? `${formatDay(new Date(r.createdAt).toLocaleDateString('en-CA'), t.formatLocale)} ${time}` : time}
        </p>
      </div>
    </li>
  );
}

/** The latest few entries, for the overview. */
export function RecentActivity({ limit = 6 }: { limit?: number }) {
  const t = useT();
  const activity = useOrgActivity(limit);
  if (activity.isPending) return <div className="h-32 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-busy />;
  const rows = activity.data ?? [];
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t('Uploads, edits, replacements, deletions and client shares appear here.')}</p>;
  return (
    <ol className="space-y-3">
      {rows.map((r) => (
        <ActivityItem key={r.id} r={r} compact />
      ))}
    </ol>
  );
}

