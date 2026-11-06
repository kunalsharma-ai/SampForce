'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input } from '@dealflow/ui';
import { type PasswordResetRequestInput, passwordResetRequestSchema } from '@dealflow/types';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FloatingField } from '@/components/forms/floating-field';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Asks for a reset link. The page says the same thing whether or not the address has an account. */
export function ForgotPasswordForm() {
  const t = useT();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PasswordResetRequestInput>({ resolver: zodResolver(passwordResetRequestSchema), defaultValues: { email: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/password-reset/request', { method: 'POST', json: values });
      setSentTo(values.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Reset your password')}</h1>
        <p className="text-sm text-muted-foreground">{t('Enter the email you sign in with and we will send you a link to choose a new password.')}</p>
      </div>
      {sentTo ? (
        <div role="status" className="space-y-2 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">{t('Check your email')}</p>
          <p>
            {t('If {email} has a SampForce account, a reset link is on its way. It works once and expires soon. Nothing arrived? Check spam, or ask again in a few minutes.', { email: sentTo })}
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FloatingField id="email" label={t('Work email')} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </FloatingField>
          {error && (
            <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('Sending…') : t('Send reset link')}
          </Button>
        </form>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {t('Your workspace uses single sign-on? Reset your password with your company instead.')}{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('Back to sign in')}
        </Link>
      </p>
    </div>
  );
}
