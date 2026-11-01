import { type Appearance, layoutVariables, resolveTheme, TOKEN_NAMES } from '@dealflow/types';

/** localStorage key for the last painted tokens, read by the pre-paint script in app/layout.tsx. */
export const PAINT_CACHE_KEY = 'dealflow:appearance-paint';

export interface Paint {
  mode: Appearance['mode'];
  dark: Record<string, string>;
  light: Record<string, string>;
  attrs: Record<string, string>;
}

/** Every CSS variable and data attribute the theme engine sets, for both colour modes. */
export function computePaint(a: Appearance, brandColor: string | null = null): Paint {
  const layout = layoutVariables(a);
  const forMode = (mode: 'dark' | 'light') => {
    const t = resolveTheme(a, mode, { brandColor });
    return { ...Object.fromEntries(TOKEN_NAMES.map((k) => [`--${k}`, t.css[k]])), ...layout };
  };
  return {
    mode: a.mode,
    dark: forMode('dark'),
    light: forMode('light'),
    attrs: {
      theme: a.themeId,
      motion: a.motion,
      density: a.density,
      card: a.cardStyle,
      sidebar: a.sidebarStyle,
      background: a.background,
      lowPower: String(a.lowPower),
    },
  };
}

export function isDarkMode(mode: Appearance['mode'], systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

/** Paints the variables onto an element (the document root, or a preview container). */
export function applyPaint(el: HTMLElement, paint: Paint, dark: boolean): void {
  el.classList.toggle('dark', dark);
  const vars = dark ? paint.dark : paint.light;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  for (const [k, v] of Object.entries(paint.attrs)) el.dataset[k] = v;
}

/** Inline style for a scoped live preview (the Theme Studio), without touching the page. */
export function previewStyle(paint: Paint, dark: boolean): React.CSSProperties {
  return (dark ? paint.dark : paint.light) as React.CSSProperties;
}
