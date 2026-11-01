import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  formatReference,
  needsDiscountApproval,
  type QuoteInput,
  type QuoteLineInput,
  type QuoteRow,
  type QuoteUpdate,
  quoteTotals,
  lineTotals,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { badRef, notFound, ownerRefs } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { readSettings } from './catalog.service';
import { QUOTE_APPROVAL_KIND } from './quote-approval';

const include = {
  lines: { orderBy: { position: 'asc' } },
  opportunity: { select: { id: true, name: true, companyId: true, currency: true, company: { select: { name: true } } } },
  priceBook: { select: { id: true, name: true } },
  contracts: { select: { id: true }, take: 1 },
} as const;
type QuoteWith = Prisma.QuoteGetPayload<{ include: typeof include }>;

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const EDITABLE = new Set(['DRAFT', 'REJECTED']);

/**
 * Quotes for deals. Unit prices are read from the quote's price book every time lines are saved, so a
 * quote can only carry catalogue prices; people choose products, quantities, discounts and tax rates.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(auth: AuthContext, q: { opportunityId?: string; status?: string; allVersions?: boolean }): Promise<QuoteRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.quote.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}),
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.allVersions ? {} : { isLatest: true }),
          opportunity: { deletedAt: null },
        },
        include,
        orderBy: [{ number: 'desc' }, { version: 'desc' }],
        take: 200,
      });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<QuoteRow> {
    return this.prisma.run(auth, async (tx) => (await this.rows(tx, auth.tenantId, [await this.find(tx, auth.tenantId, id)]))[0]!);
  }

  versions(auth: AuthContext, id: string): Promise<QuoteRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const q = await this.find(tx, auth.tenantId, id);
      const rows = await tx.quote.findMany({ where: { tenantId: auth.tenantId, number: q.number }, include, orderBy: { version: 'desc' } });
      return this.rows(tx, auth.tenantId, rows);
    });
  }

  create(auth: AuthContext, input: QuoteInput, meta: RequestMeta): Promise<QuoteRow> {
    return this.prisma.run(auth, async (tx) => {
      const deal = await tx.opportunity.findFirst({ where: { id: input.opportunityId, tenantId: auth.tenantId, deletedAt: null } });
      if (!deal) throw badRef('opportunityId');
      const book = input.priceBookId
        ? await tx.priceBook.findFirst({ where: { id: input.priceBookId, tenantId: auth.tenantId, active: true } })
        : ((await tx.priceBook.findFirst({ where: { tenantId: auth.tenantId, active: true, isDefault: true, currency: deal.currency } })) ??
          (await tx.priceBook.findFirst({ where: { tenantId: auth.tenantId, active: true, currency: deal.currency }, orderBy: { name: 'asc' } })));
      if (!book) {
        throw new BadRequestException({
          code: input.priceBookId ? 'VALIDATION_FAILED' : 'NO_PRICE_BOOK',
          message: input.priceBookId ? 'The price book does not exist or is inactive.' : `There is no active price book in ${deal.currency}. Ask an admin to set one up under Quotes › Catalogue.`,
        });
      }
      const settings = await readSettings(tx, auth.tenantId);
      const number = await nextNumber(tx, auth.tenantId, 'quote');
      const quote = await tx.quote.create({
        data: {
          tenantId: auth.tenantId,
          number,
          opportunityId: deal.id,
          priceBookId: book.id,
          currency: book.currency,
          title: input.title ?? `Quote for ${deal.name}`,
          validUntil: new Date(input.validUntil ?? new Date(Date.now() + settings.quoteValidityDays * DAY).toISOString().slice(0, 10)),
          notes: input.notes ?? null,
          terms: input.terms ?? settings.quoteTerms,
          sections: input.sections ?? [],
          templateKey: input.templateKey ?? null,
          accentColor: input.accentColor ?? null,
          createdById: auth.userId,
        },
      });
      await this.writeLines(tx, auth.tenantId, quote.id, book.id, input.lines);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'quote.created', entityType: 'quote', entityId: quote.id, metadata: { number, dealId: deal.id }, meta });
      return (await this.rows(tx, auth.tenantId, [await this.find(tx, auth.tenantId, quote.id)]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: QuoteUpdate, meta: RequestMeta): Promise<QuoteRow> {
    return this.prisma.run(auth, async (tx) => {
      const q = await this.find(tx, auth.tenantId, id);
      if (!q.isLatest || !EDITABLE.has(q.status)) {
        throw new ConflictException({ code: 'QUOTE_LOCKED', message: 'Only a draft or rejected quote can be edited. Revise it to make a new version.' });
      }
      const { lines, validUntil, ...rest } = input;
      await tx.quote.update({
        where: { id },
        data: { ...rest, ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}), status: 'DRAFT', approvalId: null },
      });
      if (lines) await this.writeLines(tx, auth.tenantId, id, q.priceBookId, lines);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'quote.updated', entityType: 'quote', entityId: id, metadata: { fields: Object.keys(input) }, meta });
      return (await this.rows(tx, auth.tenantId, [await this.find(tx, auth.tenantId, id)]))[0]!;
    });
  }

  transition(auth: AuthContext, id: string, action: 'submit' | 'mark_sent' | 'accept' | 'decline' | 'revise', opts: { updateDealAmount?: boolean }, meta: RequestMeta): Promise<QuoteRow> {
    return this.prisma.run(auth, async (tx) => {
      const q = await this.find(tx, auth.tenantId, id);
      if (!q.isLatest) throw new ConflictException({ code: 'QUOTE_SUPERSEDED', message: 'A newer version of this quote exists.' });
      const fail = (message: string) => new ConflictException({ code: 'INVALID_TRANSITION', message });
      let resultId = id;
      const set = (status: QuoteWith['status'], extra: Prisma.QuoteUpdateManyMutationInput = {}) =>
        tx.quote.updateMany({ where: { id, status: q.status }, data: { status, ...extra } }).then(({ count }) => {
          if (count === 0) throw new ConflictException({ code: 'CONCURRENT_CHANGE', message: 'The quote changed while you were working on it. Reload and try again.' });
        });

      if (action === 'submit') {
        if (q.status !== 'DRAFT') throw fail('Only a draft quote can be submitted.');
        if (q.lines.length === 0) throw fail('Add at least one product before submitting.');
        const settings = await readSettings(tx, auth.tenantId);
        const max = q.maxDiscountPercent.toNumber();
        if (needsDiscountApproval(max, settings.discountApprovalThreshold)) {
          const ref = formatReference('Q', q.number, q.version);
          const approval = await tx.approvalRequest.create({
            data: {
              tenantId: auth.tenantId,
              kind: QUOTE_APPROVAL_KIND,
              title: `Approve ${max}% discount on ${ref}`,
              summary: `${q.title} for ${q.opportunity.name}: total ${q.total.toNumber()} ${q.currency}, highest line discount ${max}% (limit ${settings.discountApprovalThreshold}%).`,
              payload: { quoteId: id, reference: ref, total: q.total.toNumber(), currency: q.currency, maxDiscountPercent: max, threshold: settings.discountApprovalThreshold, requestedBy: auth.userId },
              permission: 'quotes:approve',
              expiresAt: new Date(Date.now() + 7 * DAY),
            },
          });
          await set('PENDING_APPROVAL', { approvalId: approval.id });
          const approvers = (await this.notifications.usersWithPermission(tx, auth.tenantId, 'quotes:approve')).filter((u) => u !== auth.userId);
          await this.notifications.send(tx, auth.tenantId, approvers, { type: 'quote.approval_requested', title: `Discount approval needed: ${ref}`, body: `${max}% discount on ${q.opportunity.name}.`, link: `/app/quotes/${id}` });
        } else await set('APPROVED');
      } else if (action === 'mark_sent') {
        if (q.status !== 'APPROVED') throw fail('Only an approved quote can be marked as sent.');
        await set('SENT', { sentAt: new Date() });
      } else if (action === 'accept' || action === 'decline') {
        if (q.status !== 'SENT' && q.status !== 'APPROVED') throw fail('Only an approved or sent quote can be accepted or declined.');
        await set(action === 'accept' ? 'ACCEPTED' : 'DECLINED', { decidedAt: new Date() });
        if (action === 'accept' && opts.updateDealAmount) {
          const amount = q.subtotal.minus(q.discountTotal);
          const deal = await tx.opportunity.findFirstOrThrow({ where: { id: q.opportunityId } });
          if (deal.currency !== q.currency) throw fail(`The deal is in ${deal.currency} and the quote in ${q.currency}, so the deal amount was not changed.`);
          await tx.opportunity.update({ where: { id: q.opportunityId }, data: { amount } });
          await this.audit.record(tx, {
            tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.updated', entityType: 'opportunity', entityId: q.opportunityId,
            metadata: { changes: { amount: { from: deal.amount.toNumber(), to: amount.toNumber() } }, fromQuote: id }, meta,
          });
        }
      } else {
        if (!['APPROVED', 'SENT', 'REJECTED', 'DECLINED'].includes(q.status)) throw fail('Edit the draft instead of revising it.');
        await tx.quote.update({ where: { id }, data: { isLatest: false } });
        const next = await tx.quote.create({
          data: {
            tenantId: auth.tenantId, number: q.number, version: q.version + 1, opportunityId: q.opportunityId, priceBookId: q.priceBookId, currency: q.currency,
            title: q.title, validUntil: q.validUntil, notes: q.notes, terms: q.terms, sections: q.sections ?? [], templateKey: q.templateKey, accentColor: q.accentColor, createdById: auth.userId,
          },
        });
        // Prices are re-read from the price book, so a revision picks up any price change since.
        await this.writeLines(tx, auth.tenantId, next.id, q.priceBookId, q.lines.map((l) => ({ productId: l.productId, quantity: l.quantity.toNumber(), discountPercent: l.discountPercent.toNumber(), taxRateId: l.taxRateId, description: l.description })));
        resultId = next.id;
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: `quote.${action}`, entityType: 'quote', entityId: resultId, metadata: { from: q.status, number: q.number, version: q.version }, meta });
      return (await this.rows(tx, auth.tenantId, [await this.find(tx, auth.tenantId, resultId)]))[0]!;
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const q = await this.find(tx, auth.tenantId, id);
      if (q.status !== 'DRAFT' || q.version > 1) throw new ConflictException({ code: 'QUOTE_LOCKED', message: 'Only a first-version draft can be deleted.' });
      await tx.quote.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'quote.deleted', entityType: 'quote', entityId: id, metadata: { number: q.number }, meta });
    });
  }

  /** Replaces a quote's lines using current price book prices, then stores the totals. */
  private async writeLines(tx: TenantTx, tenantId: string, quoteId: string, priceBookId: string, lines: QuoteLineInput[]): Promise<void> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const taxIds = [...new Set(lines.map((l) => l.taxRateId).filter((v): v is string => !!v))];
    const [entries, taxes] = await Promise.all([
      tx.priceBookEntry.findMany({ where: { tenantId, priceBookId, productId: { in: productIds } }, include: { product: true } }),
      tx.taxRate.findMany({ where: { tenantId, id: { in: taxIds }, active: true } }),
    ]);
    const price = new Map(entries.map((e) => [e.productId, e]));
    const tax = new Map(taxes.map((t) => [t.id, t]));
    const details: { path: string; message: string }[] = [];
    lines.forEach((l, i) => {
      const e = price.get(l.productId);
      if (!e) details.push({ path: `lines.${i}.productId`, message: 'This product has no price in the quote’s price book.' });
      else if (!e.product.active) details.push({ path: `lines.${i}.productId`, message: `${e.product.name} is no longer sold.` });
      if (l.taxRateId && !tax.has(l.taxRateId)) details.push({ path: `lines.${i}.taxRateId`, message: 'Unknown or inactive tax rate.' });
    });
    if (details.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Some lines cannot be priced.', details });

    await tx.quoteLine.deleteMany({ where: { quoteId } });
    const calc = lines.map((l, i) => {
      const e = price.get(l.productId)!;
      const taxPercent = l.taxRateId ? tax.get(l.taxRateId)!.rate.toNumber() : 0;
      const c = { quantity: l.quantity, unitPrice: e.unitPrice.toNumber(), discountPercent: l.discountPercent, taxPercent };
      const t = lineTotals(c);
      return {
        row: {
          tenantId, quoteId, productId: l.productId, position: i, name: e.product.name, description: l.description ?? e.product.description,
          quantity: l.quantity, unitPrice: e.unitPrice, discountPercent: l.discountPercent, taxRateId: l.taxRateId ?? null, taxPercent, netTotal: t.net, taxTotal: t.tax,
        },
        c,
      };
    });
    if (calc.length) await tx.quoteLine.createMany({ data: calc.map((x) => x.row) });
    const totals = quoteTotals(calc.map((x) => x.c));
    await tx.quote.update({ where: { id: quoteId }, data: totals });
  }

  private async find(tx: TenantTx, tenantId: string, id: string): Promise<QuoteWith> {
    const q = await tx.quote.findFirst({ where: { id, tenantId, opportunity: { deletedAt: null } }, include });
    if (!q) throw notFound('Quote');
    return q;
  }

  private async rows(tx: TenantTx, tenantId: string, rows: QuoteWith[]): Promise<QuoteRow[]> {
    const names = await ownerRefs(tx, rows.map((r) => r.createdById));
    const settings = await readSettings(tx, tenantId);
    return rows.map((q) => toQuoteRow(q, names, settings.discountApprovalThreshold));
  }
}

export function toQuoteRow(q: QuoteWith, names: Map<string, { id: string; name: string }>, threshold: number): QuoteRow {
  const validUntil = q.validUntil?.toISOString().slice(0, 10) ?? null;
  return {
    id: q.id,
    number: q.number,
    reference: formatReference('Q', q.number, q.version),
    version: q.version,
    isLatest: q.isLatest,
    title: q.title,
    currency: q.currency,
    status: q.status,
    expired: q.status === 'SENT' && !!validUntil && validUntil < today(),
    validUntil,
    notes: q.notes,
    terms: q.terms,
    subtotal: q.subtotal.toNumber(),
    discountTotal: q.discountTotal.toNumber(),
    taxTotal: q.taxTotal.toNumber(),
    total: q.total.toNumber(),
    maxDiscountPercent: q.maxDiscountPercent.toNumber(),
    needsApproval: needsDiscountApproval(q.maxDiscountPercent.toNumber(), threshold),
    approvalId: q.approvalId,
    deal: { id: q.opportunity.id, name: q.opportunity.name, companyId: q.opportunity.companyId, companyName: q.opportunity.company?.name ?? null },
    priceBook: q.priceBook,
    createdBy: q.createdById ? (names.get(q.createdById) ?? null) : null,
    sentAt: q.sentAt?.toISOString() ?? null,
    decidedAt: q.decidedAt?.toISOString() ?? null,
    contractId: q.contracts[0]?.id ?? null,
    sections: (q.sections as unknown as QuoteRow['sections']) ?? [],
    templateKey: q.templateKey,
    accentColor: q.accentColor,
    share: { enabled: q.shareEnabled, firstViewedAt: q.firstViewedAt?.toISOString() ?? null, lastViewedAt: q.lastViewedAt?.toISOString() ?? null, viewCount: q.viewCount },
    lines: q.lines.map((l) => ({
      id: l.id, productId: l.productId, position: l.position, name: l.name, description: l.description, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber(),
      discountPercent: l.discountPercent.toNumber(), taxRateId: l.taxRateId, taxPercent: l.taxPercent.toNumber(), netTotal: l.netTotal.toNumber(), taxTotal: l.taxTotal.toNumber(),
    })),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

/** Next document number for the tenant, serialised by a transaction-scoped advisory lock. */
export async function nextNumber(tx: TenantTx, tenantId: string, kind: 'quote' | 'contract'): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${kind}`}))`;
  const agg = kind === 'quote' ? await tx.quote.aggregate({ where: { tenantId }, _max: { number: true } }) : await tx.contract.aggregate({ where: { tenantId }, _max: { number: true } });
  return (agg._max.number ?? 0) + 1;
}
