'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import {
  BULK_CONFIRM_WORD,
  type ClientState,
  type ConsoleBulkAction,
  type ConsoleClientBulkResult,
  type FeatureKey,
  FEATURES,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { selectClass } from '@/app/operator/console-ui';

export const BULK_TITLE: Record<ConsoleBulkAction, string> = {
  state: 'Change status',
  extend: 'Extend subscriptions',
  feature: 'Set a feature',
  notify: 'Email administrators',
};

const STATE_LABEL: Record<ClientState, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated' };

/**
 * One action over the selected clients (ADR 0074, C4b). Taking access away shows how many clients it affects and needs
 * CONFIRM typed; afterwards the dialog lists what changed, what was skipped and why, and anything that failed.
 */
export function BulkDialog({ action, ids, onClose }: { action: ConsoleBulkAction; ids: string[]; onClose: (changed: boolean) => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<ClientState>('SUSPENDED');
  const [days, setDays] = useState('30');
  const [feature, setFeature] = useState<FeatureKey>(FEATURES[0]!.key);
  const [setting, setSetting] = useState<'on' | 'off' | 'plan'>('off');
  const [reason, setReason] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState('');
  const destructive = action === 'state' && state !== 'ACTIVE';
  const n = ids.length;
  const clients = `${n} ${n === 1 ? 'client' : 'clients'}`;

  const run = useMutation({
    mutationFn: () => {
      const body =
        action === 'state'
          ? { action, ids, state, reason, ...(destructive ? { confirm } : {}) }
          : action === 'extend'
            ? { action, ids, days: Number(days), reason }
            : action === 'feature'
              ? { action, ids, feature, enabled: setting === 'plan' ? null : setting === 'on', reason }
              : { action, ids, subject, message };
      return api<ConsoleClientBulkResult>('/operator/clients/bulk', { method: 'POST', json: body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['operator', 'client'] });
    },
  });
  const r = run.data;
  const ready =
    action === 'notify' ? subject.trim().length >= 3 && message.trim().length >= 10 : reason.trim().length >= 5 && (!destructive || confirm === BULK_CONFIRM_WORD);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(!!r)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{BULK_TITLE[action]}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {r ? 'Finished.' : `For ${clients}. Each client is changed and recorded in the audit log on its own.`}
        </DialogDescription>
        {r ? (
          <div className="mt-4 space-y-3 text-sm" data-bulk-result>
            <p>
              <strong>{r.done.length}</strong> {action === 'notify' ? 'emailed' : 'changed'}
              {r.skipped.length > 0 && <>, {r.skipped.length} skipped</>}
              {r.failed.length > 0 && <>, {r.failed.length} failed</>}.
            </p>
            {[...r.skipped.map((s) => ({ ...s, kind: 'Skipped' })), ...r.failed.map((s) => ({ ...s, kind: 'Failed' }))].length > 0 && (
              <ul className="space-y-1 rounded-lg border border-border p-3">
                {r.skipped.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.name}</span>: <span className="text-muted-foreground">{s.reason}</span>
                  </li>
                ))}
                {r.failed.map((s) => (
                  <li key={s.id} className="text-critical">
                    <span className="font-medium">{s.name}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button onClick={() => onClose(true)}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) run.mutate();
            }}
          >
            {action === 'state' && (
              <Field id="bulk-state" label="New status">
                <select id="bulk-state" className={selectClass} value={state} onChange={(e) => setState(e.target.value as ClientState)}>
                  {(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const).map((s) => (
                    <option key={s} value={s}>
                      {STATE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {action === 'extend' && (
              <Field id="bulk-days" label="Days to add to the renewal date">
                <Input id="bulk-days" type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            )}
            {action === 'feature' && (
              <>
                <Field id="bulk-feature" label="Feature">
                  <select id="bulk-feature" className={selectClass} value={feature} onChange={(e) => setFeature(e.target.value as FeatureKey)}>
                    {FEATURES.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">For these clients</legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {(
                      [
                        ['on', 'Turn on'],
                        ['off', 'Turn off'],
                        ['plan', 'As the plan says'],
                      ] as const
                    ).map(([v, label]) => (
                      <label key={v} className="inline-flex items-center gap-2">
                        <input type="radio" name="bulk-setting" value={v} checked={setting === v} onChange={() => setSetting(v)} className="accent-primary" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {action === 'notify' ? (
              <>
                <Field id="bulk-subject" label="Subject">
                  <Input id="bulk-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
                </Field>
                <Field id="bulk-message" label="Message">
                  <textarea
                    id="bulk-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">Sent by email to each client’s administrators, from SampForce.</p>
              </>
            ) : (
              <Field id="bulk-reason" label="Reason">
                <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Kept in the audit log" />
              </Field>
            )}
            {destructive && (
              <div className="space-y-2 rounded-lg border border-critical/40 bg-critical/5 p-3">
                <p className="text-sm">
                  Nobody in these <strong>{clients}</strong> will be able to sign in
                  {state === 'DEACTIVATED' ? ', and their subscriptions end' : ''}. Their data is kept.
                </p>
                <Field id="bulk-confirm" label={`Type ${BULK_CONFIRM_WORD} to continue`}>
                  <Input id="bulk-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
                </Field>
              </div>
            )}
            <ErrorText error={run.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onClose(false)}>
                Cancel
              </Button>
              <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!ready || run.isPending}>
                {run.isPending ? 'Working…' : `${BULK_TITLE[action]} for ${clients}`}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
