import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { SampbidxSettings } from './sampbidx-settings';

export const metadata: Metadata = { title: 'SampBidx settings' };

export default function SampbidxSettingsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="SampBidx settings" description="The connection to SampBidx as it really is, a step-by-step connection test, what has been sent, what failed and why, and which SampForce field fills which SampBidx field." />
      <SampbidxSettings />
    </div>
  );
}
