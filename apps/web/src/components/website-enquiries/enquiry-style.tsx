'use client';

import type { EnquiryStatus, EnquiryType } from '@dealflow/types';
import { BookOpen, Briefcase, Download, FileDown, Mail, MessageSquareText, MessagesSquare, Star } from 'lucide-react';
import type * as React from 'react';
import { useT } from '@/lib/i18n';

/** Each kind of arrival keeps one icon and one colour everywhere on the page. */
export const TYPE_STYLE: Record<EnquiryType, { icon: React.ComponentType<{ className?: string }>; tile: string; text: string; bar: string }> = {
  enquiry: { icon: MessageSquareText, tile: 'from-sky-500 to-indigo-500', text: 'text-sky-700 dark:text-sky-300', bar: 'bg-sky-500' },
  download: { icon: Download, tile: 'from-emerald-500 to-teal-500', text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  'resource-download': { icon: FileDown, tile: 'from-teal-500 to-cyan-500', text: 'text-teal-700 dark:text-teal-300', bar: 'bg-teal-500' },
  'case-study-download': { icon: BookOpen, tile: 'from-cyan-500 to-blue-500', text: 'text-cyan-700 dark:text-cyan-300', bar: 'bg-cyan-500' },
  chat: { icon: MessagesSquare, tile: 'from-violet-500 to-fuchsia-500', text: 'text-violet-700 dark:text-violet-300', bar: 'bg-violet-500' },
  newsletter: { icon: Mail, tile: 'from-amber-500 to-orange-500', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500' },
  review: { icon: Star, tile: 'from-yellow-400 to-amber-500', text: 'text-yellow-700 dark:text-yellow-300', bar: 'bg-yellow-500' },
  careers: { icon: Briefcase, tile: 'from-rose-500 to-pink-500', text: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500' },
};

export const STATUS_TONE: Record<EnquiryStatus, string> = {
  new: 'bg-sky-500/15 text-sky-800 ring-sky-500/40 dark:text-sky-200',
  contacted: 'bg-violet-500/15 text-violet-800 ring-violet-500/40 dark:text-violet-200',
  qualified: 'bg-amber-500/15 text-amber-800 ring-amber-500/40 dark:text-amber-200',
  won: 'bg-emerald-500/15 text-emerald-800 ring-emerald-500/40 dark:text-emerald-200',
  lost: 'bg-slate-500/15 text-slate-700 ring-slate-500/40 dark:text-slate-200',
  spam: 'bg-rose-500/15 text-rose-800 ring-rose-500/40 dark:text-rose-200',
};


/** The glowing badge on an enquiry nobody has opened yet. */
export function NewPill() {
  const t = useT();
  return (
    <span className="relative inline-flex items-center rounded-full bg-gradient-to-r from-primary to-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.6)]">
      {t('New')}
    </span>
  );
}

