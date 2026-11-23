import { Suspense } from 'react';
import { AuthShell } from '@/components/sign-in/auth-shell';

/** Sign-in, sign-up, invitations and password resets, over the level's animated SampForce scene (ADR 0075). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthShell>{children}</AuthShell>
    </Suspense>
  );
}
