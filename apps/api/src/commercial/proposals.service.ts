import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { ProposalSection, ProposalSendInput, PublicProposal, QuoteRow } from '@dealflow/types';
import { CardPaymentsService } from '../apps/card-payments.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { CommunicationService } from '../integrations/communication.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingSigner } from '../sequences/tracking';
import { renderQuotePdf } from './quote-pdf';
import { QuotesService } from './quotes.service';

/**
 * Enhancement feature 9: a quote becomes a proposal with sections, branding, an online link and email sending.
 * Prices, discounts, approval and versions stay with the quote; this service only shares and sends what the
 * quote already says. The online link carries a signed token and works only while sharing is on for that version.
 */
@Injectable()
export class ProposalsService {
  readonly signer: TrackingSigner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuotesService,
    private readonly communication: CommunicationService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly payments: CardPaymentsService,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    const secret = env.TRACKING_SECRET ?? createHmac('sha256', env.JWT_ACCESS_SECRET).update('dealflow-tracking-secret').digest('hex');
    this.signer = new TrackingSigner(secret, env.PUBLIC_WEB_URL.replace(/\/+$/, ''), 'dealflow-proposal-v1');
  }

  link(tenantId: string, quoteId: string): string {
    return `${this.signer.baseUrl}/p/${this.signer.token(tenantId, quoteId)}`;
  }

  async share(auth: AuthContext, id: string, enabled: boolean, meta: RequestMeta): Promise<{ enabled: boolean; url: string | null }> {
    const q = await this.quotes.get(auth, id);
    if (enabled && !['APPROVED', 'SENT', 'ACCEPTED', 'DECLINED'].includes(q.status)) {
      throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Submit the quote and get it approved before sharing it.' });
    }
    await this.prisma.run(auth, async (tx) => {
      await tx.quote.update({ where: { id }, data: { shareEnabled: enabled } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: enabled ? 'quote.link_enabled' : 'quote.link_disabled', entityType: 'quote', entityId: id, metadata: { reference: q.reference }, meta });
    });
    return { enabled, url: enabled ? this.link(auth.tenantId, id) : null };
  }

  linkFor(auth: AuthContext, q: QuoteRow): string | null {
    return q.share.enabled ? this.link(auth.tenantId, q.id) : null;
  }

  /** Emails the proposal from the caller's mailbox with the online link, then marks an approved quote as sent. */
  async send(auth: AuthContext, id: string, input: ProposalSendInput, meta: RequestMeta): Promise<QuoteRow> {
    const q = await this.quotes.get(auth, id);
    if (!q.isLatest) throw new ConflictException({ code: 'QUOTE_SUPERSEDED', message: 'A newer version of this quote exists. Send that one.' });
    if (q.status !== 'APPROVED' && q.status !== 'SENT') throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'Only an approved or already sent quote can be emailed.' });
    if (q.expired) throw new ConflictException({ code: 'INVALID_TRANSITION', message: 'This quote has expired. Revise it to set a new valid-until date.' });
    const url = this.link(auth.tenantId, id);
    // Sharing turns on before sending so the link in the email works when it arrives.
    await this.prisma.run(auth, (tx) => tx.quote.update({ where: { id }, data: { shareEnabled: true } }));
    const contactId = await this.prisma.run(auth, async (tx) => {
      const deal = await tx.opportunity.findFirst({ where: { id: q.deal.id, tenantId: auth.tenantId }, select: { contactId: true } });
      if (!deal?.contactId) return undefined;
      const c = await tx.contact.findFirst({ where: { id: deal.contactId, tenantId: auth.tenantId }, select: { email: true } });
      return c?.email?.toLowerCase() === input.to.toLowerCase() ? deal.contactId : undefined;
    });
    await this.communication.send(auth, { to: input.to, subject: input.subject, body: `${input.message}\n\nView the proposal: ${url}`, contactId }, meta);
    if (q.status === 'APPROVED') await this.quotes.transition(auth, id, 'mark_sent', {}, meta);
    await this.prisma.run(auth, (tx) =>
      this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'quote.emailed', entityType: 'quote', entityId: id, metadata: { reference: q.reference, to: input.to }, meta }),
    );
    return this.quotes.get(auth, id);
  }

  /** The public proposal page. Each load counts as a view; the rep is told on the first one. */
  async view(token: string, opts: { count: boolean }): Promise<PublicProposal | null> {
    const t = this.signer.verify(token);
    if (!t) return null;
    return this.load(t.tenantId, t.messageId, { count: opts.count, shared: true });
  }

  /** "Pay by card" on the public link: only for a shared, accepted, latest version with the workspace's own payments app connected. */
  async pay(token: string): Promise<{ url: string } | null> {
    const t = this.signer.verify(token);
    if (!t) return null;
    return this.payments.start(t.tenantId, t.messageId, token);
  }

  /** The client portal shows a company's sent proposals to its signed-in people, whether or not the public link is on. */
  forPortal(tenantId: string, quoteId: string, companyId: string): Promise<PublicProposal | null> {
    return this.load(tenantId, quoteId, { count: false, shared: false, companyId });
  }

  private async load(tenantId: string, quoteId: string, opts: { count: boolean; shared: boolean; companyId?: string }): Promise<PublicProposal | null> {
    const p = await this.loadQuote(tenantId, quoteId, opts);
    if (!p || !opts.shared) return p;
    const payment = await this.payments.forProposal(tenantId, { id: quoteId, status: p.status, isLatest: !p.superseded, total: p.total, currency: p.currency, expired: p.expired });
    return payment ? { ...p, payment } : p;
  }

  private loadQuote(tenantId: string, quoteId: string, opts: { count: boolean; shared: boolean; companyId?: string }): Promise<PublicProposal | null> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const q = await tx.quote.findFirst({
        where: {
          id: quoteId,
          tenantId,
          ...(opts.shared ? { shareEnabled: true, status: { in: ['APPROVED', 'SENT', 'ACCEPTED', 'DECLINED'] } } : { status: { in: ['SENT', 'ACCEPTED', 'DECLINED'] } }),
          ...(opts.companyId ? { opportunity: { companyId: opts.companyId, deletedAt: null } } : {}),
        },
        include: { lines: { orderBy: { position: 'asc' } }, opportunity: { include: { company: { select: { name: true } } } } },
      });
      if (!q) return null;
      const [tenant, settings] = await Promise.all([
        tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { name: true, brandColor: true } }),
        tx.commercialSettings.findUnique({ where: { tenantId } }),
      ]);
      if (opts.count) {
        const now = new Date();
        await tx.quote.update({ where: { id: q.id }, data: { viewCount: { increment: 1 }, lastViewedAt: now, ...(q.firstViewedAt ? {} : { firstViewedAt: now }) } });
        if (!q.firstViewedAt && q.createdById) {
          const ref = `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`;
          await this.notifications.send(tx, tenantId, [q.createdById], {
            type: 'quote.viewed',
            title: `Proposal ${ref} was opened`,
            body: `${q.opportunity.name}: the online proposal link was opened. Email security scanners can also open links, so treat this as a likely view.`,
            link: `/app/quotes/${q.id}`,
          });
        }
      }
      const validUntil = q.validUntil?.toISOString().slice(0, 10) ?? null;
      const expired = q.status === 'SENT' && !!validUntil && validUntil < new Date().toISOString().slice(0, 10);
      return {
        seller: { name: tenant.name, logoDataUrl: settings?.logoDataUrl ?? null, header: settings?.proposalHeader ?? null, footer: settings?.proposalFooter ?? null, brandColor: tenant.brandColor },
        reference: `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`,
        title: q.title,
        preparedFor: q.opportunity.company?.name ?? null,
        createdAt: q.createdAt.toISOString(),
        validUntil,
        expired,
        status: q.status,
        superseded: !q.isLatest,
        currency: q.currency,
        sections: (q.sections as unknown as ProposalSection[]) ?? [],
        lines: q.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber(), discountPercent: l.discountPercent.toNumber(), taxPercent: l.taxPercent.toNumber(), netTotal: l.netTotal.toNumber() })),
        subtotal: q.subtotal.toNumber(),
        discountTotal: q.discountTotal.toNumber(),
        taxTotal: q.taxTotal.toNumber(),
        total: q.total.toNumber(),
        terms: q.terms,
      };
    });
  }

  async publicPdf(token: string): Promise<{ pdf: Buffer; filename: string } | null> {
    const p = await this.view(token, { count: false });
    if (!p) return null;
    return { pdf: await renderQuotePdf(publicToRow(p), { name: p.seller.name, logoDataUrl: p.seller.logoDataUrl, header: p.seller.header, footer: p.seller.footer }), filename: `${p.reference.replace(/\s+/g, '-')}.pdf` };
  }
}

/** The PDF renderer takes a QuoteRow; the public view has everything it prints. */
function publicToRow(p: PublicProposal): Parameters<typeof renderQuotePdf>[0] {
  return {
    reference: p.reference,
    title: p.title,
    currency: p.currency,
    createdAt: p.createdAt,
    validUntil: p.validUntil,
    deal: { companyName: p.preparedFor },
    lines: p.lines,
    subtotal: p.subtotal,
    discountTotal: p.discountTotal,
    taxTotal: p.taxTotal,
    total: p.total,
    notes: null,
    terms: p.terms,
    sections: p.sections,
  };
}
