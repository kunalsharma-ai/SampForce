import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { CallsWorkspace } from './calls-workspace';

export const metadata: Metadata = { title: 'Calls' };

export default function CallsPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Calls" description="Call any company or employee through your own dialer, with their details on the call card. Log what happened, add remarks and schedule the next call." />
      <Suspense>
        <CallsWorkspace />
      </Suspense>
    </div>
  );
}
