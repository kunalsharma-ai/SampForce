import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { AnnouncementsBoard } from './announcements-board';

export const metadata: Metadata = { title: 'Announcements' };

export default function AnnouncementsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Announcements" description="Notices to everyone in the organisation. They show here and on the phone's home screen, and arrive as a notification." />
      <AnnouncementsBoard />
    </div>
  );
}
