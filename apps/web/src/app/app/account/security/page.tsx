import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { DeviceList } from './device-list';
import { TwoStepCard } from './two-step-card';

export const metadata: Metadata = { title: 'Account security' };

export default function AccountSecurityPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Account security" description="Two-step verification and the devices signed in to your SampForce account." />
      <TwoStepCard />
      <DeviceList />
    </div>
  );
}
