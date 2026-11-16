'use client';

import type { CompanyRow } from '@dealflow/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CompanyLeadCard } from '@/components/crm/company-lead-card';
import { CustomFieldList, DetailError, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RelatedDeals } from '@/components/crm/related-deals';
import { CompanyBranches, CompanyEmployees, CompanyFiles, CompanyOwnership, CompanyProfileCard } from '@/components/crm/company-parts';
import { RecordIntelligencePanel } from '@/components/crm/record-intelligence';
import { ActivityTimeline } from '@/components/crm/timeline';
import { CompanyPortal } from '@/components/portal/company-portal';
import { CompanyCommercial } from '@/components/revenue/record-commercial';
import { RecordVoiceNotes } from '@/components/voice/voice-note';
import { useRecord } from '@/lib/crm';
import { useT } from '@/lib/i18n';

export function CompanyDetail({ id }: { id: string }) {
  const company = useRecord<CompanyRow>('companies', id);
  const t = useT();
  const uploadFailed = useSearchParams().get('uploadFailed');
  if (company.isPending) return <DetailSkeleton />;
  if (company.error) return <DetailError error={company.error} />;
  const c = company.data;
  return (
    <div className="max-w-6xl">
      <RecordHeader
        entity="companies"
        id={id}
        title={c.name}
        subtitle={[c.leadNumber, c.industry, c.domain].filter(Boolean).join(' · ') || undefined}
        row={c as unknown as Record<string, unknown>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {uploadFailed && (
            <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm">
              {t('The lead was saved, but these files could not be uploaded: {names}. Add them again below.', { names: uploadFailed })}
            </p>
          )}
          <CompanyProfileCard company={c} />
          <CompanyEmployees company={c} />
          <CompanyBranches company={c} />
          <RelatedDeals filter={{ companyId: id }} />
          <CompanyCommercial company={{ id, name: c.name }} />
          <CompanyPortal company={{ id, name: c.name }} />
          <RecordVoiceNotes record={{ type: 'company', id, name: c.name }} />
          <ActivityTimeline related={{ companyId: id }} timeline={{ entity: 'company', id }} />
        </div>
        <div className="space-y-4">
          <CompanyLeadCard company={c} />
          <CompanyOwnership company={c} />
          <CompanyFiles company={c} />
          <RecordIntelligencePanel entity="company" id={id} name={c.name} />
          {c.parentCompany && (
            <p className="text-sm">
              {t('Parent company')}: <Link className="text-primary hover:underline" href={`/app/companies/${c.parentCompany.id}`}>{c.parentCompany.name}</Link>
            </p>
          )}
          <CustomFieldList entity="companies" values={c.customFields} />
        </div>
      </div>
    </div>
  );
}
