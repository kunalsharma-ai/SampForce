import { LayoutTemplate, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
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
        actions={
          <>
            <Link href="/app/quotes/templates" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
              <LayoutTemplate className="size-4" aria-hidden /> Bid templates
            </Link>
            <Link href="/app/quotes/quick" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Zap className="size-4" aria-hidden /> Quick Bid Studio
            </Link>
          </>
        }
      />
      <RequirePermission permission="quotes:read">
        <QuotesWorkspace />
      </RequirePermission>
    </div>
  );
}
