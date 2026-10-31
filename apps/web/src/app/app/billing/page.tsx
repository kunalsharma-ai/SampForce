import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { BillingWorkspace } from './billing-workspace';

export const metadata: Metadata = { title: 'Billing' };

export default function BillingPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Billing" description="Your plan, seats, usage against plan allowances, and invoices." />
      <RequirePermission permission="billing:read">
        <Suspense>
          <BillingWorkspace />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
