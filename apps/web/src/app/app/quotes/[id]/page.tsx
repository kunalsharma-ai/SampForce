import type { Metadata } from 'next';
import { RequirePermission } from '@/components/require-permission';
import { QuoteEditor } from './quote-editor';

export const metadata: Metadata = { title: 'Quote' };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-6xl">
      <RequirePermission permission="quotes:read">
        <QuoteEditor id={id} />
      </RequirePermission>
    </div>
  );
}
