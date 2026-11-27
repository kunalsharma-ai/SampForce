import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RfqsWorkspace } from './rfqs-workspace';

export const metadata: Metadata = { title: 'RFQs' };

export default function RfqsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="RFQs" description="Requests for quotation from your companies, with LOI, IR and CPI pricing, deadlines and outcomes. Receiving an RFQ is not won business." />
      <RfqsWorkspace />
    </div>
  );
}
