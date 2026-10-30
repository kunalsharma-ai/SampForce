import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { QuotesWorkspace } from './quotes-workspace';

export const metadata: Metadata = { title: 'Quotes & Proposals' };

export default function QuotesPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Quotes & Proposals"
        description="Quotes priced from your price books. Discounts above your workspace limit need approval from someone else before the quote can be sent."
      />
      <RequirePermission permission="quotes:read">
        <QuotesWorkspace />
      </RequirePermission>
    </div>
  );
}
