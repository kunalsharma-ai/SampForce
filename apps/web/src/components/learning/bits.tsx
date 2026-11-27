'use client';

import {
  ASSIGNMENT_STATUS_LABEL,
  LEARNING_LEVEL_LABEL,
  LEARNING_MATERIAL_LABEL,
  type LearningAssignmentStatus,
  type LearningLevel,
  type LearningMaterialType,
} from '@dealflow/types';
import { Badge, cn } from '@dealflow/ui';
import { FileText, Headphones, Layers, Presentation, Sparkles, Type, Video } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import './learning.css';

/* Small pieces shared by the Learning & Development pages (ADR 0097). */

export const MATERIAL_ICON: Record<LearningMaterialType, typeof Video> = {
  VIDEO: Video,
  DOCUMENT: FileText,
  PRESENTATION: Presentation,
  AUDIO: Headphones,
  TEXT: Type,
  MIXED: Layers,
  NONE: Sparkles,
};

const STATUS_TONE: Record<LearningAssignmentStatus, 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'critical'> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'primary',
  AWAITING_MARKING: 'accent',
  COMPLETED: 'success',
  FAILED: 'critical',
};

export function StatusBadge({ status, overdue }: { status: LearningAssignmentStatus; overdue?: boolean }) {
  const t = useT();
  if (overdue && status !== 'COMPLETED') return <Badge tone="critical">{t('Overdue')}</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{t.maybe(ASSIGNMENT_STATUS_LABEL[status])}</Badge>;
}

export function LevelBadge({ level }: { level: LearningLevel }) {
  const t = useT();
  const tone = level === 'ADVANCED' ? 'critical' : level === 'INTERMEDIATE' ? 'warning' : 'success';
  return <Badge tone={tone}>{t.maybe(LEARNING_LEVEL_LABEL[level])}</Badge>;
}

export function MaterialChip({ type }: { type: LearningMaterialType }) {
  const t = useT();
  const Icon = MATERIAL_ICON[type];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {t.maybe(LEARNING_MATERIAL_LABEL[type])}
    </span>
  );
}

export function CategoryChip({ category }: { category: { name: string; color: string } | null }) {
  const t = useT();
  if (!category) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${category.color}1f`, color: category.color }}>
      <span className="size-1.5 rounded-full" style={{ background: category.color }} aria-hidden />
      {t.maybe(category.name)}
    </span>
  );
}

/** A progress bar with its value said to screen readers. */
export function Bar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={cn('lrn-bar', className)} data-tone={p >= 100 ? 'done' : undefined} role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

/** A ring showing a percentage, with a caption under the number. */
export function Ring({ percent, size = 96, caption, color = '#7c3aed', light = false }: { percent: number | null; size?: number; caption?: string; color?: string; light?: boolean }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke={light ? 'rgba(255,255,255,0.25)' : 'hsl(var(--muted))'} strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={light ? '#fff' : color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: 'stroke-dashoffset 0.9s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className={cn('font-extrabold tabular-nums leading-none', light ? 'text-white' : '')} style={{ fontSize: Math.round(size * 0.22) }}>
            {percent === null ? '—' : `${Math.round(percent)}%`}
          </div>
          {caption && <div className={cn('mt-0.5 text-[10px] font-semibold uppercase tracking-wide', light ? 'text-white/80' : 'text-muted-foreground')}>{caption}</div>}
        </div>
      </div>
    </div>
  );
}

/** A number tile with a coloured icon. */
export function StatTile({ icon: Icon, label, value, hint, from, to }: { icon: typeof Video; label: string; value: string | number; hint?: string; from: string; to: string }) {
  return (
    <div className="lrn-tile flex items-center gap-3" data-stat={label}>
      <span className="lrn-tile-icon shrink-0" style={{ ['--lrn-from' as string]: from, ['--lrn-to' as string]: to }}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-extrabold tabular-nums leading-tight">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground/80">{hint}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon = Sparkles, title, body, action }: { icon?: typeof Video; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed p-10 text-center">
      <span className="lrn-tile-icon mb-3 size-12"><Icon className="size-6" aria-hidden /></span>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** The API's message for a failed call, in the reader's language. */
export function useErrorText() {
  const t = useT();
  return (err: unknown) => (err instanceof ApiError ? t.maybe(err.message) : t('Something went wrong. Please try again.'));
}

export function ErrorLine({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-critical">
      {text(error)}
    </p>
  );
}

export const dateText = (iso: string | null | undefined) => formatDate(iso);

export function dueText(t: ReturnType<typeof useT>, dueAt: string | null, overdue: boolean): string {
  if (!dueAt) return t('No deadline');
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
  if (overdue || days < 0) return t('Overdue since {date}', { date: formatDate(dueAt) });
  if (days === 0) return t('Due today');
  if (days === 1) return t('Due tomorrow');
  if (days <= 7) return t('Due in {n} days', { n: days });
  return t('Due {date}', { date: formatDate(dueAt) });
}

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);
