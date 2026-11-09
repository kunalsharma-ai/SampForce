import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { type ContractInput, type ContractRow, type contractSignSchema, type contractUpdateSchema, daysBetween, formatReference, type z } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, notFound, ownerRefs } from '../crm/crm-helpers';
import { NotificationsService } from '../notifications/notifications.service';
import { scan, errorMessage } from '../worker/queue';
import { nextNumber } from './quotes.service';

const include = {
  company: { select: { id: true, name: true } },
  opportunity: { select: { id: true, name: true } },
  quote: { select: { id: true, number: true, version: true } },
  renewal: { select: { id: true } },
} as const;
type ContractWith = Prisma.ContractGetPayload<{ include: typeof include }>;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const today = () => ymd(new Date());

/**
 * Contract repository with renewal tracking. Signatures are recorded by a person (who signed, when and
 * how); no e-signature provider is connected, and the UI says so.
 */
@Injectable()
export class ContractsService {
  private readonly log = new Logger(ContractsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(auth: AuthContext, q: { status?: string; companyId?: string; renewalWithinDays?: number }): Promise<ContractRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const until = q.renewalWithinDays !== undefined ? new Date(Date.now() + q.renewalWithinDays * 86_400_000) : null;
      const rows = await tx.contract.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.companyId ? { companyId: q.companyId } : {}),
          ...(until ? { status: 'ACTIVE', endDate: { not: null, lte: until } } : {}),
        },
        include,
        orderBy: until ? [{ endDate: 'asc' }] : [{ number: 'desc' }],
        take: 300,
      });
      return this.rows(tx, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => (await this.rows(tx, [await this.find(tx, auth.tenantId, id)]))[0]!);
  }

  create(auth: AuthContext, input: ContractInput, meta: RequestMeta): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, companyId: input.companyId, opportunityId: input.opportunityId });
      let { companyId, opportunityId, value, currency } = input;
      if (input.quoteId) {
        const quote = await tx.quote.findFirst({ where: { id: input.quoteId, tenantId: auth.tenantId }, include: { opportunity: true } });
        if (!quote) throw badRef('quoteId');
        if (quote.status !== 'ACCEPTED') throw new ConflictException({ code: 'QUOTE_NOT_ACCEPTED', message: 'Create a contract from an accepted quote.' });
        // The contract value is the quote's net amount (before tax), in the quote's currency.
        opportunityId ??= quote.opportunityId;
        companyId ??= quote.opportunity.companyId;
        value = quote.subtotal - quote.discountTotal;
        currency = quote.currency;
      }
      if (!currency) {
        const deal = opportunityId ? await tx.opportunity.findFirst({ where: { id: opportunityId } }) : null;
        currency = deal?.currency ?? (await tx.tenant.findFirstOrThrow({ where: { id: auth.tenantId } })).defaultCurrency;
      }
      const number = await nextNumber(tx, auth.tenantId, 'contract');
      const row = await tx.contract.create({
        data: {
          tenantId: auth.tenantId, number, name: input.name, companyId: companyId ?? null, opportunityId: opportunityId ?? null, quoteId: input.quoteId ?? null, ownerId,
          value, currency, startDate: new Date(input.startDate), endDate: input.endDate ? new Date(input.endDate) : null, autoRenew: input.autoRenew,
          renewalNoticeDays: input.renewalNoticeDays, terms: input.terms ?? null,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.created', entityType: 'contract', entityId: row.id, metadata: { number, quoteId: input.quoteId ?? null, value, currency }, meta });
      return (await this.rows(tx, [await this.find(tx, auth.tenantId, row.id)]))[0]!;
    });
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof contractUpdateSchema>, meta: RequestMeta): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.find(tx, auth.tenantId, id);
      if (c.status !== 'DRAFT' && c.status !== 'ACTIVE') throw new ConflictException({ code: 'CONTRACT_CLOSED', message: 'This contract is closed and can no longer be edited.' });
      // Signed terms are fixed: an active contract can change owner, renewal settings and end date only.
      if (c.status === 'ACTIVE' && (input.value !== undefined || input.terms !== undefined || input.startDate !== undefined)) {
        throw new ConflictException({ code: 'CONTRACT_SIGNED', message: 'The value, terms and start date of a signed contract cannot change.' });
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId });
      const start = input.startDate ?? ymd(c.startDate);
      const end = input.endDate === undefined ? (c.endDate ? ymd(c.endDate) : null) : input.endDate;
      if (end && end < start) throw badRef('endDate', 'must be on or after the start date');
      await tx.contract.update({
        where: { id },
        data: {
          ...input,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate === undefined ? undefined : input.endDate ? new Date(input.endDate) : null,
          // A new end date gets its own reminder.
          ...(input.endDate !== undefined || input.renewalNoticeDays !== undefined ? { reminderSentAt: null } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.updated', entityType: 'contract', entityId: id, metadata: { fields: Object.keys(input) }, meta });
      return (await this.rows(tx, [await this.find(tx, auth.tenantId, id)]))[0]!;
    });
  }

  sign(auth: AuthContext, id: string, input: z.infer<typeof contractSignSchema>, meta: RequestMeta): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.find(tx, auth.tenantId, id);
      if (c.status !== 'DRAFT') throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only a draft contract can be signed.' });
      await applyContractSignature(tx, c, { signedBy: input.signedBy, signedAt: new Date(input.signedAt), method: input.method });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.signed', entityType: 'contract', entityId: id, metadata: input, meta });
      return (await this.rows(tx, [await this.find(tx, auth.tenantId, id)]))[0]!;
    });
  }

  terminate(auth: AuthContext, id: string, reason: string, meta: RequestMeta): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.find(tx, auth.tenantId, id);
      if (c.status !== 'ACTIVE') throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only an active contract can be terminated.' });
      await tx.contract.update({ where: { id }, data: { status: 'TERMINATED', terminatedAt: new Date(), terminationReason: reason } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.terminated', entityType: 'contract', entityId: id, metadata: { reason }, meta });
      return (await this.rows(tx, [await this.find(tx, auth.tenantId, id)]))[0]!;
    });
  }

  /** Starts a renewal: a draft for the next term of the same length, linked to this contract. */
  renew(auth: AuthContext, id: string, meta: RequestMeta): Promise<ContractRow> {
    return this.prisma.run(auth, async (tx) => {
      const c = await this.find(tx, auth.tenantId, id);
      if (!['ACTIVE', 'EXPIRED'].includes(c.status) || !c.endDate) throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only an active or expired contract with an end date can be renewed.' });
      if (c.renewal) throw new ConflictException({ code: 'ALREADY_RENEWING', message: 'A renewal already exists for this contract.' });
      const start = new Date(c.endDate.getTime() + 86_400_000);
      const end = new Date(start.getTime() + (c.endDate.getTime() - c.startDate.getTime()));
      const number = await nextNumber(tx, auth.tenantId, 'contract');
      const row = await tx.contract.create({
        data: {
          tenantId: auth.tenantId, number, name: `${c.name} (renewal)`, companyId: c.companyId, opportunityId: c.opportunityId, ownerId: c.ownerId ?? auth.userId,
          value: c.value, currency: c.currency, startDate: start, endDate: end, autoRenew: c.autoRenew, renewalNoticeDays: c.renewalNoticeDays, terms: c.terms, renewedFromId: c.id,
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'contract.renewal_started', entityType: 'contract', entityId: row.id, metadata: { renewedFrom: id, number }, meta });
      return (await this.rows(tx, [await this.find(tx, auth.tenantId, row.id)]))[0]!;
    });
  }

  /**
   * Worker job: expires contracts past their end date and sends one renewal reminder per contract when
   * it enters its notice window. Finds candidates across tenants through the narrow worker_scan policy,
   * then acts inside each tenant's context.
   */
  async runDue(): Promise<number> {
    // The notice window is per contract (end date minus its notice days), so candidates are filtered here.
    const todayStart = new Date(`${today()}T00:00:00.000Z`);
    const candidates = await scan(() =>
      this.prisma.contract.findMany({
        where: { status: 'ACTIVE', endDate: { not: null }, OR: [{ reminderSentAt: null }, { endDate: { lt: todayStart } }] },
        select: { id: true, tenantId: true, endDate: true, reminderSentAt: true, renewalNoticeDays: true },
        orderBy: { endDate: 'asc' },
        take: 2000,
      }),
    );
    const due = candidates
      .filter((c) => c.endDate! < todayStart || (c.reminderSentAt === null && c.endDate!.getTime() - c.renewalNoticeDays * 86_400_000 <= todayStart.getTime()))
      .slice(0, 100)
      .map((c) => ({ id: c.id, tenant_id: c.tenantId }));
    let done = 0;
    for (const d of due) {
      try {
        await this.prisma.run({ tenantId: d.tenant_id }, async (tx) => {
          const c = await tx.contract.findFirst({ where: { id: d.id, status: 'ACTIVE' }, include: { renewal: { select: { id: true } } } });
          if (!c?.endDate) return;
          const ref = formatReference('C', c.number);
          if (ymd(c.endDate) < today()) {
            await tx.contract.update({ where: { id: c.id }, data: { status: 'EXPIRED' } });
            await this.audit.record(tx, { tenantId: d.tenant_id, actorUserId: null, actorType: 'SYSTEM', action: 'contract.expired', entityType: 'contract', entityId: c.id, metadata: { number: c.number } });
            await this.notifications.send(tx, d.tenant_id, [c.ownerId], { type: 'contract.expired', title: `${ref} has expired`, body: `${c.name} ended on ${ymd(c.endDate)}.`, link: `/app/contracts/${c.id}` });
          } else if (!c.reminderSentAt) {
            await tx.contract.update({ where: { id: c.id }, data: { reminderSentAt: new Date() } });
            if (!c.renewal) {
              const days = daysBetween(today(), ymd(c.endDate));
              await this.notifications.send(tx, d.tenant_id, [c.ownerId], {
                type: 'contract.renewal_due', title: `Renewal due: ${ref}`, body: c.autoRenew
                  ? days === 1 ? `${c.name} ends in ${days} day (${ymd(c.endDate)}). It is marked to auto-renew; start the renewal to record the next term.` : `${c.name} ends in ${days} days (${ymd(c.endDate)}). It is marked to auto-renew; start the renewal to record the next term.`
                  : days === 1 ? `${c.name} ends in ${days} day (${ymd(c.endDate)}).` : `${c.name} ends in ${days} days (${ymd(c.endDate)}).`, link: `/app/contracts/${c.id}`,
              });
            }
          }
        });
        done++;
      } catch (err) {
        this.log.error({ err: errorMessage(err), contractId: d.id }, 'contract job failed');
      }
    }
    return done;
  }

  private async find(tx: TenantTx, tenantId: string, id: string): Promise<ContractWith> {
    const c = await tx.contract.findFirst({ where: { id, tenantId }, include });
    if (!c) throw notFound('Contract');
    return c;
  }

  private async rows(tx: TenantTx, rows: ContractWith[]): Promise<ContractRow[]> {
    const names = await ownerRefs(tx, rows.map((r) => r.ownerId));
    return rows.map((c) => toContractRow(c, names));
  }
}

/** Makes a draft contract active as signed; a renewal also closes the contract it renews. Used by manual signing and DocuSign. */
export async function applyContractSignature(tx: TenantTx, c: { id: string; renewedFromId: string | null }, s: { signedBy: string; signedAt: Date; method: string }): Promise<void> {
  await tx.contract.update({ where: { id: c.id }, data: { status: 'ACTIVE', signedBy: s.signedBy.slice(0, 200), signedAt: s.signedAt, signatureMethod: s.method } });
  if (c.renewedFromId) await tx.contract.updateMany({ where: { id: c.renewedFromId, status: { in: ['ACTIVE', 'EXPIRED'] } }, data: { status: 'RENEWED' } });
}

export function toContractRow(c: ContractWith, names: Map<string, { id: string; name: string }>): ContractRow {
  const end = c.endDate ? ymd(c.endDate) : null;
  const daysToEnd = end ? daysBetween(today(), end) : null;
  return {
    id: c.id,
    number: c.number,
    reference: formatReference('C', c.number),
    name: c.name,
    status: c.status,
    company: c.company,
    deal: c.opportunity,
    quote: c.quote ? { id: c.quote.id, reference: formatReference('Q', c.quote.number, c.quote.version) } : null,
    owner: c.ownerId ? (names.get(c.ownerId) ?? null) : null,
    value: Number(c.value),
    currency: c.currency,
    startDate: ymd(c.startDate),
    endDate: end,
    autoRenew: c.autoRenew,
    renewalNoticeDays: c.renewalNoticeDays,
    daysToEnd,
    renewalDue: c.status === 'ACTIVE' && daysToEnd !== null && daysToEnd <= c.renewalNoticeDays && !c.renewal,
    signatureMethod: c.signatureMethod,
    signedBy: c.signedBy,
    signedAt: c.signedAt ? ymd(c.signedAt) : null,
    terms: c.terms,
    renewedFromId: c.renewedFromId,
    renewalId: c.renewal?.id ?? null,
    terminationReason: c.terminationReason,
    createdAt: c.createdAt.toISOString(),
  };
}
