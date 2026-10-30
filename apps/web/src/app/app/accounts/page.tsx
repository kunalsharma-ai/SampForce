import type { Metadata } from 'next';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Accounts' };

/** Accounts are companies you have won business with: the Companies table filtered to customers. */
export default function AccountsPage() {
  return (
    <RecordList
      entity="companies"
      title="Accounts"
      fixedStatus="customer"
      description="Companies with at least one won deal. Account health and account-level forecasting arrive in later phases."
    />
  );
}
