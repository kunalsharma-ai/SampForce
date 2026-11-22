import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { MobileAccessSettings } from './mobile-access-settings';

export const metadata: Metadata = { title: 'Mobile app' };

export default function MobileSettingsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Mobile app" description="Let your people use SampForce on iPhone and Android, with the same accounts, data and permissions as the web." />
      <MobileAccessSettings />
    </div>
  );
}
