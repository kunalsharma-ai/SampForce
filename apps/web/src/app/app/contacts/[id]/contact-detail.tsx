'use client';

import { consentLabel } from '@/lib/crm-fields';
import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { ContactRow } from '@dealflow/types';
import Link from 'next/link';
import { CustomFieldList, DetailError, DetailList, DetailSkeleton, RecordHeader } from '@/components/crm/record-detail';
import { RecordEmails } from '@/components/crm/record-emails';
import { RecordSequences } from '@/components/crm/record-sequences';
import { RelatedDeals } from '@/components/crm/related-deals';
import { ActivityTimeline, RecordTasks } from '@/components/crm/timeline';
import { formatDate, useRecord } from '@/lib/crm';

export function ContactDetail({ id }: { id: string }) {
  const contact = useRecord<ContactRow>('contacts', id);
  if (contact.isPending) return <DetailSkeleton />;
  if (contact.error) return <DetailError error={contact.error} />;
  const c = contact.data;
  return (
    <div className="max-w-6xl">
      <RecordHeader
        entity="contacts"
        id={id}
        title={c.fullName}
        subtitle={[c.jobTitle, c.company?.name].filter(Boolean).join(' · ') || undefined}
        row={c as unknown as Record<string, unknown>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ['Email', c.email && <a className="text-primary hover:underline" href={`mailto:${c.email}`}>{c.email}</a>],
                  ['Phone', c.phone && <a className="hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>],
                  ['Company', c.company && <Link className="text-primary hover:underline" href={`/app/companies/${c.company.id}`}>{c.company.name}</Link>],
                  ['Job title', c.jobTitle],
                  ['Country', c.country],
                  ['Time zone', c.timezone],
                  ['Marketing consent', consentLabel(c.marketingConsent, c.consentSource)],
                  ['Owner', c.owner?.name],
                  ['Created', formatDate(c.createdAt)],
                ]}
              />
            </CardContent>
          </Card>
          <RelatedDeals filter={{ contactId: id }} />
          <RecordEmails contactId={id} email={c.email} />
          <ActivityTimeline related={{ contactId: id }} timeline={{ entity: 'contact', id }} />
        </div>
        <div className="space-y-4">
          <RecordSequences contactId={id} email={c.email} />
          <RecordTasks related={{ contactId: id }} />
          <CustomFieldList entity="contacts" values={c.customFields} />
        </div>
      </div>
    </div>
  );
}
