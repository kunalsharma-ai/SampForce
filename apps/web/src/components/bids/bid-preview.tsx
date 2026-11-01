'use client';

import {
  bidStyle,
  lineTotals,
  quoteTotals,
  textOn,
  type BidTemplate,
  type ProposalSection,
  type PublicProposal,
} from '@dealflow/types';
import { ProposalDocument } from '@/app/p/[token]/proposal-view';

/** A priced line as the studio and the gallery hold it before the server stores it. */
export interface PreviewLine {
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
}

/**
 * Builds the customer's view of a proposal from local state, using the same maths and the same
 * document component as the online proposal, so the preview matches what the customer will see.
 */
export function previewProposal(input: {
  seller: { name: string; logoDataUrl?: string | null; header?: string | null; footer?: string | null; brandColor?: string | null };
  templateKey: string | null;
  accentColor: string | null;
  title: string;
  reference?: string;
  preparedFor: string | null;
  currency: string;
  validUntil: string | null;
  sections: ProposalSection[];
  lines: PreviewLine[];
  terms: string | null;
}): PublicProposal {
  const totals = quoteTotals(input.lines);
  return {
    seller: {
      name: input.seller.name,
      logoDataUrl: input.seller.logoDataUrl ?? null,
      header: input.seller.header ?? null,
      footer: input.seller.footer ?? null,
      brandColor: input.seller.brandColor ?? null,
    },
    style: bidStyle(input.templateKey, input.accentColor, input.seller.brandColor),
    reference: input.reference ?? 'Draft',
    title: input.title || 'Untitled proposal',
    preparedFor: input.preparedFor,
    createdAt: new Date().toISOString(),
    validUntil: input.validUntil,
    expired: false,
    status: 'DRAFT',
    superseded: false,
    currency: input.currency,
    sections: input.sections,
    lines: input.lines.map((l) => ({
      name: l.name,
      description: l.description ?? null,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxPercent: l.taxPercent,
      netTotal: lineTotals(l).net,
    })),
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    terms: input.terms,
  };
}

/** The proposal at a reduced size inside a scrollable frame, marked as a preview for screen readers. */
export function ProposalPreview({ proposal, label = 'Live preview' }: { proposal: PublicProposal; label?: string }) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      {/* Focusable so keyboard users can scroll a long preview. */}
      <div tabIndex={0} className="max-h-[70vh] overflow-y-auto p-5 text-[0.92em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-6">
        <ProposalDocument p={proposal} />
      </div>
    </section>
  );
}

/** A small drawing of a template's cover: band, dark band, side rule or quiet rule, in its accent and typeface. */
export function TemplateThumb({ template, accent }: { template: BidTemplate; accent?: string }) {
  const a = accent ?? template.style.accent;
  const cover = template.style.cover;
  const serif = template.style.font === 'serif';
  const line = (w: string, strong = false) => (
    <span className={`block h-1.5 rounded-full ${strong ? 'bg-black/50' : 'bg-black/15'}`} style={{ width: w }} />
  );
  return (
    <div aria-hidden className="relative flex aspect-[4/3] flex-col gap-2 overflow-hidden rounded-md border border-border bg-white p-3 text-[#111] dark:bg-zinc-50">
      {cover === 'split' && <span className="absolute inset-y-0 left-0 w-2" style={{ background: a }} />}
      {(cover === 'band' || cover === 'dark') && (
        <div
          className="-mx-3 -mt-3 mb-1 px-3 py-3"
          style={{ background: cover === 'dark' ? '#111111' : a, color: cover === 'dark' ? '#fff' : textOn(a), borderBottom: cover === 'dark' ? `3px solid ${a}` : undefined }}
        >
          <span className={`block text-[10px] font-semibold ${serif ? 'font-serif' : ''}`}>{template.name}</span>
        </div>
      )}
      {(cover === 'minimal' || cover === 'split') && (
        <div className={cover === 'split' ? 'pl-2' : ''}>
          <span className={`block text-[10px] font-semibold ${serif ? 'font-serif' : ''}`}>{template.name}</span>
          {cover === 'minimal' && <span className="mt-1 block h-0.5 w-10" style={{ background: a }} />}
        </div>
      )}
      <div className={`space-y-1.5 ${cover === 'split' ? 'pl-2' : ''}`}>
        <span className="block h-1.5 w-1/3 rounded-full" style={{ background: a }} />
        {line('90%')}
        {line('75%')}
        <span className="block h-1.5 w-1/4 rounded-full" style={{ background: a }} />
        {line('85%')}
        {line('60%')}
      </div>
      <div className={`mt-auto flex justify-end ${cover === 'split' ? 'pl-2' : ''}`}>{line('35%', true)}</div>
    </div>
  );
}

/** Example lines for template previews in the gallery; never saved. */
export const EXAMPLE_LINES: PreviewLine[] = [
  { name: 'Discovery workshop', quantity: 1, unitPrice: 4500, discountPercent: 0, taxPercent: 0 },
  { name: 'Platform licence (annual)', quantity: 25, unitPrice: 360, discountPercent: 10, taxPercent: 0 },
  { name: 'Onboarding and training', quantity: 2, unitPrice: 1200, discountPercent: 0, taxPercent: 0 },
];
