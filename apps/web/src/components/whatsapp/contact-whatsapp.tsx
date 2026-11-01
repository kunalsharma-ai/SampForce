'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@dealflow/ui';
import type { AppStatus, WhatsappMessageRow, WhatsappTemplate, WhatsappThread } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

const STATUS: Record<WhatsappMessageRow['status'], { label: string; tone: 'neutral' | 'success' | 'critical' | 'primary' }> = {
  accepted: { label: 'Accepted by WhatsApp', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'primary' },
  read: { label: 'Read', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
  received: { label: 'Received', tone: 'neutral' },
};

/** WhatsApp for one contact: consent, the conversation, and one-to-one sending. Shown once WhatsApp Business is connected. */
export function ContactWhatsapp({ contactId }: { contactId: string }) {
  const canRead = useCan('contacts:read');
  const canSend = useCan('activities:write');
  const canConsent = useCan('contacts:write');
  const qc = useQueryClient();
  const apps = useQuery({ enabled: canRead, queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const wa = apps.data?.find((a) => a.key === 'whatsapp');
  const live = wa?.state === 'connected' || wa?.state === 'error';
  const thread = useQuery({ enabled: canRead && live, queryKey: ['whatsapp', contactId], queryFn: () => api<WhatsappThread>(`/apps/whatsapp/contacts/${contactId}`) });
  const t = thread.data;
  const templates = useQuery({ enabled: canSend && live && !!t?.consent, queryKey: ['apps', 'whatsapp', 'templates'], queryFn: () => api<WhatsappTemplate[]>('/apps/whatsapp/templates') });
  const [source, setSource] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [templateKey, setTemplateKey] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [reply, setReply] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['whatsapp', contactId] });
  const record = useMutation({
    mutationFn: () => api<WhatsappThread>('/apps/whatsapp/consents', { method: 'POST', json: { contactId, source, confirm: agreed } }),
    onSuccess: () => {
      setSource('');
      setAgreed(false);
      return refresh();
    },
  });
  const withdraw = useMutation({ mutationFn: () => api<WhatsappThread>(`/apps/whatsapp/consents/${contactId}`, { method: 'DELETE' }), onSuccess: refresh });
  const chosen = templates.data?.find((x) => `${x.name}|${x.language}` === templateKey);
  const sendTemplate = useMutation({
    mutationFn: () => api<WhatsappMessageRow>('/apps/whatsapp/messages', { method: 'POST', json: { kind: 'template', contactId, templateName: chosen!.name, language: chosen!.language, params, confirm } }),
    onSuccess: () => {
      setTemplateKey('');
      setParams([]);
      setConfirm(false);
      return refresh();
    },
  });
  const sendReply = useMutation({
    mutationFn: () => api<WhatsappMessageRow>('/apps/whatsapp/messages', { method: 'POST', json: { kind: 'text', contactId, text: reply, confirm: true } }),
    onSuccess: () => {
      setReply('');
      return refresh();
    },
  });
  if (!live || !canRead) return null;
  const error = record.error ?? withdraw.error ?? sendTemplate.error ?? sendReply.error ?? thread.error;
  const preview = chosen ? chosen.body.replace(/\{\{(\d+)\}\}/g, (m, i: string) => params[Number(i) - 1] || m) : '';

  return (
    <Card role="region" aria-labelledby={`wa-${contactId}`}>
      <CardHeader className="pb-2">
        <CardTitle id={`wa-${contactId}`} className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" aria-hidden /> WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {wa?.state === 'error' && <p className="text-xs text-critical">WhatsApp needs new credentials in Integrations before anything can be sent.</p>}
        {t?.phoneProblem && <p className="text-muted-foreground">{t.phoneProblem}</p>}
        {t?.phone && (
          <>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Number +{t.phone}</p>
              {t.consent ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="success">Consent recorded</Badge>
                  <span className="text-muted-foreground">
                    {t.consent.source} · recorded {relativeTime(t.consent.recordedAt)}
                    {t.consent.recordedBy ? ` by ${t.consent.recordedBy}` : ''}
                  </span>
                  {canConsent && (
                    <Button size="sm" variant="ghost" disabled={withdraw.isPending} onClick={() => window.confirm('Withdraw WhatsApp consent? Templates can no longer be sent to this person until it is recorded again.') && withdraw.mutate()}>
                      Withdraw
                    </Button>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No WhatsApp consent recorded. WhatsApp requires an opt-in before a business sends the first message, so templates are off until it is recorded.</p>
              )}
            </div>
            {!t.consent && canConsent && (
              <form
                className="space-y-2 rounded-md border border-dashed p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  record.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`wa-source-${contactId}`}>How they agreed</Label>
                  <Input id={`wa-source-${contactId}`} value={source} maxLength={200} placeholder="Ticked the WhatsApp box on the demo request form" onChange={(e) => setSource(e.target.value)} />
                </div>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
                  This person agreed to receive WhatsApp messages from us.
                </label>
                <Button type="submit" size="sm" variant="outline" disabled={record.isPending || !agreed || source.trim().length < 5}>
                  Record consent
                </Button>
              </form>
            )}

            {t.messages.length > 0 ? (
              <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label="WhatsApp messages">
                {t.messages.map((m) => (
                  <li key={m.id} className={`rounded-md p-2 ${m.direction === 'out' ? 'ms-6 bg-primary/5' : 'me-6 bg-muted'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                      {m.direction === 'out' ? `${m.templateName ? `Template ${m.templateName}` : 'Reply'}${m.sentBy ? ` by ${m.sentBy}` : ''}${m.source === 'workflow' ? ' (workflow)' : ''}` : 'From them'} · {relativeTime(m.createdAt)}
                    </p>
                    {m.error && <p className="text-xs text-critical">{m.error}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No WhatsApp messages with this number yet.</p>
            )}
            <p className="text-xs text-muted-foreground">Delivered and Read come from WhatsApp’s signed status updates. Read shows only if the person has read receipts on.</p>

            {canSend && t.windowOpenUntil && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply.mutate();
                }}
              >
                <Label htmlFor={`wa-reply-${contactId}`}>Reply</Label>
                <Textarea id={`wa-reply-${contactId}`} rows={3} maxLength={4096} value={reply} onChange={(e) => setReply(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" disabled={sendReply.isPending || !reply.trim()}>
                    Send reply
                  </Button>
                  <span className="text-xs text-muted-foreground">Free-form replies are open until {new Date(t.windowOpenUntil).toLocaleString(fmtLocale(), { dateStyle: 'medium', timeStyle: 'short' })} (24 hours after their last message).</span>
                </div>
              </form>
            )}

            {canSend && t.consent && (
              <form
                className="space-y-2 rounded-md border border-dashed p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendTemplate.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`wa-template-${contactId}`}>Approved template</Label>
                  <Select
                    id={`wa-template-${contactId}`}
                    value={templateKey}
                    onChange={(e) => {
                      setTemplateKey(e.target.value);
                      const x = templates.data?.find((y) => `${y.name}|${y.language}` === e.target.value);
                      setParams(Array.from({ length: x?.params ?? 0 }, () => ''));
                      setConfirm(false);
                    }}
                  >
                    <option value="">{templates.isPending ? 'Loading templates…' : 'Choose a template'}</option>
                    {(templates.data ?? []).map((x) => (
                      <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>
                        {`${x.name} (${x.language})`}
                      </option>
                    ))}
                  </Select>
                </div>
                {params.map((p, i) => (
                  <div key={i} className="space-y-1.5">
                    <Label htmlFor={`wa-param-${contactId}-${i}`}>{`Value for {{${i + 1}}}`}</Label>
                    <Input id={`wa-param-${contactId}-${i}`} value={p} maxLength={1024} onChange={(e) => setParams(params.map((v, j) => (j === i ? e.target.value : v)))} />
                  </div>
                ))}
                {chosen && (
                  <>
                    <p className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs" aria-label="Message preview">
                      {preview}
                    </p>
                    <label className="flex items-start gap-2 text-xs">
                      <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
                      Send this WhatsApp message to +{t.phone} now.
                    </label>
                  </>
                )}
                <Button type="submit" size="sm" disabled={sendTemplate.isPending || !chosen || !confirm || params.some((p) => !p.trim())}>
                  Send template
                </Button>
                {templates.data?.length === 0 && <p className="text-xs text-muted-foreground">No approved templates on this number. Create one in WhatsApp Manager; templates with media headers or button variables are not supported yet.</p>}
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
