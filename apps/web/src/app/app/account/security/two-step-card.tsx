'use client';

import type { MfaEnableResponse, MfaSetupResponse } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { useMfaStatus } from '@/lib/security';
import { fmtLocale } from '@/lib/i18n/locale';

type Step = { kind: 'idle' } | { kind: 'password' } | { kind: 'scan'; setup: MfaSetupResponse } | { kind: 'codes'; codes: string[] } | { kind: 'disable' } | { kind: 'regenerate' };

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Could not reach DealFlow. Check your connection.';
}

/** Two-step verification with an authenticator app: set up, recovery codes, turn off. */
export function TwoStepCard() {
  const status = useMfaStatus();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['mfa'] }), qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['sessions'] })]);
  const s = status.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-step verification {s && (s.enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>)}
        </CardTitle>
        <CardDescription>After your password, DealFlow asks for a code from an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {s && !s.canManage && <p className="text-sm text-muted-foreground">You sign in through your organization’s identity provider, which handles verification. Ask your administrator about its settings.</p>}

        {s?.canManage && step.kind === 'idle' && !s.enabled && (
          <Button onClick={() => setStep({ kind: 'password' })}>Turn on two-step verification</Button>
        )}
        {s?.canManage && step.kind === 'idle' && s.enabled && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              On since {s.enabledAt ? new Date(s.enabledAt).toLocaleDateString(fmtLocale()) : '—'}. {s.recoveryCodesRemaining} of 10 recovery codes left.
              {s.recoveryCodesRemaining <= 3 && ' Make new ones soon.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep({ kind: 'regenerate' })}>New recovery codes</Button>
              <Button variant="outline" onClick={() => setStep({ kind: 'disable' })}>Turn off</Button>
            </div>
          </div>
        )}

        {step.kind === 'password' && (
          <PasswordStep
            busy={busy}
            label="Continue"
            intro="Confirm your password to start."
            onCancel={() => setStep({ kind: 'idle' })}
            onSubmit={(password) => run(async () => setStep({ kind: 'scan', setup: await api<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST', json: { password } }) }))}
          />
        )}
        {step.kind === 'scan' && (
          <ScanStep
            setup={step.setup}
            busy={busy}
            onCancel={() => setStep({ kind: 'idle' })}
            onSubmit={(code) =>
              run(async () => {
                const res = await api<MfaEnableResponse>('/auth/mfa/enable', { method: 'POST', json: { code } });
                setStep({ kind: 'codes', codes: res.recoveryCodes });
              })
            }
          />
        )}
        {step.kind === 'codes' && (
          <RecoveryCodes
            codes={step.codes}
            onDone={() =>
              void refresh().then(() => setStep({ kind: 'idle' }))
            }
          />
        )}
        {step.kind === 'regenerate' && (
          <CodeStep
            busy={busy}
            intro="Enter a code from your authenticator app. Your old recovery codes stop working."
            label="Make new codes"
            onCancel={() => setStep({ kind: 'idle' })}
            onSubmit={(code) => run(async () => setStep({ kind: 'codes', codes: (await api<MfaEnableResponse>('/auth/mfa/recovery-codes', { method: 'POST', json: { code } })).recoveryCodes }))}
          />
        )}
        {step.kind === 'disable' && (
          <DisableStep
            busy={busy}
            onCancel={() => setStep({ kind: 'idle' })}
            onSubmit={(password, code) =>
              run(async () => {
                await api('/auth/mfa/disable', { method: 'POST', json: { password, code } });
                await refresh();
                setStep({ kind: 'idle' });
              })
            }
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordStep({ intro, label, busy, onSubmit, onCancel }: { intro: string; label: string; busy: boolean; onSubmit: (p: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(password); }}>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <Field id="mfa-password" label="Password">
        <Input id="mfa-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-xs" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !password}>{label}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function CodeInput({ id, value, onChange, allowRecovery = false }: { id: string; value: string; onChange: (v: string) => void; allowRecovery?: boolean }) {
  return (
    <Input
      id={id}
      autoComplete="one-time-code"
      inputMode={allowRecovery ? 'text' : 'numeric'}
      maxLength={allowRecovery ? 16 : 6}
      value={value}
      onChange={(e) => onChange(allowRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
      className={allowRecovery ? 'max-w-56 font-mono' : 'max-w-40 font-mono tracking-widest'}
      placeholder={allowRecovery ? '123456 or xxxxx-xxxxx' : '123456'}
    />
  );
}

function ScanStep({ setup, busy, onSubmit, onCancel }: { setup: MfaSetupResponse; busy: boolean; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192, errorCorrectionLevel: 'M' }).then(setQr);
  }, [setup.otpauthUri]);
  const grouped = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(code); }}>
      <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
        <li>Open your authenticator app and add an account.</li>
        <li>Scan the QR code, or type the key below.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-6">
        <div className="grid size-[200px] place-items-center rounded-md bg-white p-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not a remote image */}
          {qr ? <img src={qr} width={192} height={192} alt="QR code for your authenticator app. The same key is written next to it." /> : <span className="text-xs text-neutral-600">Drawing…</span>}
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Key (if you cannot scan):</p>
          <p className="select-all break-all font-mono text-base tracking-wide" aria-label={`Key ${setup.secret.split('').join(' ')}`}>{grouped}</p>
          <p className="text-xs text-muted-foreground">Time-based, 6 digits, 30 seconds.</p>
        </div>
      </div>
      <Field id="mfa-first-code" label="Code from your app">
        <CodeInput id="mfa-first-code" value={code} onChange={setCode} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || code.length !== 6}>Turn on</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="text-xs text-muted-foreground">Turning it on signs out your other devices.</p>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `DealFlow recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dealflow-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="space-y-3" role="region" aria-label="Recovery codes">
      <p className="text-sm">
        <strong>Save these recovery codes now.</strong> Each one signs you in once if you lose your phone. DealFlow will not show them again.
      </p>
      <ul className="grid max-w-md grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={download}>Download</Button>
        <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button onClick={onDone}>I have saved them</Button>
      </div>
    </div>
  );
}

function CodeStep({ intro, label, busy, onSubmit, onCancel }: { intro: string; label: string; busy: boolean; onSubmit: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(code); }}>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <Field id="mfa-code" label="Code">
        <CodeInput id="mfa-code" value={code} onChange={setCode} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || code.length !== 6}>{label}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function DisableStep({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (password: string, code: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(password, code); }}>
      <p className="text-sm text-muted-foreground">Turning it off makes your account easier to break into. If your workspace requires two-step verification you will need to turn it on again.</p>
      <Field id="mfa-off-password" label="Password">
        <Input id="mfa-off-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-xs" />
      </Field>
      <Field id="mfa-off-code" label="Code from your app, or a recovery code">
        <CodeInput id="mfa-off-code" value={code} onChange={setCode} allowRecovery />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" disabled={busy || !password || code.length < 6}>Turn off</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
