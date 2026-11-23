'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import type { PasswordConfirmationIssued } from '@dealflow/types';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type ConfirmationRequest, setPasswordConfirmationAsker } from '@/lib/password-confirmation';
import { useT } from '@/lib/i18n';

/*
 * Confirm deletion (workspace redesign W1, spec sections 6 and 15): before anything is deleted the person types their
 * password; the server checks it and hands back a one-time pass that the delete carries. Nothing here depends on the
 * workspace, so the Console can mount the same dialog with its own `endpoint`.
 */

export interface ConfirmDeletionDialogProps {
  open: boolean;
  /** What is about to be deleted, in a sentence. Defaults to the general warning. */
  description?: string;
  /** For critical deletes: the name the person must type before the password (a workspace's, the company's). */
  confirmName?: string;
  /** Where the password is checked. Workspace people: /auth/confirm-password. */
  endpoint?: string;
  /** Shown above the form, such as "Your password check has expired". */
  notice?: string;
  confirmLabel?: string;
  onConfirmed: (pass: string) => void;
  onCancel: () => void;
}

export function ConfirmDeletionDialog({ open, description, confirmName, endpoint = '/auth/confirm-password', notice, confirmLabel, onConfirmed, onCancel }: ConfirmDeletionDialogProps) {
  const t = useT();
  const id = useId();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setCode('');
      setTyped('');
      setError(null);
      setUseCode(false);
    }
  }, [open]);

  const nameOk = !confirmName || typed.trim() === confirmName.trim();
  const secretOk = useCode ? code.trim().length >= 6 : password.length > 0;

  const submit = async () => {
    if (!nameOk || !secretOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<PasswordConfirmationIssued>(endpoint, { method: 'POST', json: useCode ? { code } : { password } });
      onConfirmed(r.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Could not reach SampForce. Check your connection.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-md p-6" data-confirm-deletion>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-critical/10 text-critical" aria-hidden>
            <ShieldAlert className="size-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold">{t('Confirm deletion')}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              {description ?? t('This action will permanently delete the selected data.')} {t('Please enter your password to continue.')}
            </DialogDescription>
          </div>
        </div>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {notice && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground">{notice}</p>}
          {confirmName && (
            <div className="space-y-1.5 text-sm">
              <label htmlFor={`${id}-name`} className="block font-medium">
                {t('Type {name} to confirm', { name: confirmName })}
              </label>
              <Input id={`${id}-name`} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} aria-invalid={typed.length > 0 && !nameOk} />
            </div>
          )}
          {useCode ? (
            <div className="space-y-1.5 text-sm">
              <label htmlFor={`${id}-code`} className="block font-medium">{t('Two-step code')}</label>
              <Input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" autoFocus={!confirmName} onChange={(e) => setCode(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <label htmlFor={`${id}-password`} className="block font-medium">{t('Password')}</label>
              <Input id={`${id}-password`} type="password" value={password} autoComplete="current-password" autoFocus={!confirmName} onChange={(e) => setPassword(e.target.value)} aria-describedby={error ? `${id}-error` : undefined} />
            </div>
          )}
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setUseCode((v) => !v)}>
            {useCode ? t('Use my password instead') : t('I sign in with single sign-on: use a two-step code')}
          </button>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!nameOk || !secretOk || busy}>
              {busy ? t('Checking…') : (confirmLabel ?? t('Confirm delete'))}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted once by a shell: any delete anywhere below that the server refuses for want of a password confirmation
 * opens the dialog, and the delete goes ahead with the pass once the password is right.
 */
export function PasswordConfirmationProvider({ endpoint, children }: { endpoint?: string; children: React.ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<ConfirmationRequest | null>(null);
  const resolver = useRef<((pass: string | null) => void) | null>(null);

  useEffect(() => {
    setPasswordConfirmationAsker(
      (request) =>
        new Promise<string | null>((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setPending(request);
        }),
    );
    return () => {
      setPasswordConfirmationAsker(null);
      resolver.current?.(null);
    };
  }, []);

  const finish = (pass: string | null) => {
    resolver.current?.(pass);
    resolver.current = null;
    setPending(null);
  };
  const expired = pending?.message === 'Your password check has expired. Enter your password again.';

  return (
    <>
      {children}
      <ConfirmDeletionDialog
        open={!!pending}
        endpoint={endpoint}
        notice={expired ? t('Your password check has expired. Enter your password again.') : undefined}
        onConfirmed={(pass) => finish(pass)}
        onCancel={() => finish(null)}
      />
    </>
  );
}
