'use client';

import type { CompanyRow } from '@dealflow/types';
import { Card } from '@dealflow/ui';
import {
  Activity,
  BarChart3,
  Brain,
  Building2,
  CalendarClock,
  FileSignature,
  FileText,
  GitBranch,
  Globe,
  Handshake,
  MessagesSquare,
  Mic,
  Paperclip,
  Route,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserCheck,
  Users,
  Wand2,
  ChevronDown,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { CompanyActionsProvider } from '@/components/crm/company-actions';
import {
  CompanyBusiness,
  CompanyEmployeeDirectory,
  CompanyHero,
  CompanyKpis,
} from '@/components/crm/company-dashboard';
import { CompanyStatusBar } from '@/components/crm/company-lead-card';
import { CompanyAutofill } from '@/components/crm/company-autofill';
import { ClientTimeCard, type ClientTimeSubject, ConnectCheck } from '@/components/crm/client-time';
import { CompanyExportMenu } from '@/components/crm/company-export';
import { CompanyFollowUps } from '@/components/crm/follow-ups';
import { CompanyConcerns } from '@/components/command-center/concerns';
import { CompanyJourneyCard } from '@/components/crm/journey';
import { RecordIntelligencePanel } from '@/components/crm/record-intelligence';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BusinessInformation } from '@/components/crm/business-information';
import { CompanyEmailAssistant } from '@/components/crm/company-email-assistant';
import { EmployeeActivitySection } from '@/components/crm/employee-activity';
import { CompanyBranches, CompanyFiles, CompanyOwnership } from '@/components/crm/company-parts';
import { CompanyInteractions } from '@/components/crm/interactions';
import { CompanyWonButton } from '@/components/crm/company-won';
import {
  CustomFieldList,
  DetailError,
  DetailSkeleton,
  RecordHeader,
} from '@/components/crm/record-detail';
import { RelatedDeals } from '@/components/crm/related-deals';
import { CompanyRfqs } from '@/components/crm/rfqs';
import { CompanyPortal } from '@/components/portal/company-portal';
import { SendCompanyButton } from '@/components/sampbidx/send-company';
import { CompanyCommercial } from '@/components/revenue/record-commercial';
import { RecordVoiceNotes } from '@/components/voice/voice-note';
import { SectionTone } from '@/components/crm/section-tone';
import { useCompanyEmployees } from '@/lib/company-work';
import { useRecord } from '@/lib/crm';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';

/**
 * The company dashboard (ADR 0060, Phase 3): the profile header with quick actions, the company KPIs, then the
 * relationship in detail. There is deliberately no "recent history" panel: interactions are their own log.
 */
const MORE_KEY = 'sf.companyMore';
/** Whether "More about this company" was left open on this device (closed until someone opens it). */
function useMoreOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(MORE_KEY) === 'open');
    } catch {
      /* private window: stays closed */
    }
  }, []);
  return [
    open,
    (next) => {
      setOpen(next);
      try {
        localStorage.setItem(MORE_KEY, next ? 'open' : 'closed');
      } catch {
        /* not remembered */
      }
    },
  ];
}

export function CompanyDetail({ id }: { id: string }) {
  const company = useRecord<CompanyRow>('companies', id);
  const employees = useCompanyEmployees(id);
  const t = useT();
  const stages = useHasFeature('rfq_contributors');
  const uploadFailed = useSearchParams().get('uploadFailed');
  const [moreOpen, rememberMore] = useMoreOpen();
  if (company.isPending) return <DetailSkeleton />;
  if (company.error) return <DetailError error={company.error} />;
  const c = company.data;
  const people = (employees.data ?? []).map((e) => ({ id: e.id, name: e.name }));
  const ref = {
    id,
    name: c.name,
    ownerId: c.ownerPerson?.id ?? c.owner?.id ?? null,
    restricted: c.restricted,
  };
  // Their local time and the best time to connect (ADR 0089), from the head-office address.
  const timeSubject: ClientTimeSubject = {
    kind: 'company',
    id,
    name: c.name,
    place: { country: c.country, state: c.state, city: c.city, headquarters: c.headquarters, timezone: c.timezone },
    hours: c.workingHours,
    offices: c.addresses,
  };
  return (
    <CompanyActionsProvider>
      <ConnectCheck subject={timeSubject}>
      <div className="max-w-7xl">
        <CompanyHero
          company={c}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <CompanyWonButton company={c} />
              <SendCompanyButton company={{ id, name: c.name }} />
              <RecordHeader
                bare
                entity="companies"
                id={id}
                title={c.name}
                row={c as unknown as Record<string, unknown>}
                actions={<CompanyExportMenu companyId={id} />}
              />
            </div>
          }
        />
        <ClientTimeCard subject={timeSubject} />
        {uploadFailed && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm"
          >
            {t(
              'The lead was saved, but these files could not be uploaded: {names}. Add them again below.',
              { names: uploadFailed },
            )}
          </p>
        )}
        <CompanyKpis companyId={id} />
        {/* The right-hand column is gone (Kunal, redesign): the page is one column, with the lead status in the middle. */}
        <div className="space-y-5">
          <SectionTone color="#e11d48" second="#ea580c" icon={Target} name="lead-status">
            <Card className="p-5 sm:p-6">
              <CompanyStatusBar company={c} />
            </Card>
          </SectionTone>
            <SectionTone
              color="#4f46e5"
              second="#0891b2"
              icon={Building2}
              name="business-information"
            >
              <BusinessInformation company={c} />
            </SectionTone>
            <SectionTone color="#9333ea" second="#db2777" icon={Sparkles} name="email-assistant">
              <CompanyEmailAssistant company={c} />
            </SectionTone>
            <SectionTone color="#0d9488" second="#16a34a" icon={BarChart3} name="business-overview">
              <CompanyBusiness companyId={id} />
            </SectionTone>
            <SectionTone color="#0284c7" second="#4f46e5" icon={Users} name="employees">
              <CompanyEmployeeDirectory company={c} />
            </SectionTone>
            {stages && (
              <SectionTone
                color="#7c3aed"
                second="#db2777"
                icon={Activity}
                name="employee-activity"
              >
                <EmployeeActivitySection
                  companyId={id}
                  companyName={c.name}
                  restricted={c.restricted}
                />
              </SectionTone>
            )}
            <SectionTone color="#0891b2" second="#2563eb" icon={MessagesSquare} name="interactions">
              <CompanyInteractions company={ref} employees={people} />
            </SectionTone>
            <SectionTone color="#ea580c" second="#d97706" icon={FileText} name="rfqs">
              <CompanyRfqs company={ref} employees={people} />
            </SectionTone>
            <SectionTone color="#16a34a" second="#0d9488" icon={Handshake} name="deals">
              <RelatedDeals filter={{ companyId: id }} />
            </SectionTone>
            <SectionTone color="#4f46e5" second="#7c3aed" icon={GitBranch} name="branches">
              <CompanyBranches company={c} />
            </SectionTone>
            <SectionTone color="#ca8a04" second="#ea580c" icon={FileSignature} name="commercial">
              <CompanyCommercial company={{ id, name: c.name }} />
            </SectionTone>
            <SectionTone color="#2563eb" second="#0891b2" icon={Globe} name="portal">
              <CompanyPortal company={{ id, name: c.name }} />
            </SectionTone>
            <SectionTone color="#db2777" second="#9333ea" icon={Mic} name="voice-notes">
              <RecordVoiceNotes record={{ type: 'company', id, name: c.name }} />
            </SectionTone>
        </div>
        {/* The rest stays one click away, closed (Kunal, redesign): the quick actions above still open these. */}
        <details id="company-more" data-company-more="" open={moreOpen} onToggle={(e) => rememberMore(e.currentTarget.open)} className="group mt-6 rounded-2xl border border-dashed border-border bg-surface/60 p-4">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
            {t('More about this company')}
          </summary>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            <SectionTone color="#2563eb" second="#7c3aed" icon={Route} name="journey">
              <CompanyJourneyCard companyId={id} />
            </SectionTone>
            <SectionTone color="#7c3aed" second="#2563eb" icon={Wand2} name="autofill">
              <CompanyAutofill company={c} />
            </SectionTone>
            <SectionTone color="#d97706" second="#e11d48" icon={CalendarClock} name="follow-ups">
              <CompanyFollowUps company={ref} employees={people} />
            </SectionTone>
            <SectionTone color="#0d9488" second="#0284c7" icon={UserCheck} name="ownership">
              <CompanyOwnership company={c} />
            </SectionTone>
            <SectionTone color="#dc2626" second="#ea580c" icon={ShieldAlert} name="concerns">
              <CompanyConcerns company={ref} employees={people} />
            </SectionTone>
            <SectionTone color="#0284c7" second="#0d9488" icon={Paperclip} name="files">
              <CompanyFiles company={c} />
            </SectionTone>
            <SectionTone color="#9333ea" second="#4f46e5" icon={Brain} name="intelligence">
              <RecordIntelligencePanel entity="company" id={id} name={c.name} />
            </SectionTone>
            {c.parentCompany && (
              <p className="text-sm">
                {t('Parent company')}:{' '}
                <Link
                  className="text-primary hover:underline"
                  href={`/app/companies/${c.parentCompany.id}`}
                >
                  {c.parentCompany.name}
                </Link>
              </p>
            )}
            <SectionTone
              color="#64748b"
              second="#0891b2"
              icon={SlidersHorizontal}
              name="custom-fields"
            >
              <CustomFieldList entity="companies" values={c.customFields} />
            </SectionTone>
          </div>
        </details>
      </div>
      </ConnectCheck>
    </CompanyActionsProvider>
  );
}
