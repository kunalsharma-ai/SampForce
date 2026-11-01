'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@dealflow/ui';
import { type AppStatus, SMS_MAX_LENGTH, type SmsMessageRow, smsSegments, type SmsThread } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
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

/** SMS for one contact: consent and opt-out, the conversation, and one-to-one sending. Shown once SMS (Twilio) is connected. */
export function ContactSms({ contactId }: { contactId: string }) {
  const canRead = useCan('contacts:read');
  const canSend = useCan('activities:write');
  const canConsent = useCan('contacts:write');
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
          <Smartphone className="size-4" aria-hidden /> SMS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sms?.state === 'error' && <p className="text-xs text-critical">SMS needs new Twilio credentials in Integrations before anything can be sent.</p>}
        {t?.phoneProblem && <p className="text-muted-foreground">{t.phoneProblem}</p>}
        {t?.phone && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Number {t.phone}</p>
              {t.optedOutAt ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="critical">Opted out</Badge>
                  <span className="text-muted-foreground">They replied STOP {relativeTime(t.optedOutAt)}. Nothing can be sent until they text START to your number.</span>
                </p>
              ) : t.consent ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="success">Consent recorded</Badge>
                  <span className="text-muted-foreground">
                    {t.consent.source} · recorded {relativeTime(t.consent.recordedAt)}
                    {t.consent.recordedBy ? ` by ${t.consent.recordedBy}` : ''}
                  </span>
                  {canConsent && (
                    <Button size="sm" variant="ghost" disabled={withdraw.isPending} onClick={() => window.confirm('Withdraw SMS consent? Texts can no longer be sent to this person until it is recorded again.') && withdraw.mutate()}>
                      Withdraw
                    </Button>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No SMS consent recorded. Texts are off until you record how this person agreed to receive them.</p>
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
                  <Label htmlFor={`sms-source-${contactId}`}>How they agreed to texts</Label>
                  <Input id={`sms-source-${contactId}`} value={source} maxLength={200} placeholder="Ticked SMS updates on the demo request form" onChange={(e) => setSource(e.target.value)} />
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  This person agreed to receive text messages from us.
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={record.isPending || !agreed || source.trim().length < 5}>
                  Record SMS consent
                </Button>
              </form>
            )}

            {t.messages.length > 0 ? (
              <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label="Text messages">
                {t.messages.map((m) => (
                  <li key={m.id} className={`rounded-md p-2 ${m.direction === 'out' ? 'ml-6 bg-primary/5' : 'mr-6 bg-muted'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                      {m.direction === 'out' ? `Sent${m.sentBy ? ` by ${m.sentBy}` : ''}${m.source === 'workflow' ? ' (workflow)' : ''} · ${m.segments} segment${m.segments === 1 ? '' : 's'}` : 'From them'} · {relativeTime(m.createdAt)}
                    </p>
                    {m.error && <p className="text-xs text-critical">{m.error}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No texts with this number yet.</p>
            )}
            <p className="text-xs text-muted-foreground">Delivered comes from the carrier through Twilio’s signed status updates. Some carriers never confirm delivery.</p>

            {canSend && t.consent && !t.optedOutAt && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send.mutate();
                }}
              >
                <Label htmlFor={`sms-text-${contactId}`}>Text message</Label>
                <Textarea id={`sms-text-${contactId}`} rows={3} maxLength={SMS_MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {text ? `${seg.units} characters · ${seg.segments} segment${seg.segments === 1 ? '' : 's'} (${seg.encoding})${seg.encoding === 'UCS-2' ? ': emoji or special characters make each segment shorter' : ''}. Twilio bills per segment.` : 'Up to 160 plain characters fit in one segment.'}
                </p>
                {trial && <p className="text-xs text-warning">Twilio trial account: texts reach only numbers verified in the Twilio console, and start with “Sent from your Twilio trial account”.</p>}
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
                  Send this text to {t.phone} now.
                </label>
                <Button type="submit" size="sm" disabled={send.isPending || !text.trim() || !confirm}>
                  Send text
                </Button>
              </form>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
