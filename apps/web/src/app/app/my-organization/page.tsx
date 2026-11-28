import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrganizationHub } from '@/components/my-organization/hub';

export const metadata: Metadata = { title: 'My Organization' };

/** My Organization (ADR 0100): the organisation's own profile, documents, credentials and client shares. */
export default function MyOrganizationPage() {
  return (
    <div className="max-w-7xl">
      <Suspense>
        <OrganizationHub />
      </Suspense>
    </div>
  );
}
