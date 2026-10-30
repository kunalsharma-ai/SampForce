import type { Metadata } from 'next';
import { RequirePermission } from '@/components/require-permission';
import { ContractDetail } from './contract-detail';

export const metadata: Metadata = { title: 'Contract' };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-5xl">
      <RequirePermission permission="contracts:read">
        <ContractDetail id={id} />
      </RequirePermission>
    </div>
  );
}
