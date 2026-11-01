import { FORMAT_LOCALES, LANGUAGES } from '@dealflow/types';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { formatKpi, relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/** Tokens and localisation. Colours come from the theme engine; switch the toolbar to see each theme and mode. */
const meta: Meta = { title: 'Design system/Foundations' };
export default meta;
type Story = StoryObj;

const TOKENS = ['background', 'surface', 'surface-raised', 'muted', 'border', 'foreground', 'muted-foreground', 'primary', 'accent', 'success', 'warning', 'critical', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];

export const ColourTokens: Story = {
  render: () => (
    <ul className="grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {TOKENS.map((t) => (
        <li key={t} className="overflow-hidden rounded-lg border border-border">
          <span className="block h-14" style={{ background: `hsl(var(--${t}))` }} />
          <code className="block px-2 py-1.5 text-xs">--{t}</code>
        </li>
      ))}
    </ul>
  ),
};

export const Typography: Story = {
  render: () => (
    <div className="max-w-2xl space-y-3">
      <p className="text-3xl font-semibold tracking-tight">Revenue, at a glance</p>
      <p className="text-xl font-semibold">Pipeline health</p>
      <p className="text-base">Body text is Inter at the person’s chosen font scale.</p>
      <p className="text-sm text-muted-foreground">Muted text for descriptions and hints keeps 4.5:1 contrast in every theme.</p>
      <p className="tabular-nums">1,234,567.89 · 98.6%</p>
    </div>
  ),
};

/** Shell text in the toolbar language, and the same values written in each format locale. */
export const Localisation: Story = {
  render: function Render() {
    const t = useT();
    const now = Date.parse('2026-11-01T12:00:00Z');
    return (
      <div className="max-w-4xl space-y-6">
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">
            {LANGUAGES.find((l) => l.code === t.language)?.name} · <span dir="ltr">{t.dir}</span>
          </h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(['module.home', 'module.deals', 'module.quotes', 'top.quickCreate', 'nav.favourites', 'top.signOut'] as const).map((k) => (
              <li key={k} className="rounded-md border border-border px-2 py-1">
                {t(k)}
              </li>
            ))}
            <li className="rounded-md border border-border px-2 py-1">{t.plural('regional.days', 3)}</li>
          </ul>
        </section>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs text-muted-foreground">
              <th className="py-1 text-start font-medium">Locale</th>
              <th className="py-1 text-end font-medium">Money</th>
              <th className="py-1 text-end font-medium">Percent</th>
              <th className="py-1 text-end font-medium">Relative</th>
            </tr>
          </thead>
          <tbody>
            {FORMAT_LOCALES.slice(0, 12).map((l) => (
              <tr key={l} className="border-t border-border">
                <td className="py-1.5 font-mono text-xs">{l}</td>
                <td className="py-1.5 text-end tabular-nums">{formatKpi(1234567, 'currency', 'EUR', l)}</td>
                <td className="py-1.5 text-end tabular-nums">{formatKpi(0.274, 'percent', 'EUR', l)}</td>
                <td className="py-1.5 text-end">{relativeTime('2026-10-29T12:00:00Z', now, l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
};
