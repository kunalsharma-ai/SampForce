'use client';

import Link from 'next/link';
import { AmbientBackground } from '@/components/ambient-background';
import { Logo } from '@/components/logo';
import { AuthLanguage } from '@/components/auth-language';
import { useT } from '@/lib/i18n';

/** Public marketing pages: landing and pricing. No tracking scripts, no third-party embeds. A client component so the
 * header and footer follow the visitor's language. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="relative flex min-h-screen flex-col">
      <AmbientBackground />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        {t('Skip to content')}
      </a>
      <header className="border-b border-border/60">
        <nav aria-label={t('nav.main')} className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            {t('Pricing')}
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <AuthLanguage />
            <Link href="/login" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
              {t('Sign in')}
            </Link>
            <Link href="/signup" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {t('Start free')}
            </Link>
          </div>
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>{t('© {year} Sampledge. DealFlow is a product of Sampledge.', { year: new Date().getFullYear() })}</span>
          <Link href="/pricing" className="hover:text-foreground">
            {t('Pricing')}
          </Link>
          <Link href="/login" className="hover:text-foreground">
            {t('Sign in')}
          </Link>
          <Link href="/extension-privacy" className="hover:text-foreground">
            {t('Browser extension privacy')}
          </Link>
        </div>
      </footer>
    </div>
  );
}
