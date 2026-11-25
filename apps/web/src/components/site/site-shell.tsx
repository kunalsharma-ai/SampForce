'use client';

import { LifeBuoy, Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthLanguage } from '@/components/auth-language';
import { Logo } from '@/components/logo';
import { useT } from '@/lib/i18n';
import { AccessPortal } from './access-portal';
import { AuroraCanvas } from './aurora-canvas';
import { faceFromHash, PORTAL_HASH, type PortalFace, SiteContext } from './site-context';
import { HelpOrb, HelpPanel } from './site-help';
import { SiteThemeToggle, useSiteTheme } from './site-theme';
import './site.css';

/** A plain click opens the portal; a click with a modifier key (new tab, new window) follows the link as usual. */
function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * The public website's frame (ADR 0078): the Aurora sky, a floating glass header with the light/dark switch, the
 * sign-in and sign-up portal, and Help & Support on every page. No tracking scripts, no third-party embeds.
 */
export function SiteShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const theme = useSiteTheme();
  const [face, setFace] = useState<PortalFace | null>(null);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);

  // #sign-in and #start open the portal, so the links can be shared; Back closes it.
  useEffect(() => {
    const sync = () => setFace(faceFromHash(window.location.hash));
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const openPortal = useCallback((f: PortalFace) => {
    setMenu(false);
    setHelp(false);
    setFace(f);
    const hash = PORTAL_HASH[f];
    if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash);
  }, []);
  const switchFace = useCallback((f: PortalFace) => {
    setFace(f);
    window.history.replaceState(window.history.state, '', PORTAL_HASH[f]);
  }, []);
  const closePortal = useCallback(() => {
    setFace(null);
    if (faceFromHash(window.location.hash)) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);
  const openHelp = useCallback(() => {
    setMenu(false);
    setHelp(true);
  }, []);
  const ctx = useMemo(() => ({ mode: theme.mode, openPortal, openHelp }), [theme.mode, openPortal, openHelp]);

  const signIn = (e: MouseEvent) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    openPortal('sign-in');
  };
  const start = (e: MouseEvent) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    openPortal('start');
  };

  const links = [
    { href: '/#features', label: t('Product') },
    { href: '/#flow', label: t('How it works') },
    { href: '/pricing', label: t('Pricing') },
  ];

  return (
    <SiteContext.Provider value={ctx}>
      <div className="sfx-root relative isolate flex min-h-screen flex-col overflow-x-clip" {...theme.attrs} data-site-root="">
        <AuroraCanvas mode={theme.mode} />
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
          {t('Skip to content')}
        </a>
        <header className="sticky top-3 z-30 px-3 sm:top-4 sm:px-6">
          <motion.nav
            aria-label={t('nav.main')}
            initial={{ y: -40 }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', stiffness: 140, damping: 18 }}
            className="sfx-nav mx-auto flex max-w-6xl items-center gap-2 rounded-full border border-border/70 py-2 pe-2 ps-4 sm:gap-4"
          >
            <Link href="/" className="shrink-0 rounded-full">
              <Logo animated />
            </Link>
            <div className="ms-2 hidden items-center md:flex">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="sfx-nav-link rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
              <div className="hidden md:block">
                <AuthLanguage />
              </div>
              <SiteThemeToggle mode={theme.mode} onChange={theme.setMode} />
              <a href="/login" onClick={signIn} className="hidden rounded-full px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted sm:block" data-site-sign-in="">
                {t('Sign in')}
              </a>
              <a href="/signup" onClick={start} className="sfx-cta hidden px-4 py-2 text-sm font-bold sm:block" data-site-start="">
                {t('Start free')}
              </a>
              <button type="button" className="grid size-10 place-items-center rounded-full border border-border md:hidden" aria-expanded={menu} aria-controls="site-menu" onClick={() => setMenu((m) => !m)}>
                {menu ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
                <span className="sr-only">{t('Menu')}</span>
              </button>
            </div>
          </motion.nav>
          <AnimatePresence>
            {menu && (
              <motion.div
                id="site-menu"
                initial={{ y: -12, scale: 0.96 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: -12, scale: 0.96 }}
                className="sfx-nav mx-auto mt-2 max-w-6xl rounded-3xl border border-border/70 p-3 md:hidden"
              >
                {links.map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className="block rounded-2xl px-4 py-3 font-medium hover:bg-muted">
                    {l.label}
                  </Link>
                ))}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a href="/login" onClick={signIn} className="rounded-full border border-border py-3 text-center text-sm font-semibold">
                    {t('Sign in')}
                  </a>
                  <a href="/signup" onClick={start} className="sfx-cta py-3 text-center text-sm font-bold">
                    {t('Start free')}
                  </a>
                </div>
                <div className="mt-3 px-2">
                  <AuthLanguage />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="relative mt-10 border-t border-border/60 bg-surface/40 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-8 text-sm text-muted-foreground sm:px-6">
            <Logo />
            <span className="text-xs">{t('© {year} Sampledge. SampForce is a product of Sampledge.', { year: new Date().getFullYear() })}</span>
            <nav aria-label={t('Footer')} className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ms-auto">
              <Link href="/pricing" className="hover:text-foreground">
                {t('Pricing')}
              </Link>
              <a href="/login" onClick={signIn} className="hover:text-foreground">
                {t('Sign in')}
              </a>
              <button type="button" onClick={openHelp} className="flex items-center gap-1 hover:text-foreground">
                <LifeBuoy className="size-3.5" aria-hidden /> {t('Help & Support')}
              </button>
              <Link href="/extension-privacy" className="hover:text-foreground">
                {t('Browser extension privacy')}
              </Link>
              <Link href="/app-privacy" className="hover:text-foreground">
                {t('Mobile app privacy')}
              </Link>
            </nav>
          </div>
        </footer>
        <HelpOrb />
        <HelpPanel open={help} onOpenChange={setHelp} />
        <AccessPortal face={face} onFace={switchFace} onClose={closePortal} />
      </div>
    </SiteContext.Provider>
  );
}
