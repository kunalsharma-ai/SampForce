import { SiteShell } from '@/components/site/site-shell';

/** Public marketing pages: landing and pricing, in the website's Aurora look (ADR 0078). */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
