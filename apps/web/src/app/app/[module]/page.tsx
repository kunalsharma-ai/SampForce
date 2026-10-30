import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { findModule, MODULES, PHASE_NAMES } from '@/lib/navigation';

export function generateStaticParams() {
  return MODULES.filter((m) => m.status === 'planned').map((m) => ({ module: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }): Promise<Metadata> {
  const m = findModule((await params).module);
  return { title: m?.label ?? 'Not found' };
}

/**
 * Roadmap page for modules that have not shipped. It states plainly what is planned and when,
 * so navigation never dead-ends and nothing is presented as working before it is.
 */
export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const m = findModule((await params).module);
  if (!m || m.status !== 'planned') notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title={m.label} description={m.summary} />
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <m.icon className="size-5" aria-hidden />
          </span>
          <div>
            <CardTitle>Not available yet</CardTitle>
            <p className="text-sm text-muted-foreground">
              Scheduled for <Badge tone="primary">Phase {m.phase}: {PHASE_NAMES[m.phase]}</Badge>
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The data model for this module is designed and documented. Its screens, APIs and tests are built in the
            phase above and will replace this page when they pass acceptance tests.
          </p>
          <ul className="space-y-2">
            {m.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2 text-sm">
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
            Live today: authentication, workspaces, roles, audit log and the Command Center.
          </div>
          <Button asChild variant="outline">
            <Link href="/app">Back to the Command Center</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
