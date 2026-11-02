'use client';

import { Badge, Button, Card, CardContent, Input, Skeleton } from '@dealflow/ui';
import {
  BID_TEMPLATES,
  bidTemplate,
  bidTemplateKeySchema,
  bidAccentSchema,
  lineTotals,
  quoteTotals,
  type DealRow,
  type ProposalSection,
  type QuoteRow,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Download, Eye, EyeOff, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccentPicker } from '@/components/bids/accent-picker';
import { previewProposal, ProposalPreview, TemplateThumb, type PreviewLine } from '@/components/bids/bid-preview';
import { RecordPicker, type PickerValue } from '@/components/crm/record-picker';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { ProposalSharing } from '../[id]/proposal-panel';
import { api, downloadFile } from '@/lib/api';
import {
  formatAmount,
  QUOTE_STATUS,
  useCommercialSettings,
  usePriceBooks,
  useProducts,
  useTaxRates,
} from '@/lib/revenue';
import { useSession } from '@/lib/session';
import { useT } from '@/lib/i18n';

/**
 * Design spec Part 6: Quick Bid Studio. Four steps (client, template, items and pricing, review and send)
 * beside a live preview of the customer's proposal. Before the quote exists the draft is kept on this
 * device; once it exists every valid change is saved to the quote after a short pause.
 */

const STEPS = ['Client', 'Template', 'Items and pricing', 'Review and send'] as const;
const STORE = 'df-quick-bid';
const SAVE_DELAY = 800;

interface DraftLine {
  productId: string;
  quantity: string;
  discountPercent: string;
  taxRateId: string;
}
interface Draft {
  deal: PickerValue | null;
  priceBookId: string;
  title: string;
  templateKey: string | null;
  accentColor: string | null;
  sections: ProposalSection[];
  validUntil: string;
  terms: string;
  lines: DraftLine[];
}

const fromQuote = (q: QuoteRow): Draft => ({
  deal: { id: q.deal.id, name: q.deal.name },
  priceBookId: q.priceBook.id,
  title: q.title,
  templateKey: q.templateKey,
  accentColor: q.accentColor,
  sections: q.sections.map((s) => ({ ...s })),
  validUntil: q.validUntil ?? '',
  terms: q.terms ?? '',
  lines: q.lines.map((l) => ({ productId: l.productId, quantity: String(l.quantity), discountPercent: String(l.discountPercent), taxRateId: l.taxRateId ?? '' })),
});

const blank = (templateKey: string | null, accent: string | null): Draft => ({
  deal: null,
  priceBookId: '',
  title: '',
  templateKey,
  accentColor: accent,
  sections: (bidTemplate(templateKey)?.sections ?? []).map((s) => ({ ...s })),
  validUntil: '',
  terms: '',
  lines: [],
});

const readStored = (): Draft | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
};
const writeStored = (d: Draft | null) => {
  try {
    if (d) localStorage.setItem(STORE, JSON.stringify(d));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage unavailable: the draft lives only in this tab until the quote is created */
  }
};

/** Field-level problems, keyed by field id, so each control can point at its own message. */
function validate(d: Draft, step: number): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 0 || step === -1) {
    if (!d.deal) e['qb-deal'] = 'Choose the deal this bid is for.';
    if (!d.priceBookId) e['qb-book'] = 'Choose a price book.';
    if (!d.title.trim()) e['qb-title'] = 'Give the bid a title.';
    else if (d.title.length > 200) e['qb-title'] = 'Keep the title under 200 characters.';
  }
  if (step === 1 || step === -1) {
    d.sections.forEach((s, i) => {
      if (!s.heading.trim()) e[`qb-sec-${i}-heading`] = 'Give the section a heading.';
    });
  }
  if (step === 2 || step === -1) {
    if (d.lines.length === 0) e['qb-add-product'] = 'Add at least one item.';
    d.lines.forEach((l, i) => {
      const q = Number(l.quantity);
      if (!l.quantity.trim() || !Number.isFinite(q) || q <= 0) e[`qb-line-${i}-qty`] = 'Enter a quantity above 0.';
      const disc = Number(l.discountPercent || 0);
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) e[`qb-line-${i}-disc`] = 'Use 0 to 100.';
    });
    if (d.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(d.validUntil)) e['qb-valid'] = 'Use a date.';
  }
  return e;
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'invalid' } | { kind: 'error'; message: string };

export function QuickBidStudio() {
  const params = useSearchParams();
  const quoteId = params.get('quote');
  // A bid created on this page keeps the same studio (and its step and focus) when the URL gains ?quote=.
  const [createdHere, setCreatedHere] = useState<string | null>(null);
  const resume = !!quoteId && quoteId !== createdHere;
  const quote = useQuery({ queryKey: ['quotes', quoteId], queryFn: () => api<QuoteRow>(`/quotes/${quoteId}`), enabled: resume });
  if (resume) {
    if (quote.isPending) return <Skeleton className="h-96" />;
    if (quote.error) return <ErrorText error={quote.error} />;
    return <Studio key={quoteId} initialQuote={quote.data} />;
  }
  return <Studio key="new" initialQuote={null} onCreated={setCreatedHere} />;
}

function Studio({ initialQuote, onCreated }: { initialQuote: QuoteRow | null; onCreated?: (id: string) => void }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const settings = useCommercialSettings();
  const books = usePriceBooks();
  const products = useProducts();
  const taxes = useTaxRates();

  const paramTemplate = bidTemplateKeySchema.safeParse(params.get('template')).success ? params.get('template') : null;
  const paramAccent = bidAccentSchema.safeParse(params.get('accent')).success ? params.get('accent') : null;
  const [restored, setRestored] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => (initialQuote ? fromQuote(initialQuote) : blank(paramTemplate, paramAccent)));
  const [quoteRow, setQuoteRow] = useState<QuoteRow | null>(initialQuote);
  // Follow server-side changes to the quote (status, sharing) made by other parts of the page.
  const live = useQuery({ queryKey: ['quotes', quoteRow?.id], queryFn: () => api<QuoteRow>(`/quotes/${quoteRow!.id}`), enabled: !!quoteRow });
  useEffect(() => {
    if (live.data && live.data !== quoteRow) setQuoteRow(live.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data]);
  const editable = !quoteRow || (quoteRow.isLatest && (quoteRow.status === 'DRAFT' || quoteRow.status === 'REJECTED'));
  const [step, setStep] = useState(() => (initialQuote ? (editable ? 1 : 3) : 0));
  const [shownErrors, setShownErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [showPreview, setShowPreview] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Before the quote exists, pick up a draft left on this device (unless a template link was followed).
  useEffect(() => {
    if (initialQuote || paramTemplate) return;
    const stored = readStored();
    if (stored && (stored.deal || stored.title || stored.lines.length)) {
      setDraft({ ...blank(null, null), ...stored });
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Deal details for currency and the customer name on the preview.
  const deal = useQuery({
    queryKey: ['quick-bid', 'deal', draft.deal?.id],
    queryFn: () => api<DealRow>(`/deals/${draft.deal!.id}`),
    enabled: !!draft.deal && !quoteRow,
  });
  const activeBooks = (books.data ?? []).filter((b) => b.active);
  const book = activeBooks.find((b) => b.id === draft.priceBookId) ?? (books.data ?? []).find((b) => b.id === draft.priceBookId);
  const currency = quoteRow?.currency ?? book?.currency ?? deal.data?.currency ?? 'USD';

  // Suggest the price book in the deal's currency (the default one first) once the deal is known.
  useEffect(() => {
    if (quoteRow || draft.priceBookId || !deal.data) return;
    const match = activeBooks.filter((b) => b.currency === deal.data.currency).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
    if (match) update({ priceBookId: match.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.data, books.data]);

  // ---- Saving --------------------------------------------------------------------------------------
  const latest = useRef(draft);
  latest.current = draft;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const payload = (d: Draft) => ({
    title: d.title.trim(),
    templateKey: d.templateKey,
    accentColor: d.accentColor,
    sections: d.sections.map((s) => ({ heading: s.heading.trim(), body: s.body })),
    validUntil: d.validUntil || null,
    terms: d.terms,
    lines: d.lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), discountPercent: Number(l.discountPercent || 0), taxRateId: l.taxRateId || null })),
  });

  /** Saves the latest draft now; saves run one after another so an older one never lands last. */
  const flush = useCallback((): Promise<QuoteRow | null> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = quoteRow?.id;
    if (!id) return Promise.resolve(null);
    const d = latest.current;
    // A draft can be saved without items; "add at least one item" only blocks moving on and finalising.
    const { 'qb-add-product': _noItems, ...problems } = validate(d, -1);
    if (Object.keys(problems).length) {
      setShownErrors(problems);
      setSave({ kind: 'invalid' });
      return Promise.resolve(null);
    }
    setSave({ kind: 'saving' });
    const run = chain.current.then(async () => {
      try {
        const row = await api<QuoteRow>(`/quotes/${id}`, { method: 'PATCH', json: payload(latest.current) });
        qc.setQueryData(['quotes', id], row);
        setQuoteRow(row);
        setSave({ kind: 'saved', at: new Date() });
        return row;
      } catch (err) {
        setSave({ kind: 'error', message: err instanceof Error ? err.message : t('Could not save.') });
        return null;
      }
    });
    chain.current = run;
    return run;
  }, [quoteRow?.id, qc, t]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!quoteRow) {
      writeStored(draft);
      return;
    }
    if (!editable) return;
    if (timer.current) clearTimeout(timer.current);
    // Say so as soon as there is something to save: "Saved at" must not show while a change waits for the timer.
    setSave({ kind: 'saving' });
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Save anything pending when leaving the page.
  useEffect(() => () => void (timer.current && flush()), [flush]);

  const create = useMutation({
    mutationFn: () =>
      api<QuoteRow>('/quotes', {
        method: 'POST',
        json: {
          opportunityId: draft.deal!.id,
          priceBookId: draft.priceBookId,
          title: draft.title.trim(),
          templateKey: draft.templateKey,
          accentColor: draft.accentColor,
          sections: draft.sections,
        },
      }),
    onSuccess: async (row) => {
      writeStored(null);
      setRestored(false);
      qc.setQueryData(['quotes', row.id], row);
      await qc.invalidateQueries({ queryKey: ['quotes', 'list'] });
      setQuoteRow(row);
      onCreated?.(row.id);
      // Keep what the person has typed; take the terms the server filled in from workspace settings.
      setDraft((d) => ({ ...d, terms: row.terms ?? '', validUntil: row.validUntil ?? '' }));
      setSave({ kind: 'saved', at: new Date() });
      const next = new URLSearchParams(params);
      next.delete('template');
      next.delete('accent');
      next.set('quote', row.id);
      router.replace(`${pathname}?${next}`, { scroll: false });
      go(1);
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const saved = await flush();
      if (!saved) throw new Error(t('The bid was not submitted because its latest changes could not be saved. Fix the highlighted fields or try again.'));
      return api<QuoteRow>(`/quotes/${quoteRow!.id}/transition`, { method: 'POST', json: { action: 'submit' } });
    },
    onSuccess: async (row) => {
      qc.setQueryData(['quotes', row.id], row);
      setQuoteRow(row);
      await qc.invalidateQueries({ queryKey: ['quotes', 'list'] });
    },
  });

  // ---- Steps ---------------------------------------------------------------------------------------
  const go = (n: number) => {
    setStep(n);
    setShownErrors({});
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const next = () => {
    const errs = validate(draft, step);
    setShownErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.getElementById(Object.keys(errs)[0]!)?.focus());
      return;
    }
    if (step === 0 && !quoteRow) return create.mutate();
    void flush();
    go(step + 1);
  };
  const reachable = (i: number) => i === 0 || !!quoteRow;

  // ---- Pricing and preview -------------------------------------------------------------------------
  const productById = new Map((products.data ?? []).map((p) => [p.id, p]));
  const taxById = new Map((taxes.data ?? []).map((t) => [t.id, t]));
  const priceOf = (productId: string) => productById.get(productId)?.prices.find((p) => p.priceBookId === draft.priceBookId)?.unitPrice;
  const previewLines: PreviewLine[] = draft.lines.map((l) => ({
    name: productById.get(l.productId)?.name ?? t('Item'),
    description: productById.get(l.productId)?.description ?? null,
    quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 0,
    unitPrice: priceOf(l.productId) ?? 0,
    discountPercent: Math.min(100, Math.max(0, Number(l.discountPercent) || 0)),
    taxPercent: l.taxRateId ? (taxById.get(l.taxRateId)?.rate ?? 0) : 0,
  }));
  const totals = quoteTotals(previewLines);
  const threshold = settings.data?.discountApprovalThreshold;
  const needsApproval = threshold !== undefined && totals.maxDiscountPercent > threshold;
  const preparedFor = quoteRow?.deal.companyName ?? deal.data?.company?.name ?? null;

  const proposal = useMemo(
    () =>
      previewProposal({
        seller: {
          name: session?.tenant.name ?? t('Your company'),
          logoDataUrl: settings.data?.logoDataUrl,
          header: settings.data?.proposalHeader,
          footer: settings.data?.proposalFooter,
          brandColor: session?.tenant.brandColor,
        },
        templateKey: draft.templateKey,
        accentColor: draft.accentColor,
        title: draft.title,
        reference: quoteRow?.reference,
        preparedFor,
        currency,
        validUntil: draft.validUntil || null,
        sections: draft.sections,
        lines: previewLines,
        terms: draft.terms || null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, settings.data, draft, quoteRow?.reference, preparedFor, currency, products.data, taxes.data],
  );

  const err = (id: string) => shownErrors[id];
  const described = (id: string) => (err(id) ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {});
  const errorFor = (id: string) =>
    err(id) ? (
      <p id={`${id}-error`} className="text-xs text-critical">
        {t.maybe(err(id) ?? '')}
      </p>
    ) : null;

  const template = bidTemplate(draft.templateKey);
  const chooseTemplate = (key: string | null) => {
    const prev = bidTemplate(draft.templateKey);
    const untouched = draft.sections.length === 0 || JSON.stringify(draft.sections) === JSON.stringify(prev?.sections ?? []);
    update({ templateKey: key, accentColor: null, ...(untouched ? { sections: (bidTemplate(key)?.sections ?? []).map((s) => ({ ...s })) } : {}) });
  };
  const setSection = (i: number, patch: Partial<ProposalSection>) => update({ sections: draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSection = (i: number, by: number) => {
    const s = [...draft.sections];
    const [x] = s.splice(i, 1);
    s.splice(i + by, 0, x!);
    update({ sections: s });
  };
  const setLine = (i: number, patch: Partial<DraftLine>) => update({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const priced = (products.data ?? []).filter((p) => p.active && p.prices.some((x) => x.priceBookId === draft.priceBookId));
  const [adding, setAdding] = useState('');

  const disabled = !editable;

  return (
    <div className="space-y-4">
      <Link href="/app/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t('All quotes')}
      </Link>

      <nav aria-label={t('Bid steps')}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((label, i) => {
            const done = i < step && reachable(i);
            return (
              <li key={label}>
                <button
                  type="button"
                  aria-current={step === i ? 'step' : undefined}
                  disabled={!reachable(i)}
                  onClick={() => {
                    if (i === step) return;
                    if (i > step) {
                      const errs = validate(draft, step);
                      if (Object.keys(errs).length && editable) {
                        setShownErrors(errs);
                        return;
                      }
                    }
                    void flush();
                    go(i);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-start text-sm disabled:cursor-not-allowed disabled:opacity-60 aria-[current=step]:border-primary aria-[current=step]:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-success text-success-foreground' : step === i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                  >
                    {done ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span>
                    <span className="sr-only">{t('Step {n} of {total}:', { n: i + 1, total: STEPS.length })} </span>
                    {t(label)}
                    {done && <span className="sr-only"> {t('(done)')}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
        {quoteRow && (
          <>
            <Badge tone={QUOTE_STATUS[quoteRow.status].tone}>{QUOTE_STATUS[quoteRow.status].label}</Badge>
            <span className="font-medium">{quoteRow.reference}</span>
          </>
        )}
        <SaveStatus save={save} stored={!quoteRow} />
        {restored && (
          <span className="text-muted-foreground">
            {t('Restored the bid you started earlier on this device.')}{' '}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => {
                writeStored(null);
                setRestored(false);
                setDraft(blank(null, null));
              }}
            >
              {t('Start over')}
            </button>
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
              {t(STEPS[step]!)}
            </h2>
            {!editable && step < 3 && (
              <p className="rounded-md border border-border bg-muted/40 p-2 text-sm">
                {t('This bid has been submitted, so it can no longer be edited here.')}{' '}
                <Link href={`/app/quotes/${quoteRow!.id}`} className="text-primary underline underline-offset-2">
                  {t('Revise it from the full quote')}
                </Link>
              </p>
            )}

            {step === 0 && (
              <div className="space-y-3">
                <Field id="qb-deal" label={t('Deal')}>
                  {quoteRow ? (
                    <p className="text-sm">{quoteRow.deal.name}{quoteRow.deal.companyName && ` · ${quoteRow.deal.companyName}`}</p>
                  ) : (
                    <RecordPicker id="qb-deal" entity="deals" value={draft.deal} onChange={(v) => update({ deal: v, priceBookId: '', title: draft.title || (v ? t('Proposal for {name}', { name: v.name }) : '') })} placeholder={t('Search deals')} {...described('qb-deal')} />
                  )}
                </Field>
                {errorFor("qb-deal")}
                <Field id="qb-book" label={t('Price book')} hint={quoteRow ? t('Fixed once the bid is created.') : deal.data ? t('Prices come from the price book, and the bid uses its currency (the deal is in {currency}).', { currency: deal.data.currency }) : t('Prices come from the price book, and the bid uses its currency.')}>
                  <Select id="qb-book" value={draft.priceBookId} disabled={!!quoteRow} onChange={(e) => update({ priceBookId: e.target.value })} {...described('qb-book')}>
                    <option value="">{t('Choose a price book')}</option>
                    {(quoteRow ? (books.data ?? []) : activeBooks).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.currency}){b.isDefault ? ', default' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                {errorFor("qb-book")}
                <Field id="qb-title" label={t('Title')}>
                  <Input id="qb-title" value={draft.title} maxLength={200} disabled={disabled} onChange={(e) => update({ title: e.target.value })} {...described('qb-title')} />
                </Field>
                {errorFor("qb-title")}
                {!quoteRow && <p className="text-xs text-muted-foreground">{t('Continuing creates a draft quote on the deal. Nothing is sent to the customer until you choose to.')}</p>}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div role="group" aria-label={t('Template')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[null, ...BID_TEMPLATES.map((t) => t.key)].map((key) => {
                    const tpl = bidTemplate(key);
                    const checked = draft.templateKey === key;
                    return (
                      <button
                        key={key ?? 'plain'}
                        type="button"
                        aria-pressed={checked}
                        disabled={disabled}
                        onClick={() => chooseTemplate(key)}
                        className="rounded-md border border-border p-1.5 text-start text-xs aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/30 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {tpl ? <TemplateThumb template={tpl} accent={checked ? (draft.accentColor ?? undefined) : undefined} /> : <span className="grid aspect-[4/3] place-items-center rounded-md border border-dashed border-border text-muted-foreground">{t('Plain')}</span>}
                        <span className="mt-1 block truncate font-medium">{tpl ? t.maybe(tpl.name) : t('Plain (workspace brand)')}</span>
                      </button>
                    );
                  })}
                </div>
                {template && <AccentPicker value={draft.accentColor} templateAccent={template.style.accent} disabled={disabled} onChange={(a) => update({ accentColor: a })} />}
                {template && JSON.stringify(draft.sections) !== JSON.stringify(template.sections) && editable && (
                  <Button type="button" size="sm" variant="outline" onClick={() => update({ sections: template.sections.map((s) => ({ ...s })) })}>
                    {t('Replace sections with {template} starting sections', { template: t.maybe(template.name) })}
                  </Button>
                )}
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">{t('Sections')}</legend>
                  {draft.sections.length === 0 && <p className="text-sm text-muted-foreground">{t('No sections: the bid shows the price table only.')}</p>}
                  {draft.sections.map((s, i) => (
                    <div key={i} className="space-y-2 rounded-md border border-border p-3">
                      <div className="flex items-center gap-1">
                        <label htmlFor={`qb-sec-${i}-heading`} className="sr-only">
                          {t('Section {n} heading', { n: i + 1 })}
                        </label>
                        <Input id={`qb-sec-${i}-heading`} value={s.heading} maxLength={120} disabled={disabled} onChange={(e) => setSection(i, { heading: e.target.value })} className="h-9 font-medium" {...described(`qb-sec-${i}-heading`)} />
                        <Button type="button" size="icon" variant="ghost" aria-label={t('Move section {n} up', { n: i + 1 })} disabled={disabled || i === 0} onClick={() => moveSection(i, -1)}>
                          <ArrowUp className="size-4" aria-hidden />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={t('Move section {n} down', { n: i + 1 })} disabled={disabled || i === draft.sections.length - 1} onClick={() => moveSection(i, 1)}>
                          <ArrowDown className="size-4" aria-hidden />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={t('Remove section {n}', { n: i + 1 })} disabled={disabled} onClick={() => update({ sections: draft.sections.filter((_, j) => j !== i) })}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                      {errorFor(`qb-sec-${i}-heading`)}
                      <label htmlFor={`qb-sec-${i}-body`} className="sr-only">
                        {t('Section {n} text', { n: i + 1 })}
                      </label>
                      <Textarea id={`qb-sec-${i}-body`} rows={3} maxLength={8000} value={s.body} disabled={disabled} onChange={(e) => setSection(i, { body: e.target.value })} />
                    </div>
                  ))}
                  {editable && draft.sections.length < 20 && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => update({ sections: [...draft.sections, { heading: t('New section'), body: '' }] })}>
                      <Plus aria-hidden /> {t('Add section')}
                    </Button>
                  )}
                </fieldset>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                {editable && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-end gap-2">
                      <Field id="qb-add-product" label={t('Add an item')} className="min-w-0 flex-1">
                        <Select id="qb-add-product" value={adding} onChange={(e) => setAdding(e.target.value)} {...described('qb-add-product')}>
                          <option value="">{t('Choose a product')}</option>
                          {priced.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {formatAmount(priceOf(p.id) ?? 0, currency)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!adding}
                        onClick={() => {
                          update({ lines: [...draft.lines, { productId: adding, quantity: '1', discountPercent: '0', taxRateId: '' }] });
                          setAdding('');
                        }}
                      >
                        <Plus aria-hidden /> {t('Add')}
                      </Button>
                    </div>
                    {errorFor("qb-add-product")}
                    {products.data && priced.length === 0 && <p className="text-xs text-muted-foreground">{t('No active products have a price in this price book yet. Add prices under Quotes › Catalogue and pricing.')}</p>}
                  </div>
                )}
                {draft.lines.length > 0 && (
                  <ul aria-label={t('Items')} className="divide-y divide-border rounded-md border border-border">
                    {draft.lines.map((l, i) => {
                      const name = productById.get(l.productId)?.name ?? t('Unknown product');
                      const over = threshold !== undefined && Number(l.discountPercent) > threshold;
                      return (
                        <li key={i} className="space-y-2 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{name}</span>
                            <span className="text-sm tabular-nums">{formatAmount(lineTotals(previewLines[i]!).net, currency)}</span>
                          </div>
                          <div className="flex flex-wrap items-start gap-2">
                            <div className="w-24 space-y-1">
                              <label htmlFor={`qb-line-${i}-qty`} className="text-xs text-muted-foreground">
                                {t('Quantity')}
                              </label>
                              <Input id={`qb-line-${i}-qty`} inputMode="decimal" value={l.quantity} disabled={disabled} onChange={(e) => setLine(i, { quantity: e.target.value })} className="h-9 text-end" {...described(`qb-line-${i}-qty`)} />
                              {errorFor(`qb-line-${i}-qty`)}
                            </div>
                            <div className="w-24 space-y-1">
                              <label htmlFor={`qb-line-${i}-disc`} className="text-xs text-muted-foreground">
                                {t('Discount %')}
                              </label>
                              <Input id={`qb-line-${i}-disc`} inputMode="decimal" value={l.discountPercent} disabled={disabled} onChange={(e) => setLine(i, { discountPercent: e.target.value })} className="h-9 text-end" {...described(`qb-line-${i}-disc`)} />
                              {errorFor(`qb-line-${i}-disc`)}
                              {over && !err(`qb-line-${i}-disc`) && <p className="text-[11px] text-warning">{t('Needs approval')}</p>}
                            </div>
                            <div className="w-36 space-y-1">
                              <label htmlFor={`qb-line-${i}-tax`} className="text-xs text-muted-foreground">
                                {t('Tax')}
                              </label>
                              <Select id={`qb-line-${i}-tax`} value={l.taxRateId} disabled={disabled} onChange={(e) => setLine(i, { taxRateId: e.target.value })} className="h-9">
                                <option value="">{t('No tax')}</option>
                                {(taxes.data ?? [])
                                  .filter((r) => r.active)
                                  .map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name} ({r.rate}%)
                                    </option>
                                  ))}
                              </Select>
                            </div>
                            <span className="self-end pb-2 text-xs text-muted-foreground">{t('at {price} each', { price: formatAmount(priceOf(l.productId) ?? null, currency) })}</span>
                            {editable && (
                              <Button type="button" size="icon" variant="ghost" className="ms-auto self-end" aria-label={t('Remove {name}', { name })} onClick={() => update({ lines: draft.lines.filter((_, j) => j !== i) })}>
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="qb-valid" label={t('Valid until')}>
                    <Input id="qb-valid" type="date" value={draft.validUntil} disabled={disabled} onChange={(e) => update({ validUntil: e.target.value })} {...described('qb-valid')} />
                  </Field>
                  <dl className="space-y-1 self-end text-sm tabular-nums">
                    <Total label={t('Subtotal')} value={formatAmount(totals.subtotal, currency)} />
                    {totals.discountTotal > 0 && <Total label={t('Discount')} value={`−${formatAmount(totals.discountTotal, currency)}`} />}
                    <Total label={t('Tax')} value={formatAmount(totals.taxTotal, currency)} />
                    <Total label={t('Total')} value={formatAmount(totals.total, currency)} strong />
                  </dl>
                </div>
                {errorFor("qb-valid")}
                {needsApproval && (
                  <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-sm">
                    {t('A discount is above your workspace limit of {threshold}%, so this bid will need approval from someone else before it can be sent.', { threshold: threshold ?? 0 })}
                  </p>
                )}
                <Field id="qb-terms" label={t('Terms')}>
                  <Textarea id="qb-terms" rows={4} maxLength={5000} value={draft.terms} disabled={disabled} onChange={(e) => update({ terms: e.target.value })} />
                </Field>
              </div>
            )}

            {step === 3 && quoteRow && (
              <div className="space-y-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t('For')}</dt>
                  <dd>{quoteRow.deal.name}{quoteRow.deal.companyName && ` · ${quoteRow.deal.companyName}`}</dd>
                  <dt className="text-muted-foreground">{t('Template')}</dt>
                  <dd>{template ? t.maybe(template.name) : t('Plain')}{draft.accentColor ? t(', accent {colour}', { colour: draft.accentColor }) : ''}</dd>
                  <dt className="text-muted-foreground">{t('Items')}</dt>
                  <dd>{draft.lines.length}</dd>
                  <dt className="text-muted-foreground">{t('Total')}</dt>
                  <dd className="font-semibold tabular-nums">{formatAmount(editable ? totals.total : quoteRow.total, currency)}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {editable && (
                    <Button type="button" disabled={submit.isPending || draft.lines.length === 0} onClick={() => submit.mutate()}>
                      <Send aria-hidden /> {needsApproval ? t('Submit for approval') : t('Finalise bid')}
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={async () => { await flush(); void downloadFile(`/quotes/${quoteRow.id}/pdf`, `${quoteRow.reference.replace(/\s+/g, '-')}.pdf`); }}>
                    <Download aria-hidden /> PDF
                  </Button>
                  <Link href={`/app/quotes/${quoteRow.id}`} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-primary hover:underline">
                    {t('Open full quote')}
                  </Link>
                </div>
                {editable && draft.lines.length === 0 && <p className="text-xs text-muted-foreground">{t('Add at least one item before finalising.')}</p>}
                <ErrorText error={submit.error} />
                {quoteRow.status === 'PENDING_APPROVAL' && (
                  <p className="rounded-md border border-border bg-muted/40 p-2 text-sm">{t('Waiting for approval. Someone with permission to approve quotes has been asked to review the discount; you can share the bid once it is approved.')}</p>
                )}
                {quoteRow.status === 'APPROVED' && <p className="text-sm">{t('The bid is ready. Turn the link on to copy it, or email it from your mailbox.')}</p>}
                <ProposalSharing
                  quote={quoteRow}
                  onSent={async () => {
                    const row = await api<QuoteRow>(`/quotes/${quoteRow.id}`);
                    setQuoteRow(row);
                    await qc.invalidateQueries({ queryKey: ['quotes'] });
                  }}
                />
              </div>
            )}

            <ErrorText error={create.error} />
            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" disabled={step === 0} onClick={() => { void flush(); go(step - 1); }}>
                <ArrowLeft className="rtl:-scale-x-100" aria-hidden /> {t('Back')}
              </Button>
              {step < 3 && (
                <Button type="button" onClick={next} disabled={create.isPending}>
                  {step === 0 && !quoteRow ? (create.isPending ? t('Creating…') : t('Create draft and continue')) : t('Continue')} <ArrowRight className="rtl:-scale-x-100" aria-hidden />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <Button type="button" variant="outline" size="sm" className="lg:hidden" aria-expanded={showPreview} aria-controls="qb-preview" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? <EyeOff aria-hidden /> : <Eye aria-hidden />} {showPreview ? t('Hide preview') : t('Show preview')}
          </Button>
          <div id="qb-preview" className={showPreview ? 'block' : 'hidden lg:block'}>
            <ProposalPreview proposal={proposal} label={t("Live preview of the customer's proposal")} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-border pt-1 font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SaveStatus({ save, stored }: { save: SaveState; stored: boolean }) {
  const t = useT();
  if (stored) return <span className="text-muted-foreground">{t('Draft kept on this device until you continue.')}</span>;
  switch (save.kind) {
    case 'saving':
      return <span className="text-muted-foreground">{t('Saving…')}</span>;
    case 'saved':
      return <span className="text-muted-foreground">{t('Saved at {time}', { time: save.at.toLocaleTimeString(t.language, { hour: '2-digit', minute: '2-digit' }) })}</span>;
    case 'invalid':
      return <span className="text-warning">{t('Not saved: fix the highlighted fields.')}</span>;
    case 'error':
      return <span className="text-critical">{t('Not saved: {reason}', { reason: t.maybe(save.message) })}</span>;
    default:
      return null;
  }
}
