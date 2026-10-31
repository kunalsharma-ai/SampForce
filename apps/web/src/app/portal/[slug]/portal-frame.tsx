'use client';

import type { PortalBranding } from '@dealflow/types';

/** The customer-facing frame: the seller's logo, name and colour. Nothing from DealFlow's own app shell. */
export function PortalFrame({ branding, missing, right, children }: { branding: PortalBranding | null; missing?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  if (missing)
    return (
      <main className="mx-auto min-h-screen max-w-xl bg-background px-4 py-16">
        <h1 className="text-xl font-semibold">Portal not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">This portal does not exist or has been switched off. Check the address with your account manager.</p>
      </main>
    );
  return (
    <div className="min-h-screen bg-background" style={branding?.brandColor ? ({ '--portal-accent': branding.brandColor } as React.CSSProperties) : undefined}>
      <header className="border-b-4 bg-surface" style={{ borderColor: 'var(--portal-accent, hsl(var(--primary)))' }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-4">
          {branding?.logoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- the seller's stored logo as a data URL
            <img src={branding.logoDataUrl} alt={`${branding.seller} logo`} className="h-9 max-w-40 object-contain" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{branding?.title ?? 'Client portal'}</p>
            {branding && <p className="text-xs text-muted-foreground">{branding.seller}</p>}
          </div>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
