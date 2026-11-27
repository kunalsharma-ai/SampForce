import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { CrmConfiguration } from './crm-configuration';

export const metadata: Metadata = { title: 'CRM configuration' };

export default function CrmConfigurationPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="CRM configuration" description="Company numbers, statuses, departments, designations, custom fields, notifications, currency, export permissions and dashboards for your sales team." />
      <CrmConfiguration />
    </div>
  );
}
