import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { ChevronRight, ListPlus, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { AppearanceSettings } from './appearance-settings';
import { RegionalSettings } from './regional-settings';
import { WorkspaceSettings } from './workspace-settings';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Workspace details, display preferences, language and region, custom fields and data import." />
      <WorkspaceSettings />
      <AppearanceSettings />
      <RegionalSettings />
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {[
            { href: '/app/settings/custom-fields', icon: ListPlus, title: 'Custom fields', text: 'Add fields to leads, contacts, companies and deals.' },
            { href: '/app/settings/import', icon: Upload, title: 'Import data', text: 'Bring in records from a CSV file, with a check before anything is saved.' },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-3 px-6 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <l.icon className="size-5 text-muted-foreground" aria-hidden />
              <span className="flex-1">
                <span className="block text-sm font-medium">{l.title}</span>
                <span className="block text-sm text-muted-foreground">{l.text}</span>
              </span>
              <ChevronRight className="rtl:-scale-x-100 size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
