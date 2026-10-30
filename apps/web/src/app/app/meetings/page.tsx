import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { MeetingsList } from './meetings-list';

export const metadata: Metadata = { title: 'Meetings' };

export default function MeetingsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Meetings" description="Calendar events with your contacts, synced from Google Calendar or Outlook for the past 30 and next 60 days. Events without a known contact are not stored." />
      <MeetingsList />
    </div>
  );
}
