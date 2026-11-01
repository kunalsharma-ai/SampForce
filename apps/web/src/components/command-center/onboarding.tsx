'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useOnboarding } from '@/lib/billing';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** Getting-started checklist. Steps tick themselves off from real workspace data. */
export function OnboardingChecklist() {
  const q = useOnboarding();
  const qc = useQueryClient();
  const canDismiss = useCan('tenant:manage');
  const t = useT();
  const dismiss = useMutation({
    mutationFn: () => api('/onboarding/dismiss', { method: 'POST', json: { dismissed: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding'] }),
  });
  if (!q.data || q.data.dismissed) return null;
  const done = q.data.steps.filter((s) => s.done).length;
  if (done === q.data.steps.length) return null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{t('Get your workspace ready')}</CardTitle>
          <CardDescription>{t('{done} of {total} done', { done, total: q.data.steps.length })}</CardDescription>
        </div>
        {canDismiss && (
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
            {t('Hide checklist')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-1.5 rounded-full bg-muted" role="progressbar" aria-label={t('Setup progress')} aria-valuenow={done} aria-valuemin={0} aria-valuemax={q.data.steps.length}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${(done / q.data.steps.length) * 100}%` }} />
        </div>
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {q.data.steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="flex items-center gap-2 rounded-md border border-border p-3 text-sm transition-colors hover:border-primary/50 hover:bg-muted/50">
                {s.done ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className={s.done ? 'text-muted-foreground line-through' : undefined}>{t.maybe(s.label)}</span>
                <span className="sr-only">{s.done ? t('(done)') : t('(to do)')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
