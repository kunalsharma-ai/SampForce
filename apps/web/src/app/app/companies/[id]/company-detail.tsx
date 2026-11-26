'use client';

import type { CompanyRow } from '@dealflow/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CompanyActionsProvider } from '@/components/crm/company-actions';
import { CompanyAutofill } from '@/components/crm/company-autofill';
import { CompanyBusiness, CompanyEmployeeDirectory, CompanyHero, CompanyKpis } from '@/components/crm/company-dashboard';
import { CompanyLeadCard } from '@/components/crm/company-lead-card';
import { BusinessInformation } from '@/components/crm/business-information';
import { CompanyEmailAssistant } from '@/components/crm/company-email-assistant';
import { CompanyExportMenu } from '@/components/crm/company-export';
import { CompanyBranches, CompanyFiles, CompanyOwnership } from '@/components/crm/company-parts';
import { CompanyFollowUps } from '@/components/crm/follow-ups';
import { CompanyConcerns } from '@/components/command-center/concerns';
import { CompanyInteractions } from '@/components/crm/interactions';
import { CustomFieldList, DetailError, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RecordIntelligencePanel } from '@/components/crm/record-intelligence';
import { RelatedDeals } from '@/components/crm/related-deals';
import { CompanyRfqs } from '@/components/crm/rfqs';
import { CompanyPortal } from '@/components/portal/company-portal';
import { CompanyCommercial } from '@/components/revenue/record-commercial';
import { RecordVoiceNotes } from '@/components/voice/voice-note';
import { useCompanyEmployees } from '@/lib/company-work';
import { useRecord } from '@/lib/crm';
import { useT } from '@/lib/i18n';

/**
 * The company dashboard (ADR 0060, Phase 3): the profile header with quick actions, the company KPIs, then the
 * relationship in detail. There is deliberately no "recent history" panel: interactions are their own log.
 */
export function CompanyDetail({ id }: { id: string }) {
  const company = useRecord<CompanyRow>('companies', id);
  const employees = useCompanyEmployees(id);
  const t = useT();
  const uploadFailed = useSearchParams().get('uploadFailed');
  if (company.isPending) return <DetailSkeleton />;
  if (company.error) return <DetailError error={company.error} />;
  const c = company.data;
  const people = (employees.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const ref = { id, name: c.name, ownerId: c.ownerPerson?.id ?? c.owner?.id ?? null, restricted: c.restricted };
  return (
    <CompanyActionsProvider>
      <div className="max-w-7xl">
        <CompanyHero company={c} actions={<RecordHeader bare entity="companies" id={id} title={c.name} row={c as unknown as Record<string, unknown>} actions={<CompanyExportMenu companyId={id} />} />} />
        {uploadFailed && (
          <p role="alert" className="mb-4 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm">
            {t('The lead was saved, but these files could not be uploaded: {names}. Add them again below.', { names: uploadFailed })}
          </p>
        )}
        <CompanyKpis companyId={id} />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            <BusinessInformation company={c} />
            <CompanyEmailAssistant company={c} />
            <CompanyBusiness companyId={id} />
            <CompanyEmployeeDirectory company={c} />
            <CompanyInteractions company={ref} employees={people} />
            <CompanyRfqs company={ref} employees={people} />
            <RelatedDeals filter={{ companyId: id }} />
            <CompanyBranches company={c} />
            <CompanyCommercial company={{ id, name: c.name }} />
            <CompanyPortal company={{ id, name: c.name }} />
            <RecordVoiceNotes record={{ type: 'company', id, name: c.name }} />
          </div>
          <div className="min-w-0 space-y-4">
            <CompanyLeadCard company={c} />
            <CompanyAutofill company={c} />
            <CompanyFollowUps company={ref} employees={people} />
            <CompanyOwnership company={c} />
            <CompanyConcerns company={ref} employees={people} />
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
    </CompanyActionsProvider>
  );
}
