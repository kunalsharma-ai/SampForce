import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { QuickBidStudio } from './quick-bid-studio';

export const metadata: Metadata = { title: 'Quick Bid Studio' };

export default function QuickBidPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Quick Bid Studio"
        description="Build a priced proposal in four steps with a live preview. Your work saves as you go."
      />
      <RequirePermission permission="quotes:write">
        <Suspense>
          <QuickBidStudio />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
