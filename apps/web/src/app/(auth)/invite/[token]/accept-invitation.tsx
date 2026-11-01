'use client';

import { Button, Field, Input, Skeleton } from '@dealflow/ui';
import { type InvitationPreview, passwordSchema } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const t = useT();
  const preview = useQuery({ queryKey: ['invitation', token], queryFn: () => api<InvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`), retry: false });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (preview.isPending) return <Skeleton className="h-64" />;
  if (preview.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Invitation unavailable')}</h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {preview.error.message}
        </p>
        <Button asChild variant="outline">
          <Link href="/login">{t('Go to sign in')}</Link>
        </Button>
      </div>
    );
  }
  const inv = preview.data;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next: Record<string, string> = {};
    if (!inv.hasAccount) {
      if (!name.trim()) next.name = t('Enter your name');
      const p = passwordSchema.safeParse(password);
      if (!p.success) next.password = t.maybe(p.error.issues[0]?.message ?? 'Choose a stronger password');
    } else if (!password) next.password = t('Enter your password');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api('/auth/invitations/accept', { method: 'POST', json: { token, password, ...(inv.hasAccount ? {} : { name }) } });
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Could not reach DealFlow. Check your connection.'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Join {workspace}', { workspace: inv.tenantName })}</h1>
        <p className="text-sm text-muted-foreground">
          {t('You were invited as {role} with {email}.', { role: inv.roleName, email: inv.email })}
        </p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-4">
        {!inv.hasAccount && (
          <Field id="name" label={t('Your name')} error={errors.name}>
            <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field
          id="password"
          label={inv.hasAccount ? t('Your DealFlow password') : t('Choose a password')}
          error={errors.password}
          hint={inv.hasAccount ? t('You already have an account; confirm it is you.') : t('At least 10 characters, with a letter and a number.')}
        >
          <Input type="password" autoComplete={inv.hasAccount ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('Joining…') : t('Join {workspace}', { workspace: inv.tenantName })}
        </Button>
      </form>
    </div>
  );
}
