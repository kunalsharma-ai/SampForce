'use client';

import { consentLabel } from '@/lib/crm-fields';
import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { CompanyRow, ContactRow } from '@dealflow/types';
import { ClientTimeCard, type ClientTimeSubject, ConnectCheck } from '@/components/crm/client-time';
import { CustomFieldList, DetailError, DetailList, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RecordEmails } from '@/components/crm/record-emails';
import { RfqCapture } from '@/components/sampbidx/rfq-capture';
import { RecordMeetings } from '@/components/meetings/record-meetings';
import { RecordZoomMeetings } from '@/components/meetings/zoom-meetings';
import { ContactWhatsapp } from '@/components/whatsapp/contact-whatsapp';
import { ContactSms } from '@/components/sms/contact-sms';
import { RecordSequences } from '@/components/crm/record-sequences';
import { RelatedDeals } from '@/components/crm/related-deals';
import { RecordIntelligencePanel } from '@/components/crm/record-intelligence';
import { EmailStatusBadge } from '@/components/crm/email-status';
import { EmployeeCommunicationCard } from '@/components/crm/employee-activity';
import { CallButton } from '@/components/calls/call-button';
import { EmployeeDetails, EmployeeRelationship } from '@/components/crm/employee-profile';
import { ActivityTimeline, RecordTasks } from '@/components/crm/timeline';
import { RecordWebActivityCard } from '@/components/visitors/visitors';
import { RecordVoiceNotes } from '@/components/voice/voice-note';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDate, useRecord } from '@/lib/crm';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';

export function ContactDetail({ id }: { id: string }) {
  const contact = useRecord<ContactRow>('contacts', id);
  if (contact.isPending) return <DetailSkeleton />;
  if (contact.error) return <DetailError error={contact.error} />;
  return <ContactBody contact={contact.data} />;
}

/** The employee's own location wins; without a country, their company's head office is used (ADR 0089). */
function useTimeSubject(c: ContactRow): ClientTimeSubject {
  const company = useQuery({
    enabled: !!c.company?.id,
    queryKey: ['companies', 'detail', c.company?.id],
    queryFn: () => api<CompanyRow>(`/companies/${c.company!.id}`),
    retry: false,
  });
  const co = company.data;
  const own = !!c.country;
  return {
    kind: 'contact',
    id: c.id,
    name: c.fullName,
    place: own ? { country: c.country, state: c.state, city: c.city, timezone: c.timezone } : { country: co?.country, state: co?.state, city: co?.city, headquarters: co?.headquarters, timezone: c.timezone ?? co?.timezone },
    placeFromCompany: !own,
    hours: c.workingHours,
    companyHours: co?.workingHours,
  };
}

function ContactBody({ contact: c }: { contact: ContactRow }) {
  const t = useT();
  const id = c.id;
  const stages = useHasFeature('rfq_contributors');
  const timeSubject = useTimeSubject(c);
  return (
    <ConnectCheck subject={timeSubject}>
    <div className="max-w-6xl">
      <RecordHeader
        entity="contacts"
        id={id}
        title={c.fullName}
        subtitle={[c.jobTitle, c.company?.name].filter(Boolean).join(' · ') || undefined}
        row={c as unknown as Record<string, unknown>}
        actions={<CallButton companyId={c.company?.id ?? null} contactId={id} name={c.fullName} variant="chip" />}
      />
      <ClientTimeCard subject={timeSubject} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <EmployeeRelationship contact={c} />
          {stages && <EmployeeCommunicationCard contactId={id} restricted={c.restricted} />}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('Details')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <EmployeeDetails contact={c} />
              <DetailList
                items={[
                  ['Time zone', c.timezone],
                  ['Marketing consent', consentLabel(c.marketingConsent, c.consentSource, t.maybe)],
                  ['Email status', c.emailStatus && <EmailStatusBadge status={c.emailStatus} />],
                  ['Engagement score', c.engagementScore !== null ? `${c.engagementScore} / 100` : null],
                  ['Owner', c.owner?.name],
                  ['Created', formatDate(c.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
          <RelatedDeals filter={{ contactId: id }} />
          <RfqCapture source={{ type: 'contact', id }} companyId={c.company?.id ?? null} contactId={id} />
          <RecordEmails contactId={id} email={c.email} />
          <RecordMeetings target={{ contactId: id }} />
          <RecordZoomMeetings target={{ contactId: id }} />
          <RecordVoiceNotes record={{ type: 'contact', id, name: c.fullName }} />
          <RecordWebActivityCard type="contact" id={id} />
          <ActivityTimeline related={{ contactId: id }} timeline={{ entity: 'contact', id }} />
        </div>
        <div className="space-y-4">
          <RecordIntelligencePanel entity="contact" id={id} name={c.fullName} />
          <ContactWhatsapp contactId={id} />
          <ContactSms contactId={id} />
          <RecordSequences contactId={id} email={c.email} />
          <RecordTasks related={{ contactId: id }} />
          <CustomFieldList entity="contacts" values={c.customFields} />
        </div>
      </div>
    </div>
    </ConnectCheck>
  );
}
