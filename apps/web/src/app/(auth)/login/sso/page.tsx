import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SsoForm } from './sso-form';

export const metadata: Metadata = { title: 'Sign in with SSO' };

export default function SsoPage() {
  return (
    <Suspense>
      <SsoForm />
    </Suspense>
  );
}
