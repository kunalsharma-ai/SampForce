'use client';

import { helpText } from '@dealflow/help';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import {
  ArrowRight,
  CalendarClock,
  Lightbulb,
  PlayCircle,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import {
  helpMediaHref,
  isFaq,
  parseBody,
  useHelpFeedback,
  type ViewFaq,
  type ViewGuide,
} from '@/lib/help-content';
import { type Translator, useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';

export type HelpItem = ViewFaq | ViewGuide;

export function helpItemTitle(item: HelpItem): string {
  return isFaq(item) ? item.q : item.title;
}

export function formatHelpDate(iso: string): string {
  return new Date(iso).toLocaleDateString(fmtLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** "Last updated", so nobody follows a guide without knowing how fresh it is. */
export function UpdatedOn({ iso }: { iso: string }) {
  const t = useT();
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      data-help-updated={iso.slice(0, 10)}
    >
      <CalendarClock className="size-3.5" aria-hidden />
      {t('Last updated {date}', { date: formatHelpDate(iso) })}
    </span>
  );
}

/** An article body from the Console: headings, steps, bullets, tips and pictures. Plain text only, never HTML. */
export function ArticleBody({
  body,
  audience,
}: {
  body: string;
  audience: 'workspace' | 'console';
}) {
  const blocks = parseBody(body);
  if (!blocks.length) return null;
  return (
    <div className="space-y-3 text-sm leading-relaxed" data-help-article-body>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <h3 key={i} className="pt-1 text-base font-semibold text-foreground">
                {b.text}
              </h3>
            );
          case 'steps':
            return (
              <ol key={i} className="space-y-2">
                {b.items.map((s, n) => (
                  <li key={n} className="flex gap-3">
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                      aria-hidden
                    >
                      {n + 1}
                    </span>
                    <span className="pt-0.5">{s}</span>
                  </li>
                ))}
              </ol>
            );
          case 'bullets':
            return (
              <ul key={i} className="list-disc space-y-1 ps-5">
                {b.items.map((s, n) => (
                  <li key={n}>{s}</li>
                ))}
              </ul>
            );
          case 'tip':
            return (
              <p
                key={i}
                className="flex gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3"
              >
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{b.text}</span>
              </p>
            );
          case 'media':
            return (
              <figure key={i} className="overflow-hidden rounded-xl border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API, sized by the uploader */}
                <img
                  src={helpMediaHref(b.id, audience)}
                  alt={b.caption}
                  className="w-full"
                  loading="lazy"
                />
                {b.caption && (
                  <figcaption className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                    {b.caption}
                  </figcaption>
                )}
              </figure>
            );
          default:
            return <p key={i}>{b.text}</p>;
        }
      })}
    </div>
  );
}

export function VideoLink({ url }: { url: string | null }) {
  const t = useT();
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
      data-help-video
    >
      <PlayCircle className="size-4" aria-hidden /> {t('Watch the video')}
    </a>
  );
}

/** "Was this helpful?": Yes or No, and on No a short note on what was missing. The answer can be changed later. */
export function FeedbackBar({
  articleKey,
  mine,
}: {
  articleKey: string;
  mine: boolean | undefined;
}) {
  const t = useT();
  const send = useHelpFeedback();
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState('');
  const [thanked, setThanked] = useState(false);
  useEffect(() => {
    setAsking(false);
    setThanked(false);
    setComment('');
  }, [articleKey]);

  const answer = (helpful: boolean) => {
    if (!helpful) setAsking(true);
    send.mutate({ articleKey, helpful }, { onSuccess: () => setThanked(helpful) });
  };

  return (
    <div
      className="rounded-xl border border-border bg-muted/30 p-3"
      data-help-feedback={articleKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t('Was this helpful?')}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mine === true ? 'default' : 'outline'}
            aria-pressed={mine === true}
            onClick={() => answer(true)}
            disabled={send.isPending}
          >
            <ThumbsUp aria-hidden /> {t('Yes')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mine === false ? 'default' : 'outline'}
            aria-pressed={mine === false}
            onClick={() => answer(false)}
            disabled={send.isPending}
          >
            <ThumbsDown aria-hidden /> {t('No')}
          </Button>
        </div>
      </div>
      {asking && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(
              { articleKey, helpful: false, comment: comment.trim() || null },
              { onSuccess: () => (setAsking(false), setThanked(true)) },
            );
          }}
        >
          <label htmlFor={`feedback-${articleKey}`} className="text-xs text-muted-foreground">
            {t('What was missing or unclear? (optional)')}
          </label>
          <Textarea
            id={`feedback-${articleKey}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={3}
          />
          <Button type="submit" size="sm" disabled={send.isPending}>
            {t('Send feedback')}
          </Button>
        </form>
      )}
      {thanked && !asking && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {t('Thanks, your answer helps us improve this help.')}
        </p>
      )}
      {send.isError && (
        <p className="mt-2 text-xs text-critical" role="alert">
          {(send.error as Error).message}
        </p>
      )}
    </div>
  );
}

/** One answer or guide, opened from a tile, a search result, Popular or Recently updated. */
export function HelpItemDialog({
  item,
  onClose,
  onOpen,
  related,
  audience,
  myFeedback,
}: {
  item: HelpItem | null;
  onClose: () => void;
  onOpen: (item: HelpItem) => void;
  related: HelpItem[];
  audience: 'workspace' | 'console';
  myFeedback: Record<string, boolean>;
}) {
  const t = useT();
  const faq = item && isFaq(item) ? item : null;
  const guide = item && !isFaq(item) ? item : null;
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[8%] max-h-[84vh] max-w-2xl overflow-y-auto p-0">
        {item && (
          <div data-help-guide-dialog={item.id}>
            <div className="border-b border-border bg-gradient-to-br from-primary/15 to-transparent px-6 pb-5 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{faq ? t('Answer') : t('Feature guide')}</Badge>
                <UpdatedOn iso={item.updatedAt} />
              </div>
              <DialogTitle className="mt-2 text-xl font-semibold">
                {helpItemTitle(item)}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">
                {faq ? faq.a : guide!.what}
              </DialogDescription>
            </div>
            <div className="space-y-5 px-6 py-5">
              {guide?.builtin && !guide.body && <Explanation guide={guide} t={t} />}
              <ArticleBody body={item.body} audience={audience} />
              <VideoLink url={item.videoUrl} />
              {guide?.builtin && guide.builtin.sections.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t('Sections on this page')}</h3>
                  <ul className="space-y-3">
                    {guide.builtin.sections.map((s) => (
                      <li key={s.id} className="rounded-xl border border-border bg-muted/30 p-3">
                        <h4 className="text-sm font-medium">{t.maybe(s.topic.title)}</h4>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {helpText(s.topic.what, t.language)}
                        </p>
                        <p className="mt-1 text-sm">{helpText(s.topic.how, t.language)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {guide?.builtin?.href && (
                  <Button asChild>
                    <Link href={guide.builtin.href}>
                      {t('Open page')} <ArrowRight className="rtl:rotate-180" aria-hidden />
                    </Link>
                  </Button>
                )}
              </div>
              {audience === 'workspace' && (
                <FeedbackBar articleKey={item.key} mine={myFeedback[item.key]} />
              )}
              {related.length > 0 && (
                <div data-help-related>
                  <h3 className="mb-2 text-sm font-semibold">{t('Related articles')}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {related.map((r) => (
                      <li key={r.key}>
                        <button
                          type="button"
                          onClick={() => onOpen(r)}
                          className="w-full rounded-xl border border-border p-3 text-start text-sm hover:border-primary/40"
                          data-help-related-item={r.id}
                        >
                          <span className="font-medium">{helpItemTitle(r)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Explanation({ guide, t }: { guide: ViewGuide; t: Translator }) {
  const topic = guide.builtin!.topic;
  const rows: [string, string][] = [
    [t('How to use it'), helpText(topic.how, t.language)],
    [t('Where to use it'), helpText(topic.where, t.language)],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, text]) => (
        <div key={label} className="rounded-xl border border-border p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-primary">{label}</dt>
          <dd className="mt-1 text-sm">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
