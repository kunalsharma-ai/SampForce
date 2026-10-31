'use client';

import { Button, Field, Input } from '@dealflow/ui';
import { SSO_ERRORS, type SsoErrorCode } from '@dealflow/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const REMEMBER_KEY = 'dealflow:sso-workspace';

function remembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Starts single sign-on: the browser goes to the API, which redirects to the workspace's identity
 * provider and back. Errors from that round trip come back as ?sso_error=.
 */
export function SsoForm() {
  const params = useSearchParams();
  const code = params.get('sso_error');
  const known = code && code in SSO_ERRORS ? SSO_ERRORS[code as SsoErrorCode] : code ? SSO_ERRORS.provider_error : null;
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setWorkspace((w) => w || remembered()), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = workspace.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name)) return setError('Enter the sign-in name your administrator gave you, such as acme.');
    try {
      localStorage.setItem(REMEMBER_KEY, name);
    } catch {
      // Remembering the name is a convenience only.
    }
    window.location.assign(`/api/v1/auth/sso/start?workspace=${encodeURIComponent(name)}`);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in with SSO</h1>
        <p className="text-sm text-muted-foreground">Use your organization’s identity provider, such as Okta, Microsoft Entra ID or Google Workspace.</p>
      </div>
      {known && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
          {known}
        </p>
      )}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="sso-workspace" label="Workspace sign-in name" hint="Your administrator sets this in DealFlow’s security settings." error={error ?? undefined}>
          <Input autoComplete="organization" autoCapitalize="none" spellCheck={false} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in with email and password
        </Link>
      </p>
    </div>
  );
}
