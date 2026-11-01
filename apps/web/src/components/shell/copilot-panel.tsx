'use client';

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import type { Citation, CopilotAnswer, ProposedAction } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Check, Loader2, RotateCcw, Send, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCopilot } from '@/stores/copilot';
import { Textarea } from '@/components/crm/select';
import { aiErrorMessage, agentReason, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

const EXAMPLES = ['Brief me on my week: what needs attention?', 'Summarise my open pipeline.', 'Which of my deals close this month?', 'What tasks are overdue?'];

const citationHref = (c: Citation) => (c.entity === 'task' ? '/app/activities' : `/app/${c.entity === 'company' ? 'companies' : `${c.entity}s`}/${c.id}`);

interface Turn {
  question: string;
  answer: CopilotAnswer | null;
  error: string | null;
}

/**
 * Copilot chat. Answers come from tools that only read what the person's role can read; any change is
 * shown as a proposal that does nothing until the person confirms it, and is permission-checked again then.
 */
export function CopilotPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const canUse = useCan('ai:use');
  const status = useAiStatus(open);
  const qc = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [question, setQuestion] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (q: string) => api<CopilotAnswer>('/ai/copilot', { method: 'POST', json: { question: q, conversationId } }),
    onMutate: (q) => setTurns((t) => [...t, { question: q, answer: null, error: null }]),
    onSuccess: (a) => {
      setConversationId(a.conversationId);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, answer: a } : x)));
      void qc.invalidateQueries({ queryKey: ['ai', 'status'] });
    },
    onError: (err) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: aiErrorMessage(err) } : x))),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  // "Ask Copilot" buttons elsewhere open the panel with a question ready to send.
  const takePending = useCopilot((s) => s.takePending);
  const pending = useCopilot((s) => s.pending);
  useEffect(() => {
    if (!open || !pending || !canUse) return;
    const q = takePending();
    if (q && !ask.isPending) ask.mutate(q);
  }, [open, pending, canUse, takePending, ask]);

  const submit = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setQuestion('');
    ask.mutate(text);
  };

  const updateAction = (runId: string, action: ProposedAction) =>
    setTurns((t) => t.map((x) => (x.answer?.runId === runId ? { ...x, answer: { ...x.answer, actions: x.answer.actions.map((a) => (a.id === action.id ? action : a)) } } : x)));

  const reason = status.data ? agentReason(status.data, 'copilot') : null;
  const credits = status.data?.credits;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="flex flex-col gap-4 p-0">
        <div className="flex items-center gap-3 border-b border-border p-5 pe-12">
          <span className="grid size-10 place-items-center rounded-lg bg-accent/15 text-accent">
            <Bot className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold">DealFlow Copilot</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Reads what your role can read. Changes wait for you to confirm.
            </DialogDescription>
          </div>
          {turns.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTurns([]);
                setConversationId(undefined);
              }}
            >
              <RotateCcw aria-hidden /> New chat
            </Button>
          )}
        </div>

        {!canUse ? (
          <p className="px-5 text-sm text-muted-foreground">Your role does not include AI features (ai:use). Ask a workspace admin if you need them.</p>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-5" aria-live="polite">
              {reason && (
                <div role="status" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>{reason}</span>
                </div>
              )}
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Ask about your leads, deals, contacts and tasks. Try:</p>
                  <ul className="space-y-2">
                    {EXAMPLES.map((e) => (
                      <li key={e}>
                        <button
                          type="button"
                          disabled={!!reason || ask.isPending}
                          onClick={() => submit(e)}
                          className="w-full rounded-md border border-border bg-surface-raised/60 px-3 py-2 text-start text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {e}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-3 rounded-md border border-border p-3 text-sm">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <p className="text-muted-foreground">
                      Copilot cannot send email, change amounts or prices, export data or change security settings. Every question and every confirmed change is recorded.
                    </p>
                  </div>
                </div>
              )}
              {turns.map((t, i) => (
                <div key={i} className="space-y-2">
                  <p className="ms-8 rounded-lg bg-primary/10 px-3 py-2 text-sm">{t.question}</p>
                  {t.error ? (
                    <p role="alert" className="me-8 rounded-lg border border-critical/40 px-3 py-2 text-sm text-critical">
                      {t.error}
                    </p>
                  ) : !t.answer ? (
                    <p className="me-8 flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Looking through your CRM…
                    </p>
                  ) : (
                    <AnswerView answer={t.answer} onAction={(a) => updateAction(t.answer!.runId, a)} />
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form
              className="space-y-2 border-t border-border p-5"
              onSubmit={(e) => {
                e.preventDefault();
                submit(question);
              }}
            >
              <label htmlFor="copilot-question" className="sr-only">
                Ask Copilot
              </label>
              <Textarea
                id="copilot-question"
                placeholder={reason ? 'Copilot is unavailable' : 'Ask about your pipeline…'}
                value={question}
                disabled={!!reason}
                maxLength={2000}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(question);
                  }
                }}
                className="min-h-[72px]"
              />
              <div className="flex items-center gap-2">
                {credits && (
                  <span className="text-xs text-muted-foreground">
                    {credits.remaining.toLocaleString(fmtLocale())} of {credits.limit.toLocaleString(fmtLocale())} AI credits left this month
                  </span>
                )}
                <Button type="submit" size="sm" className="ms-auto" disabled={!question.trim() || ask.isPending || !!reason}>
                  <Send aria-hidden /> Ask
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnswerView({ answer, onAction }: { answer: CopilotAnswer; onAction: (a: ProposedAction) => void }) {
  return (
    <div className="me-8 space-y-2 rounded-lg border border-border px-3 py-2">
      <p className="whitespace-pre-wrap text-sm">{answer.answer}</p>
      {answer.citations.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Sources">
          {answer.citations.map((c) => (
            <Link key={`${c.entity}-${c.id}`} href={citationHref(c)} className="rounded-full border border-border px-2 py-0.5 text-xs text-primary hover:bg-muted">
              {c.label}
            </Link>
          ))}
        </div>
      )}
      {answer.actions.map((a) => (
        <ActionCard key={a.id} runId={answer.runId} action={a} onChange={onAction} />
      ))}
      <p className="text-[11px] text-muted-foreground">
        {answer.creditsUsed} credit{answer.creditsUsed === 1 ? '' : 's'}
        {answer.toolsUsed.length > 0 && ` · looked at: ${[...new Set(answer.toolsUsed)].join(', ').replaceAll('_', ' ')}`}
      </p>
    </div>
  );
}

function ActionCard({ runId, action, onChange }: { runId: string; action: ProposedAction; onChange: (a: ProposedAction) => void }) {
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: 'confirm' | 'dismiss') => api<ProposedAction>(`/ai/copilot/runs/${runId}/actions/${action.id}`, { method: 'POST', json: { decision } }),
    onSuccess: (a) => {
      onChange(a);
      if (a.status === 'applied') void qc.invalidateQueries();
    },
  });
  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Proposed change</Badge>
        <span className="font-medium">{action.title}</span>
      </div>
      {action.fromUntrustedContent && action.status === 'proposed' && (
        <p className="flex gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Copilot read email or other outside content before proposing this. Check it is what you want.
        </p>
      )}
      {action.status === 'proposed' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decide.mutate('confirm')} disabled={decide.isPending}>
            <Check aria-hidden /> Confirm
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide.mutate('dismiss')} disabled={decide.isPending}>
            <X aria-hidden /> Dismiss
          </Button>
        </div>
      ) : (
        <p className={`text-xs ${action.status === 'failed' ? 'text-critical' : 'text-muted-foreground'}`}>
          {action.status === 'applied' ? 'Done.' : action.status === 'dismissed' ? 'Dismissed.' : `Could not apply: ${action.error ?? 'unknown error'}`}
        </p>
      )}
      {decide.error && (
        <p role="alert" className="text-xs text-critical">
          {aiErrorMessage(decide.error)}
        </p>
      )}
    </div>
  );
}
