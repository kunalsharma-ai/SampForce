'use client';

import { Button, Input } from '@dealflow/ui';
import { bidAccentSchema } from '@dealflow/types';
import { useEffect, useId, useState } from 'react';

/**
 * Accent colour for a bid: a colour well plus a hex field. The hex field keeps what the person typed
 * and reports an error until it is a valid #rrggbb; only valid colours reach onChange.
 */
export function AccentPicker({
  value,
  templateAccent,
  onChange,
  disabled,
}: {
  /** The override, or null to use the template's accent. */
  value: string | null;
  templateAccent: string;
  onChange: (accent: string | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const effective = value ?? templateAccent;
  const [text, setText] = useState(effective);
  useEffect(() => setText(effective), [effective]);
  const valid = bidAccentSchema.safeParse(text).success;
  const set = (hex: string) => onChange(hex.toLowerCase() === templateAccent.toLowerCase() ? null : hex.toLowerCase());
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-hex`} className="text-sm font-medium">
        Accent colour
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label="Pick accent colour"
          value={valid ? text : effective}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background p-1 disabled:cursor-not-allowed"
        />
        <Input
          id={`${id}-hex`}
          value={text}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby={`${id}-hint`}
          className="h-9 w-28 font-mono text-sm"
          onChange={(e) => {
            setText(e.target.value);
            if (bidAccentSchema.safeParse(e.target.value).success) set(e.target.value);
          }}
        />
        {value && (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            Use template colour
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className={valid ? 'text-xs text-muted-foreground' : 'text-xs text-critical'} role={valid ? undefined : 'alert'}>
        {valid ? 'Used for bands, rules and the total. Text keeps the theme colours so it stays readable.' : 'Use a hex colour such as #2563eb.'}
      </p>
    </div>
  );
}
