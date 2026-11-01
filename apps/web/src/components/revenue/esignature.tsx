'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@dealflow/ui';
import type { AppStatus, ContractRow, EnvelopeStatus, SignatureEnvelopeRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const STATUS: Record<EnvelopeStatus, { label: string; tone: 'neutral' | 'primary' | 'success' | 'critical' | 'warning' }> = {
  sent: { label: 'Sent, waiting for signature', tone: 'primary' },
  delivered: { label: 'Opened by the signer', tone: 'primary' },
  completed: { label: 'Signed', tone: 'success' },
  declined: { label: 'Declined', tone: 'critical' },
  voided: { label: 'Voided', tone: 'neutral' },
};

/** DocuSign on a contract: send the draft for e-signature (after explicit confirmation) and follow its envelopes. */
export function ContractESignature({ c }: { c: ContractRow }) {
  const qc = useQueryClient();
  const canWrite = useCan('contracts:write');
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const ds = apps.data?.find((a) => a.key === 'docusign');
  const live = ds?.state === 'connected' || ds?.state === 'error';
  const envelopes = useQuery({ enabled: !!live, queryKey: ['envelopes', c.id], queryFn: () => api<SignatureEnvelopeRow[]>(`/apps/docusign/envelopes?contractId=${c.id}`) });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['envelopes', c.id] }), qc.invalidateQueries({ queryKey: ['contracts'] }), qc.invalidateQueries({ queryKey: ['contract', c.id] })]);
  const send = useMutation({
    mutationFn: () => api<SignatureEnvelopeRow>('/apps/docusign/envelopes', { method: 'POST', json: { contractId: c.id, signerName: name, signerEmail: email, message: message || undefined, confirm: true } }),
    onSuccess: () => {
      setConfirm(false);
      return refresh();
    },
  });
  const voidIt = useMutation({
    mutationFn: (id: string) => api<SignatureEnvelopeRow>(`/apps/docusign/envelopes/${id}/void`, { method: 'POST', json: { reason } }),
    onSuccess: () => {
      setVoidId(null);
      setReason('');
      return refresh();
    },
  });
  const check = useMutation({ mutationFn: (id: string) => api<SignatureEnvelopeRow>(`/apps/docusign/envelopes/${id}/check`, { method: 'POST' }), onSuccess: refresh });
  if (!live) return null;
  const items = envelopes.data ?? [];
  const open = items.some((e) => e.status === 'sent' || e.status === 'delivered');
  const error = send.error ?? voidIt.error ?? check.error;
  return (
    <Card role="region" aria-labelledby="esign-heading">
      <CardHeader>
        <CardTitle id="esign-heading" className="text-base">
          E-signature (DocuSign)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {ds.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {w}
          </p>
        ))}
        {canWrite && c.status === 'DRAFT' && !open && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="esign-name">Signer’s name</Label>
              <Input id="esign-name" value={name} maxLength={100} required onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="esign-email">Signer’s email</Label>
              <Input id="esign-email" type="email" value={email} maxLength={254} required onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="esign-message">Message (optional)</Label>
              <Textarea id="esign-message" rows={2} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>Email this contract to {email || 'the signer'} for signature through DocuSign now.</span>
            </label>
            <Button type="submit" size="sm" disabled={send.isPending || !confirm || !name.trim() || !email.trim()}>
              {send.isPending ? 'Sending…' : 'Send for signature'}
            </Button>
          </form>
        )}
        {items.length > 0 && (
          <ul className="space-y-3" aria-label="Signature envelopes">
            {items.map((e) => {
              const s = STATUS[e.status];
              return (
                <li key={e.id} className="space-y-1 border-t border-border pt-2 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.signerName}</span>
                    <span className="text-xs text-muted-foreground">{e.signerEmail}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sent {relativeTime(e.sentAt)}
                    {e.sentBy ? ` by ${e.sentBy}` : ''}
                    {e.completedAt ? `; signed ${relativeTime(e.completedAt)}` : ''}
                  </p>
                  {e.declinedReason && <p className="text-xs text-critical">Reason: {e.declinedReason}</p>}
                  {e.voidedReason && <p className="text-xs text-muted-foreground">Voided: {e.voidedReason}</p>}
                  <div className="flex flex-wrap gap-2">
                    {e.status === 'completed' && (
                      <a className="text-xs text-primary underline underline-offset-2" href={`/api/v1/apps/docusign/envelopes/${e.id}/document`}>
                        Download signed PDF
                      </a>
                    )}
                    {(e.status === 'sent' || e.status === 'delivered') && (
                      <>
                        <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate(e.id)}>
                          Check status
                        </Button>
                        {canWrite && voidId !== e.id && (
                          <Button size="sm" variant="ghost" onClick={() => setVoidId(e.id)}>
                            Void
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {voidId === e.id && (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        voidIt.mutate(e.id);
                      }}
                    >
                      <div className="min-w-48 flex-1 space-y-1.5">
                        <Label htmlFor={`void-${e.id}`}>Reason for voiding</Label>
                        <Input id={`void-${e.id}`} value={reason} maxLength={200} required onChange={(ev) => setReason(ev.target.value)} />
                      </div>
                      <Button type="submit" size="sm" variant="outline" disabled={voidIt.isPending || !reason.trim()}>
                        Void envelope
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {items.length === 0 && c.status !== 'DRAFT' && <p className="text-muted-foreground">Only draft contracts can be sent for signature.</p>}
        {error && (
          <p role="alert" className="text-xs text-critical">
            {error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
