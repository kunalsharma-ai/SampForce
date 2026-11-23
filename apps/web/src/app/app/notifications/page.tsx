import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { NotificationCenter } from './notification-center';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Notifications"
        description="Everything SampForce has told you, newest first: assignments, approvals, reminders and updates from every section. Read and unread match the bell, the home dashboard and each section."
      />
      <NotificationCenter />
    </div>
  );
}
