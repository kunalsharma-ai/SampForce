/** DealFlow Tailwind preset. Colours resolve to CSS variables defined in src/tokens.css. */
const token = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1440px' } },
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        surface: { DEFAULT: token('surface'), raised: token('surface-raised') },
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        info: token('info'),
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        success: token('success'),
        warning: token('warning'),
        critical: { DEFAULT: token('critical'), foreground: token('critical-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
      },
      height: { control: 'var(--control-h)', 'control-sm': 'var(--control-h-sm)' },
      width: { control: 'var(--control-h)' },
      padding: { card: 'var(--card-pad)' },
      gap: { layout: 'var(--layout-gap)' },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px hsl(var(--primary) / 0.25), 0 8px 32px -8px hsl(var(--primary) / 0.35)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        drift: { '0%,100%': { transform: 'translate3d(0,0,0)' }, '50%': { transform: 'translate3d(2%, -3%, 0)' } },
      },
      animation: { 'fade-up': 'fade-up 300ms ease-out both', drift: 'drift 24s ease-in-out infinite' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
