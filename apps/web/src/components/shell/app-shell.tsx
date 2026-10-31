'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { hexToHslTriplet, useSession, useSignOut } from '@/lib/session';
import { AmbientBackground } from '../ambient-background';
import { QuickCreateHost } from '../crm/quick-create';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data, isPending, error } = useSession();
  const pathname = usePathname();
  const brand = data?.tenant.brandColor ? hexToHslTriplet(data.tenant.brandColor) : null;

  return (
    <div className="flex min-h-screen" style={brand ? ({ '--primary': brand, '--ring': brand } as React.CSSProperties) : undefined}>
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <AmbientBackground />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {data?.tenant.isDemo && (
          <div role="note" className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-xs text-warning">
            Demo workspace: all records here are synthetic development data.
          </div>
        )}
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          {isPending ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading workspace">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : error ? (
            <p role="alert" className="text-sm text-critical">
              We couldn&apos;t load your workspace. Refresh to try again.
            </p>
          ) : data?.restriction && !(data.restriction === 'mfa_enrolment' && pathname === '/app/account/security') ? (
            <PolicyGate restriction={data.restriction} />
          ) : (
            // Enter-only transition. An exit animation (AnimatePresence) would briefly render the
            // new route inside the old wrapper and then remount it, discarding anything typed.
            <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
              {children}
            </motion.div>
          )}
        </main>
      </div>
      {data && <QuickCreateHost />}
    </div>
  );
}

/** Shown instead of the page while the workspace's security policy is not met (the API refuses the data anyway). */
function PolicyGate({ restriction }: { restriction: 'mfa_enrolment' | 'sso_required' }) {
  const signOut = useSignOut();
  const mfa = restriction === 'mfa_enrolment';
  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <CardHeader>
        <CardTitle>{mfa ? 'Turn on two-step verification' : 'Sign in with single sign-on'}</CardTitle>
        <CardDescription>
          {mfa
            ? 'This workspace requires two-step verification. It takes about a minute with an authenticator app on your phone.'
            : 'This workspace now requires single sign-on through your organization’s identity provider. Sign out, then choose “Sign in with SSO”.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {mfa ? (
          <Button asChild>
            <Link href="/app/account/security">Set it up</Link>
          </Button>
        ) : (
          <Button onClick={() => void signOut().then(() => window.location.assign('/login/sso'))}>Sign out and use SSO</Button>
        )}
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}
