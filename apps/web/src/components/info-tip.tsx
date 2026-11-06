'use client';

import { cn, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import { Info } from 'lucide-react';
import { useId } from 'react';
import { type HelpId, helpText, helpTopic } from '@/lib/help';
import { useT } from '@/lib/i18n';

/**
 * The "i" button beside a page title, section heading or setting. Pressing it (or Enter/Space when focused) opens a
 * short explanation: what the feature is for, how to use it, and where or when it helps. Escape or a click outside
 * closes it and focus returns to the button. The button sits next to its heading, never inside it, so the heading's
 * accessible name stays the heading text. Its own name is the same short question everywhere; which feature it is
 * about comes from the `title`, read as its description ("What is this?, button, About Deals") and shown on hover.
 * Keeping the feature name out of the accessible name keeps label lookups such as "Language" unambiguous.
 */
export function InfoTip({ topic, className, defaultOpen }: { topic: HelpId; className?: string; defaultOpen?: boolean }) {
  const t = useT();
  const titleId = useId();
  const h = helpTopic(topic);
  const title = t.maybe(h.title);
  const parts = [
    [t('What it is for'), h.what],
    [t('How to use it'), h.how],
    [t('Where to use it'), h.where],
  ] as const;
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('What is this?')}
          title={t('About {topic}', { topic: title })}
          data-help-topic={topic}
          className={cn(
            'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-primary',
            className,
          )}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId} className="space-y-3" align="start">
        <p id={titleId} className="flex items-center gap-2 font-semibold">
          <Info className="size-4 text-primary" aria-hidden />
          {title}
        </p>
        <dl className="space-y-2.5">
          {parts.map(([label, text]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 leading-relaxed">{helpText(text, t.language)}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

