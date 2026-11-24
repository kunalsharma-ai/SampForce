'use client';

import { cn, Input } from '@dealflow/ui';
import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/lib/i18n';

/** The eye beside a password: shows or hides what was typed. A real button, announced as "Show password". */
export function RevealButton({ shown, onToggle, className }: { shown: boolean; onToggle: () => void; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      title={shown ? t('Hide password') : t('Show password')}
      className={cn(
        'absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      data-reveal-password={shown ? 'shown' : 'hidden'}
    >
      {/* The name is the button's own text, not an aria-label, so "Password" still finds only the field. */}
      <span className="sr-only">{shown ? t('Hide password') : t('Show password')}</span>
      {shown ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
    </button>
  );
}

/**
 * A password field with the eye button. Takes the same props as Input (so Field can give it id and aria props) and
 * keeps the browser's password manager working: only the type changes while it is shown.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput(
  { className, ...props },
  ref,
) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={shown ? 'text' : 'password'} className={cn(className, 'pe-12')} />
      <RevealButton shown={shown} onToggle={() => setShown((v) => !v)} />
    </div>
  );
});
