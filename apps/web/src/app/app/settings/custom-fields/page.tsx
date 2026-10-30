import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { CustomFieldsManager } from './custom-fields-manager';

export const metadata: Metadata = { title: 'Custom fields' };

export default function CustomFieldsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Custom fields" description="Extra fields on leads, contacts, companies and deals. They appear in forms, record pages, imports and exports." />
      <CustomFieldsManager />
    </div>
  );
}
