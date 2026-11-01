'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input } from '@dealflow/ui';
import { passwordSchema } from '@dealflow/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FloatingField } from '@/components/forms/floating-field';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'The passwords do not match', path: ['confirm'] });
type Values = z.infer<typeof schema>;

/**
 * Sets a new password from the emailed link. The token is in the URL fragment, so it never reaches server logs
 * or other sites; it is removed from the address bar as soon as the page reads it.
 */
export function ResetPasswordForm() {
  const t = useT();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  useEffect(() => {
    const read = () => {
      const found = new URLSearchParams(window.location.hash.slice(1)).get('token');
      // A link opened again in the same tab only changes the fragment, so it is read on hashchange too.
      if (found || window.location.hash === '') setToken((prev) => found ?? prev ?? null);
      if (found) {
        setDone(false);
        setError(null);
        window.history.replaceState(null, '', window.location.pathname);
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/password-reset', { method: 'POST', json: { token, password: values.password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not reach DealFlow. Check your connection.'));
    }
  });

  if (token === undefined) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Choose a new password')}</h1>
        <p className="text-sm text-muted-foreground">{t('At least 10 characters, with a letter and a number. You will be signed out on every device.')}</p>
      </div>
      {done ? (
        <div role="status" className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">{t('Your password was changed')}</p>
          <p>{t('Sign in with your new password. If you use two-step verification, you will still need your code.')}</p>
          <Link href="/login" className="inline-flex h-9 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90">
            {t('Sign in')}
          </Link>
        </div>
      ) : !token ? (
        <div role="alert" className="space-y-2 rounded-md border border-critical/40 bg-critical/10 p-4 text-sm">
          <p>{t('This page needs the link from your reset email. Open the link again, or ask for a new one.')}</p>
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">
            {t('Ask for a new link')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FloatingField id="password" label={t('New password')} error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FloatingField>
          <FloatingField id="confirm" label={t('Type it again')} error={form.formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </FloatingField>
          {error && (
            <div role="alert" className="space-y-1 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
              <p>{error}</p>
              <Link href="/forgot-password" className="font-medium underline">
                {t('Ask for a new link')}
              </Link>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('Saving…') : t('Save new password')}
          </Button>
        </form>
      )}
    </div>
  );
}
