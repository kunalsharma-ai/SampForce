import { Badge, Card } from '@dealflow/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { Tr } from '@/lib/i18n';
import { ApiKeysAndZapier } from './api-keys';
import { BrowserExtension } from './browser-extension';
import { MailboxConnections, WebhooksManager } from './integrations-board';
import { WorkspaceApps } from './workspace-apps';

export const metadata: Metadata = { title: 'Integrations' };

/** Integrations not built yet. Nothing here is shown as connected until its adapter exists and is tested. */
const PLANNED: { category: string; items: { name: string; phase: string; needs: string }[] }[] = [
  { category: 'Communication', items: [
    { name: 'Twilio voice calls', phase: 'Later phase', needs: 'Twilio Voice and call recording consent rules' },
  ] },
];

export default function IntegrationsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader title="Integrations" description="Connect your own mailbox and calendar, connect workspace apps such as Slack, set up the browser extension, connect Zapier with API keys, manage outbound webhooks, and see which integrations are still planned." />
      <Suspense>
        <MailboxConnections />
      </Suspense>
      <Suspense>
        <WorkspaceApps />
      </Suspense>
      <BrowserExtension />
      <ApiKeysAndZapier />
      <WebhooksManager />
      <section aria-labelledby="planned-heading" className="space-y-4">
        <h2 id="planned-heading" className="text-base font-semibold">
          <Tr text="Planned integrations" />
        </h2>
        {PLANNED.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground"><Tr text={group.category} /></h3>
            <Card className="divide-y divide-border">
              {group.items.map((i) => (
                <div key={i.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium"><Tr text={i.name} /></p>
                    <p className="text-xs text-muted-foreground"><Tr text="Requires:" /> <Tr text={i.needs} /></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge><Tr text="Not available yet" /></Badge>
                    <Badge tone="primary"><Tr text={i.phase} /></Badge>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </section>
    </div>
  );
}
