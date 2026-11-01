import '../src/app/globals.css';
import { DEFAULT_APPEARANCE, LANGUAGES, languageDir, THEME_IDS } from '@dealflow/types';
import { DirectionProvider, TooltipProvider } from '@dealflow/ui';
import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { applyPaint, computePaint } from '../src/lib/appearance-engine';
import { useRegional } from '../src/stores/regional';

/**
 * Every story is painted by the same theme engine the app uses (lib/appearance-engine.ts), so what you see here is
 * what ships. The toolbar picks the theme, light or dark, and the language (which also sets the reading direction).
 */
const withAppearance: Decorator = (Story, ctx) => {
  const { theme, mode, language } = ctx.globals as { theme: (typeof THEME_IDS)[number]; mode: 'light' | 'dark'; language: (typeof LANGUAGES)[number]['code'] };
  const dir = languageDir(language);
  useEffect(() => {
    const root = document.documentElement;
    const paint = computePaint({ ...DEFAULT_APPEARANCE, themeId: theme, mode, motion: 'minimal' });
    applyPaint(root, paint, mode === 'dark');
    root.lang = language;
    root.dir = dir;
    useRegional.getState().adopt({ language, formatLocale: null });
  }, [theme, mode, language, dir]);
  return (
    <DirectionProvider dir={dir}>
      <TooltipProvider delayDuration={100}>
        <div dir={dir} lang={language} className="bg-background p-6 text-foreground">
          <Story />
        </div>
      </TooltipProvider>
    </DirectionProvider>
  );
};

const preview: Preview = {
  decorators: [withAppearance],
  globalTypes: {
    theme: {
      description: 'Theme engine preset',
      toolbar: { title: 'Theme', icon: 'paintbrush', items: THEME_IDS.map((id) => ({ value: id, title: id })), dynamicTitle: true },
    },
    mode: {
      description: 'Light or dark',
      toolbar: { title: 'Mode', icon: 'mirror', items: [{ value: 'dark', title: 'Dark' }, { value: 'light', title: 'Light' }], dynamicTitle: true },
    },
    language: {
      description: 'Language and reading direction',
      toolbar: { title: 'Language', icon: 'globe', items: LANGUAGES.map((l) => ({ value: l.code, title: `${l.english}${l.dir === 'rtl' ? ' (RTL)' : ''}` })), dynamicTitle: true },
    },
  },
  initialGlobals: { theme: DEFAULT_APPEARANCE.themeId, mode: 'dark', language: 'en' },
  parameters: {
    layout: 'fullscreen',
    controls: { matchers: { color: /(background|color|accent)$/i } },
    // Same WCAG tags as the Playwright axe checks; violations fail the a11y panel.
    a11y: { options: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }, test: 'error' },
  },
};

export default preview;
