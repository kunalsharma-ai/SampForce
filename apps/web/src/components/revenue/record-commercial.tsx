'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import Link from 'next/link';
import { ContractTable } from '@/app/app/contracts/contracts-workspace';
import { CustomerCard, EscalationCard, NewEscalation } from '@/app/app/customer-success/success-workspace';
import { NewQuote, QuoteTable } from '@/app/app/quotes/quotes-workspace';
import { useContracts, useCustomer, useEscalations, useQuotes } from '@/lib/revenue';
import { useCan } from '@/lib/session';

/** Quotes on a deal page. */
export function DealQuotes({ deal }: { deal: { id: string; name: string } }) {
  const canRead = useCan('quotes:read');
  const canWrite = useCan('quotes:write');
  const quotes = useQuotes({ opportunityId: deal.id });
  if (!canRead) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Quotes</CardTitle>
        {canWrite && <NewQuote deal={deal} />}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 pb-2">
        {quotes.isPending ? <Skeleton className="m-4 h-12" /> : !quotes.data?.length ? <p className="px-6 pb-4 text-sm text-muted-foreground">No quotes for this deal yet.</p> : <QuoteTable rows={quotes.data} showDeal={false} />}
      </CardContent>
    </Card>
  );
}

/** Contracts, customer health and escalations on a company page. */
export function CompanyCommercial({ company }: { company: { id: string; name: string } }) {
  const canContracts = useCan('contracts:read');
  const canSuccess = useCan('success:read');
  const canEscalate = useCan('success:write');
  const contracts = useContracts({ companyId: company.id });
  const customer = useCustomer(company.id, canSuccess);
  const escalations = useEscalations({ companyId: company.id, status: 'OPEN' });
  return (
    <>
      {canSuccess && customer.data && (
        <ul>
          <CustomerCard c={customer.data} />
        </ul>
      )}
      {canContracts && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Contracts</CardTitle>
            <Link href="/app/contracts" className="text-xs text-primary hover:underline">
              All contracts
            </Link>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0 pb-2">
            {contracts.isPending ? <Skeleton className="m-4 h-12" /> : !contracts.data?.length ? <p className="px-6 pb-4 text-sm text-muted-foreground">No contracts with this company.</p> : <ContractTable rows={contracts.data} showCompany={false} />}
          </CardContent>
        </Card>
      )}
      {canSuccess && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open escalations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {escalations.data?.length ? (
              <ul className="space-y-3">
                {escalations.data.map((e) => (
                  <EscalationCard key={e.id} e={e} canWrite={canEscalate} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None open.</p>
            )}
            {canEscalate && <NewEscalation company={company} />}
          </CardContent>
        </Card>
      )}
    </>
  );
}
