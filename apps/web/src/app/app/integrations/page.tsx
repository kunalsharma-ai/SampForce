import { Badge, Card } from '@dealflow/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { MailboxConnections, WebhooksManager } from './integrations-board';

export const metadata: Metadata = { title: 'Integrations' };

/** Integrations not built yet. Nothing here is shown as connected until its adapter exists and is tested. */
const PLANNED: { category: string; items: { name: string; phase: string; needs: string }[] }[] = [
  { category: 'Collaboration', items: [
    { name: 'Slack', phase: 'Later phase', needs: 'Slack app credentials' },
    { name: 'Microsoft Teams', phase: 'Later phase', needs: 'Entra ID app registration' },
    { name: 'Zoom', phase: 'Later phase', needs: 'Zoom OAuth app' },
  ] },
  { category: 'Communication', items: [
    { name: 'Twilio (SMS, voice)', phase: 'Phase 5', needs: 'Twilio account and number registration' },
    { name: 'WhatsApp Business Platform', phase: 'Phase 5', needs: 'Meta Business verification' },
  ] },
  { category: 'Payments & documents', items: [
    { name: 'Stripe', phase: 'Phase 6', needs: 'Stripe account and webhook secret' },
    { name: 'Razorpay', phase: 'Phase 6', needs: 'Razorpay account' },
    { name: 'DocuSign', phase: 'Phase 5', needs: 'DocuSign developer account' },
  ] },
  { category: 'Automation & developer', items: [
    { name: 'Zapier / Make / n8n', phase: 'Later phase', needs: 'Partner app listing' },
    { name: 'REST API keys', phase: 'Later phase', needs: 'None (native)' },
  ] },
];

export default function IntegrationsPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <PageHeader title="Integrations" description="Connect your own mailbox and calendar, manage outbound webhooks, and see which integrations are still planned." />
      <Suspense>
        <MailboxConnections />
      </Suspense>
      <WebhooksManager />
      <section aria-labelledby="planned-heading" className="space-y-4">
        <h2 id="planned-heading" className="text-base font-semibold">
          Planned integrations
        </h2>
        {PLANNED.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{group.category}</h3>
            <Card className="divide-y divide-border">
              {group.items.map((i) => (
                <div key={i.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">Requires: {i.needs}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>Not available yet</Badge>
                    <Badge tone="primary">{i.phase}</Badge>
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
