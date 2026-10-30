import { cn } from '@dealflow/ui';

/** DealFlow mark: two interlocking flow curves forming a "D". Original artwork. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="df-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D9FF" />
          <stop offset="1" stopColor="#8057FF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#df-g)" opacity="0.16" />
      <path d="M9 7h7a9 9 0 0 1 0 18H9" fill="none" stroke="url(#df-g)" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 16h6.5" stroke="url(#df-g)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="9" cy="16" r="2.2" fill="#00D9FF" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-base font-semibold tracking-tight">DealFlow</span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">by Sampledge</span>
        </span>
      )}
    </span>
  );
}
