import { cn } from '@dealflow/ui';

const SIZES = { sm: 'size-7 rounded-lg text-[11px]', md: 'size-10 rounded-xl text-sm', lg: 'size-16 rounded-2xl text-lg' } as const;

/** A client's logo, or its initials on the palette gradient when it has none (ADR 0074, C4). */
export function ClientAvatar({ name, logoUrl, size = 'md', className }: { name: string; logoUrl: string | null; size?: keyof typeof SIZES; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- an authenticated API image, not a static asset
    <img src={logoUrl} alt="" className={cn('shrink-0 border border-border bg-white object-contain', SIZES[size], className)} data-client-logo />
  ) : (
    <span aria-hidden className={cn('grid shrink-0 place-items-center bg-gradient-to-br from-primary/25 to-accent/25 font-semibold text-primary', SIZES[size], className)}>
      {initials}
    </span>
  );
}
