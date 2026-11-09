import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type {
  CommercialSettingsRow,
  PriceBookInput,
  PriceBookRow,
  ProductInput,
  ProductRow,
  TaxRateRow,
  z,
  commercialSettingsSchema,
  taxRateInputSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { badRef, notFound } from '../crm/crm-helpers';

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const duplicate = (what: string) => new ConflictException({ code: 'DUPLICATE', message: `${what} already exists.` });

/** Products, price books, tax rates and quote settings (catalog:manage to change, quotes:read to see). */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  products(auth: AuthContext, includeInactive = false): Promise<ProductRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.product.findMany({
        where: { tenantId: auth.tenantId, ...(includeInactive ? {} : { active: true }) },
        include: { prices: { include: { priceBook: { select: { currency: true } } } } },
        orderBy: { name: 'asc' },
      });
      return rows.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, description: p.description, unit: p.unit, active: p.active,
        prices: p.prices.map((e) => ({ priceBookId: e.priceBookId, currency: e.priceBook.currency, unitPrice: Number(e.unitPrice) })),
      }));
    });
  }

  saveProduct(auth: AuthContext, id: string | null, input: ProductInput, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      try {
        const row = id
          ? await this.updateOwned(tx, auth.tenantId, id, (where) => tx.product.updateMany({ where, data: input }), 'Product')
          : await tx.product.create({ data: { ...input, tenantId: auth.tenantId } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'product.updated' : 'product.created', entityType: 'product', entityId: row.id, metadata: { name: input.name }, meta });
        return { id: row.id };
      } catch (err) {
        if (isUnique(err)) throw duplicate('A product with this SKU');
        throw err;
      }
    });
  }

  priceBooks(auth: AuthContext): Promise<PriceBookRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.priceBook.findMany({ where: { tenantId: auth.tenantId }, include: { _count: { select: { entries: true } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
      return rows.map((b) => ({ id: b.id, name: b.name, currency: b.currency, isDefault: b.isDefault, active: b.active, entryCount: b._count.entries }));
    });
  }

  savePriceBook(auth: AuthContext, id: string | null, input: PriceBookInput, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      try {
        // One default per currency, so a new quote can pick the right book without asking.
        if (input.isDefault) await tx.priceBook.updateMany({ where: { tenantId: auth.tenantId, currency: input.currency, NOT: id ? { id } : undefined }, data: { isDefault: false } });
        let rowId: string;
        if (id) {
          const existing = await tx.priceBook.findFirst({ where: { id, tenantId: auth.tenantId } });
          if (!existing) throw notFound('Price book');
          if (existing.currency !== input.currency) {
            const used = await tx.quote.count({ where: { priceBookId: id } });
            if (used) throw new ConflictException({ code: 'PRICE_BOOK_IN_USE', message: 'Quotes use this price book, so its currency cannot change. Create a new price book instead.' });
          }
          await tx.priceBook.update({ where: { id }, data: input });
          rowId = id;
        } else rowId = (await tx.priceBook.create({ data: { ...input, tenantId: auth.tenantId } })).id;
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'price_book.updated' : 'price_book.created', entityType: 'price_book', entityId: rowId, metadata: { name: input.name, currency: input.currency }, meta });
        return { id: rowId };
      } catch (err) {
        if (isUnique(err)) throw duplicate('A price book with this name');
        throw err;
      }
    });
  }

  /** Sets one product's price in a book. Existing quotes keep the price they were saved with. */
  setPrice(auth: AuthContext, priceBookId: string, productId: string, unitPrice: number | null, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const [book, product] = await Promise.all([
        tx.priceBook.findFirst({ where: { id: priceBookId, tenantId: auth.tenantId } }),
        tx.product.findFirst({ where: { id: productId, tenantId: auth.tenantId } }),
      ]);
      if (!book) throw notFound('Price book');
      if (!product) throw badRef('productId');
      const before = await tx.priceBookEntry.findUnique({ where: { priceBookId_productId: { priceBookId, productId } } });
      if (unitPrice === null) await tx.priceBookEntry.deleteMany({ where: { priceBookId, productId } });
      else
        await tx.priceBookEntry.upsert({
          where: { priceBookId_productId: { priceBookId, productId } },
          create: { tenantId: auth.tenantId, priceBookId, productId, unitPrice },
          update: { unitPrice },
        });
      // Price changes are commercially sensitive, so the audit log keeps old and new values.
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'price.changed', entityType: 'price_book', entityId: priceBookId,
        metadata: { productId, product: product.name, currency: book.currency, from: Number(before?.unitPrice) ?? null, to: unitPrice }, meta,
      });
    });
  }

  taxRates(auth: AuthContext): Promise<TaxRateRow[]> {
    return this.prisma.run(auth, async (tx) =>
      (await tx.taxRate.findMany({ where: { tenantId: auth.tenantId }, orderBy: { name: 'asc' } })).map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate), active: t.active })),
    );
  }

  saveTaxRate(auth: AuthContext, id: string | null, input: z.infer<typeof taxRateInputSchema>, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      try {
        const row = id
          ? await this.updateOwned(tx, auth.tenantId, id, (where) => tx.taxRate.updateMany({ where, data: input }), 'Tax rate')
          : await tx.taxRate.create({ data: { ...input, tenantId: auth.tenantId } });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: id ? 'tax_rate.updated' : 'tax_rate.created', entityType: 'tax_rate', entityId: row.id, metadata: input, meta });
        return { id: row.id };
      } catch (err) {
        if (isUnique(err)) throw duplicate('A tax rate with this name');
        throw err;
      }
    });
  }

  settings(auth: AuthContext): Promise<CommercialSettingsRow> {
    return this.prisma.run(auth, (tx) => readSettings(tx, auth.tenantId));
  }

  updateSettings(auth: AuthContext, input: z.infer<typeof commercialSettingsSchema>, meta: RequestMeta): Promise<CommercialSettingsRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await readSettings(tx, auth.tenantId);
      await tx.commercialSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, ...input, updatedById: auth.userId },
        update: { ...input, updatedById: auth.userId },
      });
      // The logo is a large data URL; the audit row records only whether it changed.
      const brief = (v: Record<string, unknown>) => ({ ...v, logoDataUrl: v.logoDataUrl ? '(image)' : v.logoDataUrl });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'commercial_settings.updated', entityType: 'tenant', entityId: auth.tenantId, metadata: { before: brief({ ...before }), after: brief({ ...input }) }, meta });
      return readSettings(tx, auth.tenantId);
    });
  }

  private async updateOwned(tx: TenantTx, tenantId: string, id: string, run: (where: { id: string; tenantId: string }) => Promise<{ count: number }>, what: string) {
    const { count } = await run({ id, tenantId });
    if (count === 0) throw notFound(what);
    return { id };
  }
}

export async function readSettings(tx: TenantTx, tenantId: string): Promise<CommercialSettingsRow> {
  const s = await tx.commercialSettings.findUnique({ where: { tenantId } });
  return {
    discountApprovalThreshold: Number(s?.discountApprovalThreshold) ?? 10,
    quoteValidityDays: s?.quoteValidityDays ?? 30,
    quoteTerms: s?.quoteTerms ?? null,
    proposalHeader: s?.proposalHeader ?? null,
    proposalFooter: s?.proposalFooter ?? null,
    logoDataUrl: s?.logoDataUrl ?? null,
  };
}
