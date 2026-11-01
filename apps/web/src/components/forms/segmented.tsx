'use client';

import { cn } from '@dealflow/ui';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * A row of mutually exclusive choices built on native radio inputs, so arrow keys, screen readers and form semantics
 * work without extra code. The selected option is marked by weight and an outline as well as colour.
 */
export function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  description,
}: {
  legend: string;
  name: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  description?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label
              key={o.value}
              title={o.hint}
              className={cn(
                'flex min-h-control-sm flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                on ? 'bg-surface font-semibold text-foreground shadow-sm ring-1 ring-primary/60' : 'text-muted-foreground hover:bg-surface/70 hover:text-foreground',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A labelled range slider that shows its value next to the label. */
export function RangeField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <output htmlFor={id} className="tabular text-xs text-muted-foreground">
          {value}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[hsl(var(--primary))]"
      />
    </div>
  );
}
