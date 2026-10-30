import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';

/**
 * Discount approvals reuse the approvals inbox (`approval_requests`, kind `quote_discount`). These hooks
 * keep the quote in step whichever screen the decision is made from.
 */
export const QUOTE_APPROVAL_KIND = 'quote_discount';

export async function assertCanDecideQuote(tx: TenantTx, tenantId: string, quoteId: string, userId: string): Promise<void> {
  const quote = await tx.quote.findFirst({ where: { id: quoteId, tenantId }, select: { createdById: true } });
  if (quote?.createdById && quote.createdById === userId) {
    throw new ForbiddenException({ code: 'SELF_APPROVAL', message: 'Someone else must approve a discount on a quote you created.' });
  }
}

export async function applyQuoteDecision(tx: TenantTx, tenantId: string, quoteId: string, outcome: 'APPROVED' | 'REJECTED' | 'EXPIRED'): Promise<void> {
  await tx.quote.updateMany({
    where: { id: quoteId, tenantId, status: 'PENDING_APPROVAL' },
    // An expired request sends the quote back to draft so it can be submitted again.
    data: { status: outcome === 'EXPIRED' ? 'DRAFT' : outcome, approvalId: outcome === 'EXPIRED' ? null : undefined },
  });
}
