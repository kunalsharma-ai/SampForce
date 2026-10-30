import { z } from 'zod';
import type { OwnerRef } from './crm';

/**
 * Catalogue, price books, quotes and contracts. Unit prices always come from a price book; people
 * (and agents) can only add catalogue lines, change quantities and apply discounts, and any discount
 * above the workspace threshold needs a person with quotes:approve.
 */
const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));

export const productInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(200),
  sku: text(64),
  description: text(2000),
  unit: z.string().trim().min(1).max(32).default('unit'),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const priceBookInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  currency: currencyCode,
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type PriceBookInput = z.infer<typeof priceBookInputSchema>;

export const priceEntrySchema = z.object({
  productId: z.string().uuid(),
  unitPrice: z.coerce.number().min(0).max(1e12),
});

export const taxRateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rate: z.coerce.number().min(0).max(100),
  active: z.boolean().default(true),
});

export const commercialSettingsSchema = z.object({
  discountApprovalThreshold: z.coerce.number().min(0).max(100).optional(),
  quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
  quoteTerms: text(5000),
});

export const quoteLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().positive('Quantity must be more than 0').max(1e6),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxRateId: z.string().uuid().nullable().optional(),
  description: text(1000),
});
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const quoteInputSchema = z.object({
  opportunityId: z.string().uuid(),
  priceBookId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  validUntil: isoDate.nullable().optional(),
  notes: text(5000),
  terms: text(5000),
  lines: z.array(quoteLineInputSchema).max(200).default([]),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export const quoteUpdateSchema = quoteInputSchema.omit({ opportunityId: true, priceBookId: true }).partial();
export type QuoteUpdate = z.infer<typeof quoteUpdateSchema>;

export const QUOTE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quoteTransitionSchema = z.object({
  action: z.enum(['submit', 'mark_sent', 'accept', 'decline', 'revise']),
  /** On accept: also set the deal amount to the quote total (net of tax). */
  updateDealAmount: z.boolean().optional(),
});

export interface QuoteLineCalc {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxPercent: number;
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** Line maths, rounded per line to cents so stored totals add up exactly. */
export function lineTotals(l: QuoteLineCalc): { gross: number; discount: number; net: number; tax: number } {
  const gross = cents(l.quantity * l.unitPrice);
  const discount = cents((gross * l.discountPercent) / 100);
  const net = cents(gross - discount);
  const tax = cents((net * l.taxPercent) / 100);
  return { gross, discount, net, tax };
}

export function quoteTotals(lines: QuoteLineCalc[]): { subtotal: number; discountTotal: number; taxTotal: number; total: number; maxDiscountPercent: number } {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let maxDiscountPercent = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal += t.gross;
    discountTotal += t.discount;
    taxTotal += t.tax;
    maxDiscountPercent = Math.max(maxDiscountPercent, l.discountPercent);
  }
  subtotal = cents(subtotal);
  discountTotal = cents(discountTotal);
  taxTotal = cents(taxTotal);
  return { subtotal, discountTotal, taxTotal, total: cents(subtotal - discountTotal + taxTotal), maxDiscountPercent };
}

export function needsDiscountApproval(maxDiscountPercent: number, threshold: number): boolean {
  return maxDiscountPercent > threshold;
}

export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  active: boolean;
  prices: { priceBookId: string; currency: string; unitPrice: number }[];
}

export interface PriceBookRow {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
  active: boolean;
  entryCount: number;
}

export interface TaxRateRow {
  id: string;
  name: string;
  rate: number;
  active: boolean;
}

export interface CommercialSettingsRow {
  discountApprovalThreshold: number;
  quoteValidityDays: number;
  quoteTerms: string | null;
}

export interface QuoteLineRow {
  id: string;
  productId: string;
  position: number;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRateId: string | null;
  taxPercent: number;
  netTotal: number;
  taxTotal: number;
}

export interface QuoteRow {
  id: string;
  number: number;
  /** Q-0001 v2 */
  reference: string;
  version: number;
  isLatest: boolean;
  title: string;
  currency: string;
  status: QuoteStatus;
  /** True when a sent quote is past its valid-until date. */
  expired: boolean;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  maxDiscountPercent: number;
  needsApproval: boolean;
  approvalId: string | null;
  deal: { id: string; name: string; companyId: string | null; companyName: string | null };
  priceBook: { id: string; name: string };
  createdBy: OwnerRef | null;
  sentAt: string | null;
  decidedAt: string | null;
  contractId: string | null;
  lines: QuoteLineRow[];
  createdAt: string;
  updatedAt: string;
}

// ───────────── Contracts ─────────────

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const contractInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a contract name').max(200),
    companyId: z.string().uuid().nullable().optional(),
    opportunityId: z.string().uuid().nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
    value: z.coerce.number().min(0).max(1e13).default(0),
    currency: currencyCode.optional(),
    startDate: isoDate,
    endDate: isoDate.nullable().optional(),
    autoRenew: z.boolean().default(false),
    renewalNoticeDays: z.coerce.number().int().min(0).max(365).default(30),
    terms: text(20_000),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
export type ContractInput = z.infer<typeof contractInputSchema>;
export const contractUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  value: z.coerce.number().min(0).max(1e13).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.nullable().optional(),
  autoRenew: z.boolean().optional(),
  renewalNoticeDays: z.coerce.number().int().min(0).max(365).optional(),
  terms: text(20_000),
});

export const contractSignSchema = z.object({
  signedBy: z.string().trim().min(1, 'Who signed it?').max(200),
  signedAt: isoDate,
  method: z.enum(['wet_ink', 'email_confirmation', 'external_esign']),
});
export const contractTerminateSchema = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(1000) });

export interface ContractRow {
  id: string;
  number: number;
  reference: string;
  name: string;
  status: ContractStatus;
  company: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  quote: { id: string; reference: string } | null;
  owner: OwnerRef | null;
  value: number;
  currency: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  renewalNoticeDays: number;
  /** Days until the end date, negative once past; null for open-ended contracts. */
  daysToEnd: number | null;
  renewalDue: boolean;
  signatureMethod: string | null;
  signedBy: string | null;
  signedAt: string | null;
  terms: string | null;
  renewedFromId: string | null;
  renewalId: string | null;
  terminationReason: string | null;
  createdAt: string;
}

/** Whole days from `today` to `end` (both YYYY-MM-DD). */
export function daysBetween(today: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export const formatReference = (prefix: 'Q' | 'C', n: number, version?: number) =>
  `${prefix}-${String(n).padStart(4, '0')}${version && version > 1 ? ` v${version}` : ''}`;
