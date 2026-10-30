'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { CompanyRow } from '@dealflow/types';
import Link from 'next/link';
import { CustomFieldList, DetailError, DetailList, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RelatedContacts, RelatedDeals } from '@/components/crm/related-deals';
import { ActivityTimeline } from '@/components/crm/timeline';
import { CompanyCommercial } from '@/components/revenue/record-commercial';
import { formatDate, useRecord } from '@/lib/crm';

export function CompanyDetail({ id }: { id: string }) {
  const company = useRecord<CompanyRow>('companies', id);
  if (company.isPending) return <DetailSkeleton />;
  if (company.error) return <DetailError error={company.error} />;
  const c = company.data;
  return (
    <div className="max-w-6xl">
      <RecordHeader
        entity="companies"
        id={id}
        title={c.name}
        subtitle={[c.industry, c.domain].filter(Boolean).join(' · ') || undefined}
        row={c as unknown as Record<string, unknown>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <RelatedContacts companyId={id} />
          <RelatedDeals filter={{ companyId: id }} />
          <CompanyCommercial company={{ id, name: c.name }} />
          <ActivityTimeline related={{ companyId: id }} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ['Domain', c.domain && <a className="text-primary hover:underline" href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer">{c.domain}</a>],
                  ['Industry', c.industry],
                  ['Country', c.country],
                  ['Parent company', c.parentCompany && <Link className="text-primary hover:underline" href={`/app/companies/${c.parentCompany.id}`}>{c.parentCompany.name}</Link>],
                  ['Owner', c.owner?.name],
                  ['Created', formatDate(c.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
          <CustomFieldList entity="companies" values={c.customFields} />
        </div>
      </div>
    </div>
  );
}
