'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { ContactRow, DealRow } from '@dealflow/types';
import Link from 'next/link';
import { DEAL_STATUS_TONE, formatMoney, titleCase, useRecordList } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

export function RelatedDeals({ filter }: { filter: { companyId: string } | { contactId: string } }) {
  const t = useT();
  const deals = useRecordList<DealRow>('deals', { ...filter, pageSize: 50, sort: 'createdAt', order: 'desc' });
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('module.deals')} {deals.data ? <span className="text-muted-foreground">({deals.data.total})</span> : null}</CardTitle>
          <InfoTip topic="record.relatedDeals" />
        </div>
      </CardHeader>
      <CardContent>
        {deals.isPending ? (
          <Skeleton className="h-12" />
        ) : deals.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No deals yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {deals.data?.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link href={`/app/deals/${d.id}`} className="font-medium text-primary hover:underline">
                  {d.name}
                </Link>
                <Badge tone={DEAL_STATUS_TONE[d.status]}>{t.maybe(titleCase(d.status))}</Badge>
                <span className="text-muted-foreground">{d.stage.name}</span>
                <span className="ms-auto tabular-nums">{formatMoney(d.amount, d.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RelatedContacts({ companyId }: { companyId: string }) {
  const t = useT();
  const contacts = useRecordList<ContactRow>('contacts', { companyId, pageSize: 50, sort: 'firstName', order: 'asc' });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('module.contacts')} {contacts.data ? <span className="text-muted-foreground">({contacts.data.total})</span> : null}</CardTitle>
      </CardHeader>
      <CardContent>
        {contacts.isPending ? (
          <Skeleton className="h-12" />
        ) : contacts.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No contacts at this company yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.data?.items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link href={`/app/contacts/${c.id}`} className="font-medium text-primary hover:underline">
                  {c.fullName}
                </Link>
                <span className="text-muted-foreground">{c.jobTitle}</span>
                <span className="ms-auto text-muted-foreground">{c.email}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
