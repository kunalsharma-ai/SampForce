'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import type { DealHealth, LeadQualification, ProposalDraft, RecommendationRow, Signal } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCopy, FileText, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { aiErrorMessage, useRecommendations } from '@/lib/ai';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const GRADE_TONE = { A: 'success', B: 'primary', C: 'warning', D: 'critical' } as const;
const RISK_TONE = { low: 'success', medium: 'warning', high: 'critical' } as const;

function AiLabel({ rec }: { rec: Pick<RecommendationRow, 'promptVersion' | 'createdAt'> }) {
  const t = useT();
  return (
    <p className="text-[11px] text-muted-foreground">
      {t('AI-assisted')} · {rec.promptVersion} · {relativeTime(rec.createdAt)}
    </p>
  );
}

function Signals({ signals, risk }: { signals: Signal[]; risk?: boolean }) {
  const t = useT();
  if (!signals.length) return null;
  return (
    <ul className="space-y-1 text-sm" aria-label={t('Signals')}>
      {signals.map((s) => (
        <li key={s.key} className="flex gap-2">
          <span className={`w-10 shrink-0 text-end tabular-nums ${risk ? 'text-critical' : s.points >= 0 ? 'text-success' : 'text-critical'}`}>
            {risk ? `−${s.points}` : s.points >= 0 ? `+${s.points}` : s.points}
          </span>
          <span>
            {t.maybe(s.label)}
            <span className="block text-xs text-muted-foreground">{t.maybe(s.detail)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function useInvalidateRecs(entityType: 'lead' | 'deal' | 'contact', id: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ai', 'recommendations', entityType, id] });
}

/** Explainable lead score. The signals are rule-based; only the written summary uses the AI provider. */
export function LeadQualificationCard({ leadId, canRun }: { leadId: string; canRun: boolean }) {
  const t = useT();
  const canUse = useCan('ai:use');
  const recs = useRecommendations('lead', leadId);
  const invalidate = useInvalidateRecs('lead', leadId);
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api<RecommendationRow<LeadQualification>>(`/ai/leads/${leadId}/qualify`, { method: 'POST' }),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
  if (!canUse) return null;
  const rec = recs.data?.find((r) => r.kind === 'lead_qualification') as RecommendationRow<LeadQualification> | undefined;
  const q = rec?.payload;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-accent" aria-hidden /> {t('AI qualification')}
        </CardTitle>
        {canRun && (
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? t('Scoring…') : q ? t('Re-score') : t('Score lead')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.isPending ? (
          <Skeleton className="h-20" />
        ) : !q ? (
          <p className="text-sm text-muted-foreground">{t('Not scored yet. The score comes from contact details, value, source and recent activity, and each point is explained.')}</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{q.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={GRADE_TONE[q.grade]}>{t('Grade {grade}', { grade: q.grade })}</Badge>
            </div>
            {q.summary && <p className="text-sm">{q.summary}</p>}
            {q.suggestedNextStep && (
              <p className="text-sm">
                <span className="font-medium">{t('Suggested next step:')}</span> {q.suggestedNextStep}
              </p>
            )}
            {q.summaryUnavailable && <p className="text-xs text-muted-foreground">{t('No written summary: {reason}', { reason: t.maybe(q.summaryUnavailable) })}</p>}
            <Signals signals={q.signals} />
            <AiLabel rec={rec} />
          </>
        )}
        {run.error && <p role="alert" className="text-sm text-critical">{aiErrorMessage(run.error)}</p>}
      </CardContent>
    </Card>
  );
}

/** Deal health from activity, stage age and dates, with a recommended next step the person can accept as a task. */
export function DealIntelligenceCard({ dealId }: { dealId: string }) {
  const t = useT();
  const canUse = useCan('ai:use');
  const canTask = useCan('activities:write');
  const recs = useRecommendations('deal', dealId);
  const invalidate = useInvalidateRecs('deal', dealId);
  const qc = useQueryClient();
  const run = useMutation({ mutationFn: () => api(`/ai/deals/${dealId}/analyse`, { method: 'POST' }), onSuccess: invalidate });
  const decide = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api(`/ai/recommendations/${id}/${accept ? 'accept' : 'dismiss'}`, { method: 'POST', json: {} }),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      await qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
  if (!canUse) return null;
  const rec = recs.data?.find((r) => r.kind === 'deal_health') as RecommendationRow<DealHealth> | undefined;
  const h = rec?.payload;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-accent" aria-hidden /> {t('Deal health')}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? t('Analysing…') : h ? t('Re-check') : t('Check health')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.isPending ? (
          <Skeleton className="h-20" />
        ) : !h ? (
          <p className="text-sm text-muted-foreground">{t('Not checked yet. Health looks at recent activity, time in stage, overdue tasks and the close date.')}</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{h.health}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={RISK_TONE[h.risk]}>{h.risk === 'low' ? t('Low risk') : h.risk === 'medium' ? t('Medium risk') : t('High risk')}</Badge>
            </div>
            <Signals signals={h.signals} risk />
            {h.nextStep && (
              <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
                <p className="font-medium">{h.nextStep.title}</p>
                <p className="text-muted-foreground">{h.nextStep.reason}</p>
                {rec.status === 'PROPOSED' ? (
                  <div className="flex gap-2">
                    {canTask && (
                      <Button size="sm" onClick={() => decide.mutate({ id: rec.id, accept: true })} disabled={decide.isPending}>
                        <Check aria-hidden /> {t('Create task (due in {time})', { time: new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(h.nextStep.dueInDays) })}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: rec.id, accept: false })} disabled={decide.isPending}>
                      <X aria-hidden /> {t('Dismiss')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{rec.status === 'ACCEPTED' ? t('Task created.') : t('Dismissed.')}</p>
                )}
              </div>
            )}
            {h.nextStepUnavailable && <p className="text-xs text-muted-foreground">{t('No recommended next step: {reason}', { reason: t.maybe(h.nextStepUnavailable) })}</p>}
            <AiLabel rec={rec} />
          </>
        )}
        {(run.error || decide.error) && <p role="alert" className="text-sm text-critical">{aiErrorMessage(run.error ?? decide.error)}</p>}
      </CardContent>
    </Card>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

/** Drafts a proposal from the deal's own data. Nothing is sent; the person copies and edits it. */
export function ProposalButton({ dealId }: { dealId: string }) {
  const t = useT();
  const canUse = useCan('ai:use');
  const [open, setOpen] = useState(false);
  const draft = useMutation({ mutationFn: () => api<RecommendationRow<ProposalDraft>>(`/ai/deals/${dealId}/proposal`, { method: 'POST' }) });
  if (!canUse) return null;
  const p = draft.data?.payload;
  const asText = p ? [p.title, ...p.sections.map((s) => `${s.heading}\n${s.body}`)].join('\n\n') : '';
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          if (!draft.data && !draft.isPending) draft.mutate();
        }}
      >
        <FileText aria-hidden /> {t('Draft proposal')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">{t('Proposal draft')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("Written from this deal's details and line items. Check every fact before you use it; nothing has been sent.")}
          </DialogDescription>
          {draft.isPending ? (
            <Skeleton className="mt-4 h-60" />
          ) : draft.error ? (
            <p role="alert" className="mt-4 text-sm text-critical">
              {aiErrorMessage(draft.error)}
            </p>
          ) : p ? (
            <div className="mt-4 space-y-4 text-sm">
              <h3 className="text-base font-semibold">{p.title}</h3>
              {p.sections.map((s) => (
                <section key={s.heading} className="space-y-1">
                  <h4 className="font-medium">{s.heading}</h4>
                  <p className="whitespace-pre-wrap text-muted-foreground">{s.body}</p>
                </section>
              ))}
              {p.basedOn.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Based on')}</p>
                  <ul className="list-inside list-disc space-y-0.5">{p.basedOn.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              {p.openQuestions.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Open questions')}</p>
                  <ul className="list-inside list-disc space-y-0.5">{p.openQuestions.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => copy(asText)}>
                  <ClipboardCopy aria-hidden /> {t('Copy text')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => draft.mutate()}>
                  {t('Redraft')}
                </Button>
              </div>
              {draft.data && <AiLabel rec={draft.data} />}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

