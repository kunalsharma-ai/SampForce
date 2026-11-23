import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { ChangePasswordCard } from './change-password-card';
import { DeviceList } from './device-list';
import { ProfilePhotoCard } from './profile-photo-card';
import { TwoStepCard } from './two-step-card';

export const metadata: Metadata = { title: 'Account security' };

export default function AccountSecurityPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Account security" description="Your password, two-step verification and the devices signed in to your SampForce account." />
      <ProfilePhotoCard />
      <ChangePasswordCard />
      <TwoStepCard />
      <div id="devices" className="scroll-mt-20">
        <DeviceList />
      </div>
    </div>
  );
}
