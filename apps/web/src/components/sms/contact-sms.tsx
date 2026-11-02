'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@dealflow/ui';
import { type AppStatus, SMS_MAX_LENGTH, type SmsMessageRow, smsSegments, type SmsThread } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const STATUS: Record<SmsMessageRow['status'], { label: string; tone: 'neutral' | 'success' | 'critical' | 'primary' }> = {
  accepted: { label: 'Accepted by Twilio', tone: 'neutral' },
  sent: { label: 'Sent to carrier', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'success' },
  undelivered: { label: 'Not delivered', tone: 'critical' },
  failed: { label: 'Failed', tone: 'critical' },
  received: { label: 'Received', tone: 'neutral' },
};

type Translator = ReturnType<typeof useT>;

/** Who sent an outgoing text, how, and how many segments it took, as one sentence per case. */
function sentLine(tr: Translator, m: SmsMessageRow): string {
  const vars = { name: m.sentBy ?? '', n: m.segments };
  const one = m.segments === 1;
  if (m.source === 'workflow') {
    if (m.sentBy) return one ? tr('Sent by {name} (workflow) · {n} segment', vars) : tr('Sent by {name} (workflow) · {n} segments', vars);
    return one ? tr('Sent (workflow) · {n} segment', vars) : tr('Sent (workflow) · {n} segments', vars);
  }
  if (m.sentBy) return one ? tr('Sent by {name} · {n} segment', vars) : tr('Sent by {name} · {n} segments', vars);
  return one ? tr('Sent · {n} segment', vars) : tr('Sent · {n} segments', vars);
}

/** Characters and segments of the text being written, and what that costs. */
function segmentLine(tr: Translator, seg: ReturnType<typeof smsSegments>): string {
  const vars = { units: seg.units, n: seg.segments, encoding: seg.encoding };
  if (seg.encoding === 'UCS-2') {
    return seg.segments === 1
      ? tr('{units} characters · {n} segment ({encoding}): emoji or special characters make each segment shorter. Twilio bills per segment.', vars)
      : tr('{units} characters · {n} segments ({encoding}): emoji or special characters make each segment shorter. Twilio bills per segment.', vars);
  }
  return seg.segments === 1 ? tr('{units} characters · {n} segment ({encoding}). Twilio bills per segment.', vars) : tr('{units} characters · {n} segments ({encoding}). Twilio bills per segment.', vars);
}

/** SMS for one contact: consent and opt-out, the conversation, and one-to-one sending. Shown once SMS (Twilio) is connected. */
export function ContactSms({ contactId }: { contactId: string }) {
  const canRead = useCan('contacts:read');
  const canSend = useCan('activities:write');
  const canConsent = useCan('contacts:write');
  const tr = useT();
  const qc = useQueryClient();
  const apps = useQuery({ enabled: canRead, queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const sms = apps.data?.find((a) => a.key === 'twilio');
  const live = sms?.state === 'connected' || sms?.state === 'error';
  const thread = useQuery({ enabled: canRead && live, queryKey: ['sms', contactId], queryFn: () => api<SmsThread>(`/apps/twilio/contacts/${contactId}`) });
  const t = thread.data;
  const [source, setSource] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['sms', contactId] });
  const record = useMutation({
    mutationFn: () => api<SmsThread>('/apps/twilio/consents', { method: 'POST', json: { contactId, source, confirm: agreed } }),
    onSuccess: () => {
      setSource('');
      setAgreed(false);
      return refresh();
    },
  });
  const withdraw = useMutation({ mutationFn: () => api<SmsThread>(`/apps/twilio/consents/${contactId}`, { method: 'DELETE' }), onSuccess: refresh });
  const send = useMutation({
    mutationFn: () => api<SmsMessageRow>('/apps/twilio/messages', { method: 'POST', json: { contactId, text, confirm } }),
    onSuccess: () => {
      setText('');
      setConfirm(false);
      return refresh();
    },
  });
  if (!live || !canRead) return null;
  const error = record.error ?? withdraw.error ?? send.error ?? thread.error;
  const seg = smsSegments(text);
  const trial = (sms?.connection?.settings as { trial?: boolean } | undefined)?.trial;

  return (
    <Card role="region" aria-labelledby={`sms-${contactId}`}>
      <CardHeader className="pb-2">
        <CardTitle id={`sms-${contactId}`} className="flex items-center gap-2 text-base">
          <Smartphone className="size-4" aria-hidden /> {tr('SMS')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sms?.state === 'error' && <p className="text-xs text-critical">{tr('SMS needs new Twilio credentials in Integrations before anything can be sent.')}</p>}
        {t?.phoneProblem && <p className="text-muted-foreground">{tr.maybe(t.phoneProblem)}</p>}
        {t?.phone && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{tr('Number {phone}', { phone: t.phone })}</p>
              {t.optedOutAt ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="critical">{tr('Opted out')}</Badge>
                  <span className="text-muted-foreground">{tr('They replied STOP {when}. Nothing can be sent until they text START to your number.', { when: relativeTime(t.optedOutAt) })}</span>
                </p>
              ) : t.consent ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="success">{tr('Consent recorded')}</Badge>
                  <span className="text-muted-foreground">
                    {t.consent.recordedBy
                      ? tr('{source} · recorded {when} by {name}', { source: t.consent.source, when: relativeTime(t.consent.recordedAt), name: t.consent.recordedBy })
                      : tr('{source} · recorded {when}', { source: t.consent.source, when: relativeTime(t.consent.recordedAt) })}
                  </span>
                  {canConsent && (
                    <Button size="sm" variant="ghost" disabled={withdraw.isPending} onClick={() => window.confirm(tr('Withdraw SMS consent? Texts can no longer be sent to this person until it is recorded again.')) && withdraw.mutate()}>
                      {tr('Withdraw')}
                    </Button>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{tr('No SMS consent recorded. Texts are off until you record how this person agreed to receive them.')}</p>
              )}
            </div>
            {!t.consent && !t.optedOutAt && canConsent && (
              <form
                className="space-y-2 rounded-md border border-dashed p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  record.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`sms-source-${contactId}`}>{tr('How they agreed to texts')}</Label>
                  <Input id={`sms-source-${contactId}`} value={source} maxLength={200} placeholder={tr('Ticked SMS updates on the demo request form')} onChange={(e) => setSource(e.target.value)} />
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  {tr('This person agreed to receive text messages from us.')}
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={record.isPending || !agreed || source.trim().length < 5}>
                  {tr('Record SMS consent')}
                </Button>
              </form>
            )}

            {t.messages.length > 0 ? (
              <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label={tr('Text messages')}>
                {t.messages.map((m) => (
                  <li key={m.id} className={`rounded-md p-2 ${m.direction === 'out' ? 'ms-6 bg-primary/5' : 'me-6 bg-muted'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={STATUS[m.status].tone}>{tr.maybe(STATUS[m.status].label)}</Badge>
                      {m.direction === 'out' ? sentLine(tr, m) : tr('From them')} · {relativeTime(m.createdAt)}
                    </p>
                    {m.error && <p className="text-xs text-critical">{tr.maybe(m.error)}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{tr('No texts with this number yet.')}</p>
            )}
            <p className="text-xs text-muted-foreground">{tr('Delivered comes from the carrier through Twilio’s signed status updates. Some carriers never confirm delivery.')}</p>

            {canSend && t.consent && !t.optedOutAt && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send.mutate();
                }}
              >
                <Label htmlFor={`sms-text-${contactId}`}>{tr('Text message')}</Label>
                <Textarea id={`sms-text-${contactId}`} rows={3} maxLength={SMS_MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {text ? segmentLine(tr, seg) : tr('Up to 160 plain characters fit in one segment.')}
                </p>
                {trial && <p className="text-xs text-warning">{tr('Twilio trial account: texts reach only numbers verified in the Twilio console, and start with “Sent from your Twilio trial account”.')}</p>}
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
                  {tr('Send this text to {phone} now.', { phone: t.phone })}
                </label>
                <Button type="submit" size="sm" disabled={send.isPending || !text.trim() || !confirm}>
                  {tr('Send text')}
                </Button>
              </form>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {tr.maybe(error.message)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
