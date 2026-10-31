'use client';

import { Badge, Button } from '@dealflow/ui';
import { EMAIL_INTENT_LABELS, EMAIL_NEXT_ACTION_LABELS, type EmailAnalysis, type EmailIntent } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { agentReason, aiErrorMessage, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';

export const INTENT_TONE: Record<EmailIntent, 'success' | 'warning' | 'critical' | 'neutral' | 'primary'> = {
  interested: 'success',
  meeting_request: 'success',
  question: 'primary',
  objection: 'warning',
  not_now: 'warning',
  not_interested: 'critical',
  unsubscribe: 'critical',
  referral: 'primary',
  out_of_office: 'neutral',
  other: 'neutral',
};

/** The Email Assistant's reading of a received email: intent, objections, buying signals and a suggested reply. */
export function EmailReading({ emailId, from, onReply }: { emailId: string; from: string; onReply: (draft: { subject: string; body: string }) => void }) {
  const canUse = useCan('ai:use');
  const canSuppress = useCan('sequences:write');
  const status = useAiStatus(canUse);
  const qc = useQueryClient();
  const saved = useQuery({ enabled: canUse, queryKey: ['ai', 'email-analysis', emailId], queryFn: () => api<{ analysis: EmailAnalysis | null }>(`/ai/email/analysis/${emailId}`) });
  const run = useMutation({
    mutationFn: () => api<EmailAnalysis>('/ai/email/analyse', { method: 'POST', json: { emailId } }),
    onSuccess: async (a) => {
      qc.setQueryData(['ai', 'email-analysis', emailId], { analysis: a });
      await Promise.all([qc.invalidateQueries({ queryKey: ['emails'] }), qc.invalidateQueries({ queryKey: ['inbox'] })]);
    },
  });
  const suppress = useMutation({ mutationFn: () => api<{ added: number }>('/sequences/suppressions', { method: 'POST', json: { emails: [from] } }) });
  if (!canUse) return null;
  const reason = agentReason(status.data, 'email_assistant');
  const a = run.data ?? saved.data?.analysis ?? null;
  return (
    <section className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm" aria-label="AI reading of this email">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <span className="font-medium">AI reading</span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={run.isPending || !!reason} onClick={() => run.mutate()}>
          {run.isPending ? 'Reading…' : a ? 'Read again' : 'Read with AI'}
        </Button>
      </div>
      {reason && <p className="text-xs text-warning">{reason}</p>}
      {run.error && (
        <p role="alert" className="text-critical">
          {aiErrorMessage(run.error)}
        </p>
      )}
      {a && (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={INTENT_TONE[a.intent]}>{EMAIL_INTENT_LABELS[a.intent]}</Badge>
            <span className="text-xs text-muted-foreground">
              {a.confidence} confidence · read {a.messagesRead} email{a.messagesRead === 1 ? '' : 's'}
            </span>
          </p>
          <p>{a.summary}</p>
          {a.objections.length > 0 && (
            <p>
              <span className="font-medium">Objections: </span>
              {a.objections.join('; ')}
            </p>
          )}
          {a.buyingSignals.length > 0 && (
            <p>
              <span className="font-medium">Buying signals: </span>
              {a.buyingSignals.join('; ')}
            </p>
          )}
          <p>
            <span className="font-medium">Suggested next step: </span>
            {EMAIL_NEXT_ACTION_LABELS[a.nextAction]}
            {a.followUpInDays !== null && `, follow up in ${a.followUpInDays} day${a.followUpInDays === 1 ? '' : 's'} if there is no answer`}. <span className="text-muted-foreground">{a.reason}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {a.suggestedReply && (
              <Button type="button" size="sm" onClick={() => onReply(a.suggestedReply!)}>
                Reply with this draft
              </Button>
            )}
            {a.nextAction === 'stop_outreach' && canSuppress && (
              <Button type="button" size="sm" variant="outline" disabled={suppress.isPending || !!suppress.data} onClick={() => suppress.mutate()}>
                Add {from} to the do-not-email list
              </Button>
            )}
            {suppress.data && <span role="status" className="text-xs text-success">Added. Sequences will not email them.</span>}
          </div>
          <p className="text-xs text-muted-foreground">This is the AI’s reading of the email, not a confirmed fact. Nothing has been changed or sent.</p>
        </div>
      )}
    </section>
  );
}
