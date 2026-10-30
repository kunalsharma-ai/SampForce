'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@dealflow/ui';
import { type MotionPref, type ThemePref, usePreferences } from '@/stores/preferences';

function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-4">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'cursor-pointer rounded-md border border-border p-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              value === o.value ? 'border-primary bg-primary/10' : 'hover:bg-muted',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="block font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AppearanceSettings() {
  const { theme, motion, lowPower, setTheme, setMotion, setLowPower } = usePreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance &amp; motion</CardTitle>
        <CardDescription>Saved on this device and applied immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Choice<ThemePref>
          legend="Theme"
          name="theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'dark', label: 'Dark', hint: 'Signature' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
        <Choice<MotionPref>
          legend="Motion"
          name="motion"
          value={motion}
          onChange={setMotion}
          options={[
            { value: 'system', label: 'System', hint: 'Follow OS setting' },
            { value: 'full', label: 'Full' },
            { value: 'reduced', label: 'Reduced', hint: 'No counters or drift' },
            { value: 'off', label: 'Off', hint: 'No animation' },
          ]}
        />
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={lowPower}
            onChange={(e) => setLowPower(e.target.checked)}
            className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
          />
          <span>
            <span className="block font-medium">Low-power mode</span>
            <span className="text-muted-foreground">Turns off ambient background effects and, later, 3D scenes.</span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
