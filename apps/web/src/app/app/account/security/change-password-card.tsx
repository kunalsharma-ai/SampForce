'use client';

import { changePasswordSchema, type PasswordChanged } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useMfaStatus } from '@/lib/security';

type Errors = Partial<Record<'currentPassword' | 'newPassword' | 'repeat', string>>;

/**
 * Change the password while signed in (workspace redesign W6): the current password, the new one twice. The API checks
 * the current one, signs every other device out and emails the person; a forgotten password goes through the reset link.
 */
export function ChangePasswordCard() {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const mfa = useMfaStatus();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PasswordChanged | null>(null);
  const [busy, setBusy] = useState(false);
  // Single sign-on accounts have no SampForce password: their identity provider handles it.
  const sso = mfa.data && !mfa.data.canManage;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    const next: Errors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) next[issue.path[0] as 'currentPassword' | 'newPassword'] ??= t.maybe(issue.message);
    if (newPassword !== repeat) next.repeat = t('The two new passwords are not the same');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const result = await api<PasswordChanged>('/auth/password', { method: 'POST', json: { currentPassword, newPassword } });
      setDone(result);
      setCurrent('');
      setNew('');
      setRepeat('');
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="change-password" className="scroll-mt-20" data-change-password>
      <CardHeader>
        <CardTitle>{t('Change password')}</CardTitle>
        <CardDescription>{t('Enter your current password, then the new one. Your other devices are signed out, and you get an email about the change.')}</CardDescription>
      </CardHeader>
      <CardContent>
        {sso ? (
          <p className="text-sm text-muted-foreground">{t('You sign in through your organization’s identity provider, so your password is changed there.')}</p>
        ) : (
          <form className="max-w-sm space-y-4" onSubmit={submit} noValidate>
            <Field id={`${id}-current`} label={t('Current password')} error={errors.currentPassword}>
              <Input id={`${id}-current`} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field id={`${id}-new`} label={t('New password')} hint={t('At least 10 characters, with a letter and a number.')} error={errors.newPassword}>
              <Input id={`${id}-new`} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            <Field id={`${id}-repeat`} label={t('Repeat the new password')} error={errors.repeat}>
              <Input id={`${id}-repeat`} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
            <p role="status" className="text-sm text-success" data-password-changed>
              {done && (done.signedOut ? t('Password changed. {count} other devices were signed out.', { count: done.signedOut }) : t('Password changed.'))}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {t('Change password')}
              </Button>
              <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
                {t('Forgot your password?')}
              </Link>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
