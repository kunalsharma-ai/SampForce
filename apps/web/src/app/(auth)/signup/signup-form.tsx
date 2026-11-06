'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input } from '@dealflow/ui';
import { type RegisterInput, registerSchema } from '@dealflow/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FloatingField } from '@/components/forms/floating-field';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function SignupForm() {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', organizationName: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/register', { method: 'POST', json: values });
      router.replace('/app?welcome=1');
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        for (const d of err.details) form.setError(d.path as keyof RegisterInput, { message: d.message });
      }
      setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    }
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Create your workspace')}</h1>
        <p className="text-sm text-muted-foreground">{t('Free for up to 2 users. No card required.')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FloatingField id="name" label={t('Your name')} error={errors.name?.message}>
          <Input autoComplete="name" {...form.register('name')} />
        </FloatingField>
        <FloatingField id="email" label={t('Work email')} error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FloatingField>
        <FloatingField id="password" label={t('Password')} error={errors.password?.message} hint={t('At least 10 characters, with a letter and a number.')}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FloatingField>
        <FloatingField id="organizationName" label={t('Organization name')} error={errors.organizationName?.message}>
          <Input autoComplete="organization" {...form.register('organizationName')} />
        </FloatingField>
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('Creating workspace…') : t('Start free')}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('Already have an account?')}{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('Sign in')}
        </Link>
      </p>
    </div>
  );
}
