'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@dealflow/ui';
import Link from 'next/link';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Minimize2 } from 'lucide-react';
import { useAppearanceSync } from '@/lib/appearance-sync';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { useRegionalSync } from '@/lib/regional-sync';
import { useSession, useSignOut } from '@/lib/session';
import { useLockedFeature } from '@/lib/features';
import { useShell } from '@/stores/shell';
import { CelebrationHost } from '../achievements/celebration-host';
import { AmbientBackground } from '../ambient-background';
import { QuickCreateHost } from '../crm/quick-create';
import { SectionNotices } from '../notifications/section-notices';
import { WelcomeOverlay } from '../sign-in/welcome-overlay';
import { PasswordConfirmationProvider } from '../security/confirm-deletion-dialog';
import { CustomizeMenuDialog } from './customize-menu';
import { FeatureLocked } from './feature-locked';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { MobileBottomNav } from './mobile-nav';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data, isPending, error } = useSession();
  const pathname = usePathname();
  // The workspace brand colour goes through the theme engine, which keeps it readable in both modes.
  useAppearanceSync(!!data, data?.tenant.brandColor ?? null);
  useRegionalSync(!!data);
  const t = useT();
  // A page outside the workspace's plan shows the upgrade page; the API refuses its data anyway (ADR 0057).
  const locked = useLockedFeature(pathname);
  const focus = useShell((s) => s.focus);
  const setFocus = useShell((s) => s.setFocus);
  useEffect(() => {
    if (focus) document.documentElement.dataset.focus = 'on';
    else delete document.documentElement.dataset.focus;
  }, [focus]);

  return (
    <PasswordConfirmationProvider>
      <div className="flex min-h-screen">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
        >
          {t('shell.skip')}
        </a>
        <AmbientBackground />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {data?.tenant.isDemo && (
            <div
              role="note"
              className="border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-xs text-warning"
            >
              {t('shell.demo')}
            </div>
          )}
          {focus && (
            <div
              role="status"
              className="flex items-center justify-center gap-3 border-b border-border/70 bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
            >
              {t('shell.focusOn')}
              <button
                type="button"
                onClick={() => setFocus(false)}
                className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
              >
                <Minimize2 className="size-3.5" aria-hidden /> {t('shell.focusExit')}
              </button>
            </div>
          )}
          <main id="main" className="flex-1 px-4 pb-24 pt-6 md:px-8 lg:pb-6">
            {isPending ? (
              <div
                role="status"
                className="space-y-4"
                aria-busy="true"
                aria-label={t('shell.loading')}
              >
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : error ? (
              <p role="alert" className="text-sm text-critical">
                {t('shell.loadError')}
              </p>
            ) : data?.restriction &&
              !(data.restriction === 'mfa_enrolment' && pathname === '/app/account/security') ? (
              <PolicyGate restriction={data.restriction} until={data.restrictionUntil} />
            ) : locked ? (
              <FeatureLocked feature={locked} />
            ) : (
              // Enter-only transition. An exit animation (AnimatePresence) would briefly render the
              // new route inside the old wrapper and then remount it, discarding anything typed. The key also includes the
              // language and format locale, so a change re-renders every page's text, dates and numbers at once.
              <motion.div
                key={`${pathname}|${t.language}|${t.formatLocale}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {/* The section's own unread notifications (ADR 0075), above the page they belong to. */}
                <SectionNotices />
                {children}
              </motion.div>
            )}
          </main>
        </div>
        {data && <QuickCreateHost />}
        {/* Celebrations for real achievements (ADR 0090), never during a security restriction. */}
        {data && !data.restriction && <CelebrationHost />}
        {data && !data.restriction && <MobileBottomNav />}
        {data && <CustomizeMenuDialog />}
        <KeyboardShortcuts />
        {/* The level's welcome, once, right after signing in (ADR 0075). */}
        <WelcomeOverlay />
      </div>
    </PasswordConfirmationProvider>
  );
}

/** Shown instead of the page while the workspace's security policy is not met (the API refuses the data anyway). */
function PolicyGate({ restriction, until }: { restriction: 'mfa_enrolment' | 'sso_required' | 'workspace_deactivated'; until?: string }) {
  const signOut = useSignOut();
  const t = useT();
  const mfa = restriction === 'mfa_enrolment';
  if (restriction === 'workspace_deactivated' && until) {
    return (
      <Card className="mx-auto mt-8 max-w-lg" data-workspace-blacklisted>
        <CardHeader>
          <CardTitle>{t('Your workspace is blocked for now')}</CardTitle>
          <CardDescription>
            {t('It is blacklisted until {date}, so you cannot work in SampForce before then. Your data is kept. Ask your manager or administrator, or SampForce support, if you think this is a mistake.', {
              date: new Intl.DateTimeFormat(fmtLocale(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(until)),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            {t('top.signOut')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (restriction === 'workspace_deactivated') {
    return (
      <Card className="mx-auto mt-8 max-w-lg" data-workspace-deactivated>
        <CardHeader>
          <CardTitle>{t('Your workspace is deactivated')}</CardTitle>
          <CardDescription>{t('The workspace above yours has deactivated it, so you cannot work in SampForce for now. Your data is kept. Ask your manager or administrator to reactivate it.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            {t('top.signOut')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <CardHeader>
        <CardTitle>{mfa ? t('shell.policy.mfaTitle') : t('shell.policy.ssoTitle')}</CardTitle>
        <CardDescription>
          {mfa ? t('shell.policy.mfaText') : t('shell.policy.ssoText')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {mfa ? (
          <Button asChild>
            <Link href="/app/account/security">{t('shell.policy.setUp')}</Link>
          </Button>
        ) : (
          <Button onClick={() => void signOut().then(() => window.location.assign('/login/sso'))}>
            {t('shell.policy.useSso')}
          </Button>
        )}
        <Button variant="outline" onClick={() => void signOut()}>
          {t('top.signOut')}
        </Button>
      </CardContent>
    </Card>
  );
}
