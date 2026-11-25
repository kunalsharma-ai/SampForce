'use client';

import { cn } from '@dealflow/ui';
import { LogoMark } from '@/components/logo';

/**
 * The SampForce logo as the website shows it (ADR 0078): the real bolt mark, larger, with "Samp" in the page's ink
 * and "Force" in the logo's red-to-amber with a shine. It strikes in on load, twinkles at rest and jolts on hover
 * (the shared logo animation, components/logo.css), and glows softly in dark mode.
 */
export function SiteLogo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('sfx-logo sf-logo-anim inline-flex items-center gap-2.5', className)} data-logo-animated="yes">
      <LogoMark className={cn('sfx-logo-glow', size === 'lg' ? 'size-12' : 'size-10')} />
      <span className="sf-word leading-none">
        <span className={cn('block font-extrabold tracking-tight', size === 'lg' ? 'text-2xl' : 'text-xl')} translate="no">
          <span className="sfx-logo-samp">Samp</span>
          <span className="sf-force">Force</span>
        </span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">by Sampledge</span>
      </span>
    </span>
  );
}
