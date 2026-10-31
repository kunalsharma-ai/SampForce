import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { SequencesWorkspace } from './sequences-workspace';

export const metadata: Metadata = { title: 'Email Sequences' };

export default function SequencesPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Email Sequences"
        description="Series of personal emails, tasks and checks sent from your own Gmail or Outlook mailbox, inside a send window and under daily limits. Rules decide what happens when someone replies, opens, clicks, bounces or unsubscribes."
      />
      <RequirePermission permission="sequences:read">
        <SequencesWorkspace />
      </RequirePermission>
    </div>
  );
}
