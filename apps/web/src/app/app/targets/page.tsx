import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { TargetsBoard } from '@/components/workspace-work/targets';

export const metadata: Metadata = { title: 'Targets' };

export default function TargetsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Targets" description="Targets for each workspace, who set them and how far each has got. Progress is counted from real companies, calls and won business." />
      <TargetsBoard />
    </div>
  );
}
