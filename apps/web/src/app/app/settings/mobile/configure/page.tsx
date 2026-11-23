import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { MobileConfigCenterScreen } from './config-center';

export const metadata: Metadata = { title: 'Mobile configuration' };

export default function MobileConfigurationPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Mobile configuration" description="Decide how the app looks and what each workspace level sees and may do, preview it, and publish it to phones." />
      <MobileConfigCenterScreen />
    </div>
  );
}
