'use client';

import { cn } from '@dealflow/ui';
import { useId } from 'react';

/** Accessible tab strip; panels render below with matching ids. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void; label: string }) {
  const base = useId();
  return (
    <div role="tablist" aria-label={label} className="mb-4 inline-flex rounded-lg border border-border bg-muted/40 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={`${base}-${t.key}`}
          aria-selected={value === t.key}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', value === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Label + control + optional hint/error, matching the CRM forms. */
export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorText({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-critical">
      {error.message}
    </p>
  );
}
