'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { TRIGGER_EVENTS, type WorkflowDefinition } from '@dealflow/types';
import { useMutation } from '@tanstack/react-query';
import { Plus, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { agentReason, aiErrorMessage, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { useApprovals, useWorkflows } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { AI_DRAFT_KEY, type AiWorkflowDraft, EMAIL_TEMPLATES, type Template, TEMPLATES } from './workflow-model';
import { useT } from '@/lib/i18n';

export function WorkflowList() {
  const t = useT();
  const workflows = useWorkflows();
  const pending = useApprovals('PENDING');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href="/app/automation/new">
            <Plus aria-hidden /> {t('New workflow')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/approvals">
            <ShieldCheck aria-hidden /> {t('Approvals')}
            {!!pending.data?.length && <Badge tone="warning">{t('{n} waiting', { n: pending.data.length })}</Badge>}
          </Link>
        </Button>
      </div>

      {workflows.isPending ? (
        <Skeleton className="h-40" />
      ) : workflows.error ? (
        <p role="alert" className="text-sm text-critical">
          {workflows.error.message}
        </p>
      ) : workflows.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No workflows yet. Start from scratch or from one of the templates below.')}</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {workflows.data.map((w) => (
              <li key={w.id}>
                <Link href={`/app/automation/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50">
                  <span className="font-medium">{w.name}</span>
                  <Badge tone={w.status === 'ACTIVE' ? 'success' : w.status === 'PAUSED' ? 'warning' : 'neutral'}>{w.status === 'ACTIVE' ? t('Active') : w.status === 'PAUSED' ? t('Paused') : t('Draft')}</Badge>
                  <span className="text-sm text-muted-foreground">{t.maybe(TRIGGER_EVENTS[w.triggerType]?.label ?? '')}</span>
                  <span className="ms-auto text-xs text-muted-foreground">
                    {t.plural('count.runsIn30Days', w.runs30d)}{w.failures30d > 0 && <span className="text-critical"> · {t('{n} failed', { n: w.failures30d })}</span>} · v{w.version} · {t('edited {time}', { time: relativeTime(w.updatedAt) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <DescribeWithAi />

      <TemplateSection id="templates-heading" title={t('Start from a template')} templates={TEMPLATES} />
      <TemplateSection
        id="email-templates-heading"
        title={t('Email automation')}
        note={t('React to what people do with your email. Opens are estimates (images, privacy proxies and scanners trigger them), and some clicks come from link scanners; replies, bounces and unsubscribes are confirmed.')}
        templates={EMAIL_TEMPLATES}
      />
    </div>
  );
}

function TemplateSection({ id, title, note, templates }: { id: string; title: string; note?: string; templates: Template[] }) {
  const t = useT();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {templates.map((item) => (
          <Card key={item.key} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm">{t.maybe(item.name)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="flex-1 text-sm text-muted-foreground">{t.maybe(item.description)}</p>
              <Button asChild variant="outline" size="sm" className="self-start">
                <Link href={`/app/automation/new?template=${item.key}`} aria-label={t('Use template: {name}', { name: t.maybe(item.name) })}>
                  {t('Use template')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** The AI workflow builder: a plain-language description becomes a validated draft that opens in the editor. */
function DescribeWithAi() {
  const t = useT();
  const canUse = useCan('ai:use');
  const status = useAiStatus();
  const router = useRouter();
  const [text, setText] = useState('');
  const draft = useMutation({
    mutationFn: () => api<{ runId: string; name: string; definition: WorkflowDefinition; notes: string }>('/ai/workflows/draft', { method: 'POST', json: { description: text } }),
    onSuccess: (d) => {
      const stored: AiWorkflowDraft = { prompt: text.trim(), name: d.name, notes: d.notes, definition: d.definition };
      try {
        sessionStorage.setItem(AI_DRAFT_KEY, JSON.stringify(stored));
      } catch {
        return;
      }
      router.push('/app/automation/new?draft=ai');
    },
  });
  if (!canUse) return null;
  const reason = agentReason(status.data, 'workflow_builder');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-accent" aria-hidden /> {t('Describe it with AI')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            draft.mutate();
          }}
        >
          <label htmlFor="ai-workflow" className="sr-only">
            {t('Describe the workflow')}
          </label>
          <Textarea
            id="ai-workflow"
            value={text}
            maxLength={2000}
            disabled={!!reason}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('When a lead from the website is worth more than 50,000, assign it to the sales lead and create a call task due tomorrow.')}
            className="min-h-[72px]"
          />
          {reason && <p className="text-xs text-warning">{t.maybe(reason)}</p>}
          {draft.error && <p role="alert" className="text-sm text-critical">{aiErrorMessage(draft.error)}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={text.trim().length < 10 || draft.isPending || !!reason}>
              {draft.isPending ? t('Drafting…') : t('Draft workflow')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('The draft opens in the editor. Nothing is saved or activated until you do it.')}</span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
