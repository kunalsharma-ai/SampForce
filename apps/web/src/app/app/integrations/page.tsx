import { Badge, Card } from '@dealflow/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Integrations' };

const CATALOG: { category: string; items: { name: string; phase: number; needs: string }[] }[] = [
  { category: 'Email & calendar', items: [
    { name: 'Google Workspace (Gmail, Calendar)', phase: 3, needs: 'Google OAuth client and verification' },
    { name: 'Microsoft 365 (Outlook, Calendar)', phase: 3, needs: 'Entra ID app registration' },
  ] },
  { category: 'Collaboration', items: [
    { name: 'Slack', phase: 3, needs: 'Slack app credentials' },
    { name: 'Microsoft Teams', phase: 3, needs: 'Entra ID app registration' },
    { name: 'Zoom', phase: 3, needs: 'Zoom OAuth app' },
  ] },
  { category: 'Communication', items: [
    { name: 'Twilio (SMS, voice)', phase: 5, needs: 'Twilio account and number registration' },
    { name: 'WhatsApp Business Platform', phase: 5, needs: 'Meta Business verification' },
  ] },
  { category: 'Payments & documents', items: [
    { name: 'Stripe', phase: 6, needs: 'Stripe account and webhook secret' },
    { name: 'Razorpay', phase: 6, needs: 'Razorpay account' },
    { name: 'DocuSign', phase: 5, needs: 'DocuSign developer account' },
  ] },
  { category: 'Automation & developer', items: [
    { name: 'Outbound webhooks', phase: 3, needs: 'None (native)' },
    { name: 'Zapier / Make / n8n', phase: 3, needs: 'Partner app listing' },
    { name: 'REST API keys', phase: 2, needs: 'None (native)' },
  ] },
];

/**
 * Integration status board. Nothing is shown as connected until its adapter has been built
 * and tested against real credentials.
 */
export default function IntegrationsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Integrations" description="Connection status for every planned integration. None are connected in this workspace yet." />
      <div className="space-y-6">
        {CATALOG.map((group) => (
          <section key={group.category} aria-labelledby={`int-${group.category}`}>
            <h2 id={`int-${group.category}`} className="mb-2 text-sm font-semibold text-muted-foreground">
              {group.category}
            </h2>
            <Card className="divide-y divide-border">
              {group.items.map((i) => (
                <div key={i.name} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">Requires: {i.needs}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>Not connected</Badge>
                    <Badge tone="primary">Phase {i.phase}</Badge>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
