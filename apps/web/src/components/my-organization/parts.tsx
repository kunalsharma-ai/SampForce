'use client';

import type { OrgDocumentCategory, OrgExpiryStatus } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import {
  Award,
  BadgeCheck,
  Banknote,
  Building2,
  Check,
  Copy,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  type LucideIcon,
  Palette,
  Presentation,
  Receipt,
  Scale,
  ShieldCheck,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { type MessageKey, useT } from '@/lib/i18n';

/** A card of the hub: a soft coloured icon, a title, and its content. */
export function HubCard({
  title,
  icon: Icon,
  tone = 'primary',
  action,
  children,
  className,
  id,
}: {
  title: string;
  icon: LucideIcon;
  tone?: Tone;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('rounded-2xl border border-border bg-surface p-5 shadow-sm', className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-2.5 text-base font-semibold">
          <span className={cn('inline-flex size-8 items-center justify-center rounded-xl', TONES[tone])}>
            <Icon className="size-4" aria-hidden />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export type Tone = 'primary' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate' | 'teal';
export const TONES: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
};

/** Copies a value, saying so for a moment (and to screen readers). */
export function CopyButton({ value, label, className, compact = false }: { value: string; label: string; className?: string; compact?: boolean }) {
  const t = useT();
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setDone(true), () => setDone(false));
      }}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background/70 px-2 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        done && 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
        className,
      )}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {!compact && <span>{done ? t('Copied') : t('Copy')}</span>}
      <span className="sr-only" role="status">
        {done ? t('Copied') : ''}
      </span>
    </button>
  );
}

/** The file's kind as a coloured tile: PDF red, images violet, sheets green, slides orange, Word blue. */
export function FileTypeIcon({ contentType, fileName, size = 'md' }: { contentType: string; fileName: string; size?: 'sm' | 'md' | 'lg' }) {
  const ext = (fileName.split('.').pop() ?? '').slice(0, 4).toUpperCase();
  const kind = fileKind(contentType);
  const { icon: Icon, tone } = FILE_KINDS[kind];
  const box = size === 'lg' ? 'size-14 rounded-2xl' : size === 'sm' ? 'size-9 rounded-lg' : 'size-11 rounded-xl';
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center text-white shadow-sm', box)} style={{ backgroundImage: tone }} aria-hidden>
      <Icon className={size === 'lg' ? 'size-6' : 'size-5'} />
      {ext && <span className="absolute -bottom-1 rounded bg-background px-1 font-mono text-[0.55rem] font-bold leading-tight text-foreground shadow ring-1 ring-border">{ext}</span>}
    </span>
  );
}

type FileKind = 'pdf' | 'image' | 'sheet' | 'slides' | 'word' | 'text' | 'zip';
function fileKind(type: string): FileKind {
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') return 'sheet';
  if (type.includes('presentation') || type.includes('powerpoint')) return 'slides';
  if (type.includes('word')) return 'word';
  if (type === 'application/zip') return 'zip';
  return 'text';
}
const FILE_KINDS: Record<FileKind, { icon: LucideIcon; tone: string }> = {
  pdf: { icon: FileText, tone: 'linear-gradient(135deg,#ef4444,#b91c1c)' },
  image: { icon: FileImage, tone: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' },
  sheet: { icon: FileSpreadsheet, tone: 'linear-gradient(135deg,#10b981,#047857)' },
  slides: { icon: Presentation, tone: 'linear-gradient(135deg,#f97316,#c2410c)' },
  word: { icon: FileType2, tone: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' },
  text: { icon: FileText, tone: 'linear-gradient(135deg,#64748b,#334155)' },
  zip: { icon: FileArchive, tone: 'linear-gradient(135deg,#eab308,#a16207)' },
};

/** Each document category's icon and colour, the same everywhere in the hub. */
export const CATEGORY_STYLE: Record<OrgDocumentCategory, { icon: LucideIcon; tone: Tone }> = {
  registration: { icon: Building2, tone: 'primary' },
  tax: { icon: Receipt, tone: 'amber' },
  certification: { icon: Award, tone: 'emerald' },
  membership: { icon: BadgeCheck, tone: 'sky' },
  credential: { icon: ShieldCheck, tone: 'violet' },
  presentation: { icon: Presentation, tone: 'rose' },
  service_profile: { icon: Users, tone: 'teal' },
  legal: { icon: Scale, tone: 'slate' },
  financial: { icon: Banknote, tone: 'emerald' },
  brand: { icon: Palette, tone: 'violet' },
  other: { icon: FileText, tone: 'slate' },
};

/** Where a document's expiry stands, as a small coloured chip. Nothing for documents that never expire. */
export function ExpiryBadge({ expiry, daysLeft, expiryDate }: { expiry: OrgExpiryStatus; daysLeft: number | null; expiryDate: string | null }) {
  const t = useT();
  if (expiry === 'none' || !expiryDate) return null;
  const style =
    expiry === 'expired'
      ? 'bg-rose-500/15 text-rose-700 ring-rose-500/40 dark:text-rose-300'
      : expiry === 'expiring'
        ? 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-300'
        : 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300';
  const text =
    expiry === 'expired'
      ? t('Expired {date}', { date: formatDay(expiryDate, t.formatLocale) })
      : expiry === 'expiring'
        ? daysLeft === 0
          ? t('Expires today')
          : t('Expires in {count} days', { count: daysLeft ?? 0 })
        : t('Valid until {date}', { date: formatDay(expiryDate, t.formatLocale) });
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1', style)}>{text}</span>;
}

export function formatDay(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatWhen(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** A ring that fills with the profile's completeness. */
export function CompletenessRing({ value, size = 72 }: { value: number; size?: number }) {
  const t = useT();
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const colour = value >= 80 ? '#10b981' : value >= 50 ? '#f59e0b' : '#f43f5e';
  return (
    <div className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label={t('Profile {value}% complete', { value })}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} stroke={colour} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * value) / 100} className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums" aria-hidden>
        {value}%
      </span>
    </div>
  );
}

/** A calm empty state with an icon, a sentence and an optional action. */
export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-background/50 px-6 py-10 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="font-semibold">{title}</p>
      {text && <p className="max-w-md text-sm text-muted-foreground">{text}</p>}
      {action}
    </div>
  );
}

/** A labelled value in a definition list; nothing when there is no value. */
export function Fact({ label, children }: { label: MessageKey; children: React.ReactNode }) {
  const t = useT();
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(label)}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}
