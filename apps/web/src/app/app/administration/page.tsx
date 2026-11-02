import { Card, CardContent } from '@dealflow/ui';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Tr } from '@/lib/i18n';
import { AuditLogTable } from './audit-log-table';
import { SupportAccess } from './support-access';

export const metadata: Metadata = { title: 'Administration' };

export default function AdministrationPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Administration"
        description="An append-only record of security-relevant and administrative events in this workspace."
      />
      <Card className="mb-6">
        <CardContent className="p-0">
          <Link href="/app/administration/security" className="flex items-center gap-3 px-6 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden />
            <span className="flex-1">
              <span className="block text-sm font-medium"><Tr text="Workspace security" /></span>
              <span className="block text-sm text-muted-foreground"><Tr text="Require two-step verification, set up single sign-on and SCIM provisioning." /></span>
            </span>
            <ChevronRight className="rtl:-scale-x-100 size-4 text-muted-foreground" aria-hidden />
          </Link>
        </CardContent>
      </Card>
      <SupportAccess />
      <AuditLogTable />
    </div>
  );
}
