import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import {
  Bell,
  Blocks,
  ChevronRight,
  FileClock,
  KeyRound,
  ListPlus,
  LockKeyhole,
  MapPinned,
  Megaphone,
  MonitorSmartphone,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Upload,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Tr } from '@/lib/i18n';
import { AppearanceSettings } from './appearance-settings';
import { RegionalSettings } from './regional-settings';
import { SettingsJump } from './settings-jump';
import { WorkspaceSettings } from './workspace-settings';

export const metadata: Metadata = { title: 'Settings' };

type SettingsLink = { href: string; icon: LucideIcon; title: string; text: string };
type SettingsSection = { id: string; title: string; text: string; links: SettingsLink[] };

/*
 * Settings in nine sections (workspace redesign W6), each with one sentence on what it is for. The first holds the
 * workspace's own forms; the others lead to the pages that already exist, so every old link keeps working.
 */
const SECTIONS: SettingsSection[] = [
  {
    id: 'users',
    title: 'Users & Workspaces',
    text: 'Who works here and where: the workspace structure, the people and their invitations.',
    links: [
      { href: '/app/settings/workspaces', icon: Network, title: 'Workspaces', text: 'Manager and Executive Workspaces, and what each may use and do.' },
      { href: '/app/team', icon: Users, title: 'Team and invitations', text: 'Members of this workspace, invitations and sales teams.' },
    ],
  },
  {
    id: 'roles',
    title: 'Roles & Permissions',
    text: 'What each person and each workspace below yours is allowed to see and do.',
    links: [
      { href: '/app/team#roles', icon: UserCog, title: 'Roles', text: 'Built-in and custom roles, and the permissions in each.' },
      { href: '/app/settings/workspaces#structure', icon: KeyRound, title: 'Permission Center', text: 'Open Actions, then Permissions, on a workspace below yours.' },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    text: 'How people sign in, which devices are signed in, and the rules for the whole organisation.',
    links: [
      { href: '/app/administration/security', icon: ShieldCheck, title: 'Workspace security', text: 'Require two-step verification, set up single sign-on and SCIM provisioning.' },
      { href: '/app/account/security#devices', icon: MonitorSmartphone, title: 'Signed-in devices', text: 'See the devices signed in to your account and sign any of them out.' },
      { href: '/app/settings/mobile', icon: Smartphone, title: 'Mobile app', text: 'iPhone and Android app: approval, switching it on and the phones signed in.' },
    ],
  },
  {
    id: 'password',
    title: 'Password & Authentication',
    text: 'Your own password and second step: change it, reset it if forgotten, or add an authenticator app.',
    links: [
      { href: '/app/account/security#change-password', icon: LockKeyhole, title: 'Change password', text: 'Your current password, then a new one. Other devices are signed out.' },
      { href: '/app/account/security', icon: ShieldCheck, title: 'Two-step verification', text: 'A code from an authenticator app after your password, and recovery codes.' },
      { href: '/forgot-password', icon: KeyRound, title: 'Reset a forgotten password', text: 'Get a one-time link by email to set a new password.' },
    ],
  },
  {
    id: 'data',
    title: 'Data Management',
    text: 'How your CRM records are shaped, and how data comes in.',
    links: [
      { href: '/app/settings/crm', icon: SlidersHorizontal, title: 'CRM configuration', text: 'Lead numbers, company and employee statuses, departments and designations.' },
      { href: '/app/settings/crm?section=fields', icon: ListPlus, title: 'Custom fields', text: 'Add fields to companies, employees, leads, deals, follow-ups and RFQs.' },
      { href: '/app/settings/import', icon: Upload, title: 'Import data', text: 'Bring in records from a CSV file, with a check before anything is saved.' },
      { href: '/app/settings/territories', icon: MapPinned, title: 'Territories', text: 'Sales territories by country.' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    text: 'What SampForce tells people about, and the notices you send to everyone.',
    links: [
      { href: '/app/settings/crm?section=notifications', icon: Bell, title: 'Notification rules', text: 'Reminders before follow-ups and meetings, and which events notify whom.' },
      { href: '/app/announcements', icon: Megaphone, title: 'Announcements', text: 'Notices to everyone in the organisation, on the web and the phone.' },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    text: 'The apps and services SampForce connects to, and the keys other systems use.',
    links: [{ href: '/app/integrations', icon: Blocks, title: 'Apps and connections', text: 'Slack, Teams, email servers, the browser extension and API keys.' }],
  },
  {
    id: 'audit',
    title: 'Audit Logs',
    text: 'A record of who did what, with whether it worked, that cannot be changed.',
    links: [{ href: '/app/administration', icon: FileClock, title: 'Audit log', text: 'Security and administrative events, and support access to your organisation.' }],
  },
];

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" description="Everything about your organisation, in nine sections." />
      <SettingsJump sections={[{ id: 'workspace', title: 'Workspace' }, ...SECTIONS.map(({ id, title }) => ({ id, title }))]} />
      <section id="workspace" aria-labelledby="settings-workspace" className="scroll-mt-20 space-y-4" data-settings-section="workspace">
        <div>
          <h2 id="settings-workspace" className="text-lg font-semibold">
            <Tr text="Workspace" />
          </h2>
          <p className="text-sm text-muted-foreground">
            <Tr text="Your company’s name and currency, its language and region, and how SampForce looks." />
          </p>
        </div>
        <WorkspaceSettings />
        <AppearanceSettings />
        <RegionalSettings />
      </section>
      {SECTIONS.map((s) => (
        <Card key={s.id} id={s.id} className="scroll-mt-20" data-settings-section={s.id}>
          <CardHeader>
            <CardTitle>
              <Tr text={s.title} />
            </CardTitle>
            <CardDescription>
              <Tr text={s.text} />
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {s.links.map((l) => (
              <Link key={l.href} href={l.href} className="flex items-center gap-3 px-6 py-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <l.icon className="size-5 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  <span className="block text-sm font-medium">
                    <Tr text={l.title} />
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    <Tr text={l.text} />
                  </span>
                </span>
                <ChevronRight className="rtl:-scale-x-100 size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
