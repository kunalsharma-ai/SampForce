import Link from 'next/link';
import { AmbientBackground } from '@/components/ambient-background';
import { Logo } from '@/components/logo';

/** Public marketing pages: landing and pricing. No tracking scripts, no third-party embeds. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <AmbientBackground />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-border/60">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4 sm:px-6">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/login" className="rounded-md px-3 py-2 text-sm hover:bg-muted">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Start free
            </Link>
          </div>
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} Sampledge. DealFlow is a product of Sampledge.</span>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/extension-privacy" className="hover:text-foreground">
            Browser extension privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
