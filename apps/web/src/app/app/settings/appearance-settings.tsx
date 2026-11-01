'use client';

import { getTheme } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { Palette } from 'lucide-react';
import Link from 'next/link';
import { Segmented } from '@/components/forms/segmented';
import { usePreferences } from '@/stores/preferences';

/** Quick appearance settings on the Settings page; the Theme Studio has everything else. */
export function AppearanceSettings() {
  const appearance = usePreferences((s) => s.appearance);
  const update = usePreferences((s) => s.update);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance &amp; motion</CardTitle>
        <CardDescription>
          Theme: {getTheme(appearance.themeId).name}. Saved to your account, so it follows you to every device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Segmented
          legend="Mode"
          name="quick-mode"
          value={appearance.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'Automatic' },
          ]}
        />
        <Segmented
          legend="Motion"
          name="quick-motion"
          value={appearance.motion}
          onChange={(motion) => update({ motion })}
          options={[
            { value: 'full', label: 'Full' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'minimal', label: 'Minimal' },
            { value: 'off', label: 'Off' },
          ]}
        />
        <Segmented
          legend="Interface density"
          name="quick-density"
          value={appearance.density}
          onChange={(density) => update({ density })}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'compact', label: 'Compact' },
            { value: 'ultra', label: 'Ultra compact' },
          ]}
        />
        <Button asChild variant="outline">
          <Link href="/app/settings/appearance">
            <Palette aria-hidden /> Open Theme Studio
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
