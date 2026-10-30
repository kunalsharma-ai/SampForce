import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { AppearanceSettings } from './appearance-settings';
import { WorkspaceSettings } from './workspace-settings';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Workspace details and your personal display preferences." />
      <WorkspaceSettings />
      <AppearanceSettings />
    </div>
  );
}
