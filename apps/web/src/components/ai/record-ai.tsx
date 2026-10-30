'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import type { DealHealth, LeadQualification, MeetingSummary, ProposalDraft, RecommendationRow, Signal } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCopy, FileText, NotebookPen, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { aiErrorMessage, useRecommendations } from '@/lib/ai';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const GRADE_TONE = { A: 'success', B: 'primary', C: 'warning', D: 'critical' } as const;
const RISK_TONE = { low: 'success', medium: 'warning', high: 'critical' } as const;

function AiLabel({ rec }: { rec: Pick<RecommendationRow, 'promptVersion' | 'createdAt'> }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      AI-assisted · {rec.promptVersion} · {relativeTime(rec.createdAt)}
    </p>
  );
}

function Signals({ signals, risk }: { signals: Signal[]; risk?: boolean }) {
  if (!signals.length) return null;
  return (
    <ul className="space-y-1 text-sm" aria-label="Signals">
      {signals.map((s) => (
        <li key={s.key} className="flex gap-2">
          <span className={`w-10 shrink-0 text-right tabular-nums ${risk ? 'text-critical' : s.points >= 0 ? 'text-success' : 'text-critical'}`}>
            {risk ? `−${s.points}` : s.points >= 0 ? `+${s.points}` : s.points}
          </span>
          <span>
            {s.label}
            <span className="block text-xs text-muted-foreground">{s.detail}</span>
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
          <Sparkles className="size-4 text-accent" aria-hidden /> AI qualification
        </CardTitle>
        {canRun && (
          <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? 'Scoring…' : q ? 'Re-score' : 'Score lead'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.isPending ? (
          <Skeleton className="h-20" />
        ) : !q ? (
          <p className="text-sm text-muted-foreground">Not scored yet. The score comes from contact details, value, source and recent activity, and each point is explained.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{q.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={GRADE_TONE[q.grade]}>Grade {q.grade}</Badge>
            </div>
            {q.summary && <p className="text-sm">{q.summary}</p>}
            {q.suggestedNextStep && (
              <p className="text-sm">
                <span className="font-medium">Suggested next step:</span> {q.suggestedNextStep}
              </p>
            )}
            {q.summaryUnavailable && <p className="text-xs text-muted-foreground">No written summary: {q.summaryUnavailable}</p>}
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
          <Sparkles className="size-4 text-accent" aria-hidden /> Deal health
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? 'Analysing…' : h ? 'Re-check' : 'Check health'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.isPending ? (
          <Skeleton className="h-20" />
        ) : !h ? (
          <p className="text-sm text-muted-foreground">Not checked yet. Health looks at recent activity, time in stage, overdue tasks and the close date.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{h.health}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              <Badge tone={RISK_TONE[h.risk]}>{h.risk === 'low' ? 'Low' : h.risk === 'medium' ? 'Medium' : 'High'} risk</Badge>
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
                        <Check aria-hidden /> Create task (due in {h.nextStep.dueInDays} day{h.nextStep.dueInDays === 1 ? '' : 's'})
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: rec.id, accept: false })} disabled={decide.isPending}>
                      <X aria-hidden /> Dismiss
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{rec.status === 'ACCEPTED' ? 'Task created.' : 'Dismissed.'}</p>
                )}
              </div>
            )}
            {h.nextStepUnavailable && <p className="text-xs text-muted-foreground">No recommended next step: {h.nextStepUnavailable}</p>}
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
        <FileText aria-hidden /> Draft proposal
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">Proposal draft</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Written from this deal&apos;s details and line items. Check every fact before you use it; nothing has been sent.
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
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Based on</p>
                  <ul className="list-inside list-disc space-y-0.5">{p.basedOn.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              {p.openQuestions.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open questions</p>
                  <ul className="list-inside list-disc space-y-0.5">{p.openQuestions.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => copy(asText)}>
                  <ClipboardCopy aria-hidden /> Copy text
                </Button>
                <Button size="sm" variant="outline" onClick={() => draft.mutate()}>
                  Redraft
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

export interface MeetingTarget {
  meetingId?: string;
  dealId?: string;
  contactId?: string;
  leadId?: string;
}

/** Turns pasted meeting notes into a summary, action items and a follow-up email draft (never sent automatically). */
export function MeetingNotesButton({ target, label = 'Summarise meeting notes' }: { target: MeetingTarget; label?: string }) {
  const canUse = useCan('ai:use');
  const canWrite = useCan('activities:write');
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const qc = useQueryClient();
  const summarise = useMutation({
    mutationFn: () => api<RecommendationRow<MeetingSummary>>('/ai/meeting-notes', { method: 'POST', json: { notes, ...target } }),
    onSuccess: (r) => setPicked(r.payload.actionItems.map((a, i) => (a.owner === 'me' ? i : -1)).filter((i) => i >= 0)),
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['tasks'] });
    await qc.invalidateQueries({ queryKey: ['activities'] });
    await qc.invalidateQueries({ queryKey: ['ai', 'recommendations'] });
  };
  const tasks = useMutation({
    mutationFn: (id: string) => api<{ taskIds: string[] }>(`/ai/recommendations/${id}/tasks`, { method: 'POST', json: { indexes: picked } }),
    onSuccess: refresh,
  });
  const save = useMutation({ mutationFn: (id: string) => api(`/ai/recommendations/${id}/accept`, { method: 'POST', json: {} }), onSuccess: refresh });
  if (!canUse || !canWrite) return null;
  const rec = summarise.data;
  const m = rec?.payload;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <NotebookPen aria-hidden /> {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            summarise.reset();
            tasks.reset();
            save.reset();
            setNotes('');
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">Meeting notes</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Paste your notes or a transcript you are allowed to share. You get a summary, action items you can turn into tasks, and a follow-up email draft to copy. Nothing is sent.
          </DialogDescription>
          {!m ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                summarise.mutate();
              }}
            >
              <label htmlFor="meeting-notes" className="sr-only">
                Notes
              </label>
              <Textarea id="meeting-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20_000} className="min-h-[200px]" placeholder="What was discussed, what was decided, who will do what…" />
              {summarise.error && <p role="alert" className="text-sm text-critical">{aiErrorMessage(summarise.error)}</p>}
              <Button type="submit" disabled={notes.trim().length < 20 || summarise.isPending}>
                <Sparkles aria-hidden /> {summarise.isPending ? 'Summarising…' : 'Summarise'}
              </Button>
            </form>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <p className="whitespace-pre-wrap">{m.summary}</p>
              {m.decisions.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Decisions</p>
                  <ul className="list-inside list-disc space-y-0.5">{m.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
                </div>
              )}
              {m.actionItems.length > 0 && (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Action items</legend>
                  {m.actionItems.map((a, i) => (
                    <label key={i} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                        checked={picked.includes(i)}
                        disabled={!!tasks.data}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))}
                      />
                      <span>
                        {a.title}
                        <span className="block text-xs text-muted-foreground">
                          {a.owner === 'me' ? 'For you' : 'For the customer'}
                          {a.dueInDays !== null && ` · due in ${a.dueInDays} day${a.dueInDays === 1 ? '' : 's'}`}
                        </span>
                      </span>
                    </label>
                  ))}
                  {tasks.data ? (
                    <p className="text-xs text-success">{tasks.data.taskIds.length} task{tasks.data.taskIds.length === 1 ? '' : 's'} created.</p>
                  ) : (
                    <Button size="sm" onClick={() => tasks.mutate(rec.id)} disabled={!picked.length || tasks.isPending}>
                      Create {picked.length} task{picked.length === 1 ? '' : 's'}
                    </Button>
                  )}
                </fieldset>
              )}
              <div className="space-y-1 rounded-md border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Follow-up email draft</p>
                <p className="font-medium">{m.followUpEmail.subject}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{m.followUpEmail.body}</p>
                <Button size="sm" variant="outline" onClick={() => copy(`Subject: ${m.followUpEmail.subject}\n\n${m.followUpEmail.body}`)}>
                  <ClipboardCopy aria-hidden /> Copy email
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {save.data ? (
                  <p className="text-xs text-success">Summary saved to the timeline.</p>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => save.mutate(rec.id)} disabled={save.isPending}>
                    Save summary as a note
                  </Button>
                )}
              </div>
              {(tasks.error || save.error) && <p role="alert" className="text-sm text-critical">{aiErrorMessage(tasks.error ?? save.error)}</p>}
              <AiLabel rec={rec} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
