import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { AuditLogTable } from './audit-log-table';

export const metadata: Metadata = { title: 'Administration' };

export default function AdministrationPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Administration"
        description="An append-only record of security-relevant and administrative events in this workspace."
      />
      <AuditLogTable />
    </div>
  );
}
