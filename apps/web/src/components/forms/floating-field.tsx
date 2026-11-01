'use client';

import { cn } from '@dealflow/ui';
import * as React from 'react';
import { Tr } from '@/lib/i18n';

/**
 * Field with a floating label: the label sits inside the input like a placeholder and moves up when the input has
 * focus or a value. It is a real <label>, so it is always announced, and it never disappears the way a placeholder
 * does. Same contract as Field: the child input receives id, aria-invalid and aria-describedby.
 */
export function FloatingField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactElement<{ id?: string; className?: string; placeholder?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        {React.cloneElement(children, {
          id,
          placeholder: ' ',
          'aria-invalid': !!error,
          'aria-describedby': describedBy,
          className: cn(children.props.className, 'peer !h-12 px-3 pb-1.5 pt-5'),
        })}
        <label
          htmlFor={id}
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground transition-all duration-150 motion-reduce:transition-none peer-focus:top-3.5 peer-focus:text-xs peer-focus:text-foreground peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:text-xs peer-autofill:top-3.5 peer-autofill:text-xs"
        >
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-critical">
          {/* Schema messages ("Use at least 10 characters") are phrases; API messages pass through unchanged. */}
          <Tr text={error} />
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
