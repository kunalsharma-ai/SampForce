'use client';

import { Badge, Button } from '@dealflow/ui';
import { EMAIL_INTENT_LABELS, EMAIL_NEXT_ACTION_LABELS, type EmailAnalysis, type EmailIntent } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { agentReason, aiErrorMessage, useAiStatus } from '@/lib/ai';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
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

const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

/** The Email Assistant's reading of a received email: intent, objections, buying signals and a suggested reply. */
export function EmailReading({ emailId, from, onReply }: { emailId: string; from: string; onReply: (draft: { subject: string; body: string }) => void }) {
  const t = useT();
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
    <section className="mt-4 space-y-2 rounded-lg border border-border p-3 text-sm" aria-label={t('AI reading of this email')}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent" aria-hidden />
        <span className="font-medium">{t('AI reading')}</span>
        <Button type="button" size="sm" variant="outline" className="ms-auto" disabled={run.isPending || !!reason} onClick={() => run.mutate()}>
          {run.isPending ? t('Reading…') : a ? t('Read again') : t('Read with AI')}
        </Button>
      </div>
      {reason && <p className="text-xs text-warning">{t.maybe(reason)}</p>}
      {run.error && (
        <p role="alert" className="text-critical">
          {t.maybe(aiErrorMessage(run.error))}
        </p>
      )}
      {a && (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={INTENT_TONE[a.intent]}>{t.maybe(EMAIL_INTENT_LABELS[a.intent])}</Badge>
            <span className="text-xs text-muted-foreground">
              {t(CONFIDENCE[a.confidence])} · {t.plural('count.emailsRead', a.messagesRead)}
            </span>
          </p>
          <p>{a.summary}</p>
          {a.objections.length > 0 && (
            <p>
              <span className="font-medium">{t('Objections:')} </span>
              {a.objections.join('; ')}
            </p>
          )}
          {a.buyingSignals.length > 0 && (
            <p>
              <span className="font-medium">{t('Buying signals:')} </span>
              {a.buyingSignals.join('; ')}
            </p>
          )}
          <p>
            <span className="font-medium">{t('Suggested next step:')} </span>
            {t.maybe(EMAIL_NEXT_ACTION_LABELS[a.nextAction])}
            {a.followUpInDays !== null &&
              `, ${t('follow up in {time} if there is no answer', { time: new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(a.followUpInDays) })}`}
            . <span className="text-muted-foreground">{a.reason}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {a.suggestedReply && (
              <Button type="button" size="sm" onClick={() => onReply(a.suggestedReply!)}>
                {t('Reply with this draft')}
              </Button>
            )}
            {a.nextAction === 'stop_outreach' && canSuppress && (
              <Button type="button" size="sm" variant="outline" disabled={suppress.isPending || !!suppress.data} onClick={() => suppress.mutate()}>
                {t('Add {email} to the do-not-email list', { email: from })}
              </Button>
            )}
            {suppress.data && <span role="status" className="text-xs text-success">{t('Added. Sequences will not email them.')}</span>}
          </div>
          <p className="text-xs text-muted-foreground">{t('This is the AI’s reading of the email, not a confirmed fact. Nothing has been changed or sent.')}</p>
        </div>
      )}
    </section>
  );
}
