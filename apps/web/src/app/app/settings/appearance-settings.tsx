'use client';

import { getTheme } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { Palette } from 'lucide-react';
import Link from 'next/link';
import { Segmented } from '@/components/forms/segmented';
import { useT } from '@/lib/i18n';
import { usePreferences } from '@/stores/preferences';

/** Quick appearance settings on the Settings page; the Theme Studio has everything else. */
export function AppearanceSettings() {
  const t = useT();
  const appearance = usePreferences((s) => s.appearance);
  const update = usePreferences((s) => s.update);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Appearance & motion')}</CardTitle>
        <CardDescription>
          {t('Theme: {name}. Saved to your account, so it follows you to every device.', { name: getTheme(appearance.themeId).name })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Segmented
          legend={t('Mode')}
          name="quick-mode"
          value={appearance.mode}
          onChange={(mode) => update({ mode })}
          options={[
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
            { value: 'system', label: t('Automatic') },
          ]}
        />
        <Segmented
          legend={t('Motion')}
          name="quick-motion"
          value={appearance.motion}
          onChange={(motion) => update({ motion })}
          options={[
            { value: 'full', label: t('Full') },
            { value: 'balanced', label: t('Balanced') },
            { value: 'minimal', label: t('Minimal') },
            { value: 'off', label: t('Off') },
          ]}
        />
        <Segmented
          legend={t('Interface density')}
          name="quick-density"
          value={appearance.density}
          onChange={(density) => update({ density })}
          options={[
            { value: 'comfortable', label: t('Comfortable') },
            { value: 'balanced', label: t('Balanced') },
            { value: 'compact', label: t('Compact') },
            { value: 'ultra', label: t('Ultra compact') },
          ]}
        />
        <Button asChild variant="outline">
          <Link href="/app/settings/appearance">
            <Palette aria-hidden /> {t('Open Theme Studio')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
