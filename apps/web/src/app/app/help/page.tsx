import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Tr } from '@/lib/i18n';
import { FeatureGuide } from './feature-guide';

export const metadata: Metadata = { title: 'Help center' };

const TOPICS = [
  { q: 'What works today?', a: 'Sign-up, sign-in, multiple workspaces, roles and permissions, the audit log, workspace settings, appearance and motion preferences, and Command Center metrics computed from your data.' },
  { q: 'Why do some KPIs show a dash?', a: 'A dash means there is not enough data yet, or the module that produces the metric has not shipped. SampForce never fills dashboards with placeholder numbers.' },
  { q: 'How do I reduce motion?', a: 'Open Settings → Appearance & motion and choose Reduced or Off. Low-power mode also turns off ambient effects.' },
  { q: 'Who can change workspace settings?', a: 'Owners and administrators. Every change is recorded in Administration → Audit log.' },
  { q: 'Where is the API documentation?', a: 'The OpenAPI 3.1 specification is served at /api/v1/openapi.json, with an interactive explorer at /api/v1/docs.' },
];

export default function HelpPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Help center" description="Answers for the current release." />
      <Card>
        <CardHeader>
          <CardTitle>
            <Tr text="Frequently asked" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {TOPICS.map((t) => (
              <div key={t.q}>
                <dt className="font-medium">
                  <Tr text={t.q} />
                </dt>
                <dd className="mt-1 text-sm text-muted-foreground">
                  <Tr text={t.a} />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <FeatureGuide />
    </div>
  );
}
