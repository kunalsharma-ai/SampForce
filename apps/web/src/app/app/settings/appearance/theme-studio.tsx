'use client';

import {
  type Appearance,
  contrastReport,
  DEFAULT_APPEARANCE,
  getTheme,
  resolveTheme,
  type ThemeId,
  THEMES,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input } from '@dealflow/ui';
import { Check, CircleAlert, KanbanSquare, LayoutDashboard, Mail, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RangeField, Segmented } from '@/components/forms/segmented';
import { PageHeader } from '@/components/page-header';
import { computePaint, isDarkMode, previewStyle } from '@/lib/appearance-engine';
import {
  useDeleteTheme,
  usePreferencesQuery,
  useResetAppearance,
  useSavedThemes,
  useSaveTheme,
  useSyncState,
  useWorkspaceDefault,
} from '@/lib/appearance-sync';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { usePreferences } from '@/stores/preferences';

const MODE_NAMES: Record<Appearance['mode'], MessageKey> = { light: 'Light', dark: 'Dark', system: 'Automatic' };

const same = (a: Appearance, b: Appearance) => JSON.stringify(a) === JSON.stringify(b);

function useSystemDark() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(m.matches);
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark;
}

/**
 * Theme Studio (design spec Part 2): every theme engine setting with a live preview, a contrast report, named saved
 * themes and the workspace default. Edits stay in a draft until Apply, which saves them to the person's account.
 */
export function ThemeStudio() {
  const t = useT();
  const applied = usePreferences((s) => s.appearance);
  const update = usePreferences((s) => s.update);
  const brandColor = usePreferences((s) => s.brandColor);
  const [draft, setDraft] = useState<Appearance>(applied);
  const systemDark = useSystemDark();
  const sync = useSyncState();
  const prefs = usePreferencesQuery();
  const reset = useResetAppearance();
  const canManageWorkspace = useCan('tenant:manage');

  // A change applied elsewhere (the top bar switcher, another tab) refreshes an untouched draft.
  const [base, setBase] = useState(applied);
  useEffect(() => {
    if (!same(applied, base)) {
      setBase(applied);
      setDraft((d) => (same(d, base) ? applied : d));
    }
  }, [applied, base]);

  const set = (patch: Partial<Appearance>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = !same(draft, applied);
  const dark = isDarkMode(draft.mode, systemDark);
  const paint = useMemo(() => computePaint(draft, brandColor), [draft, brandColor]);
  const resolved = useMemo(() => resolveTheme(draft, dark ? 'dark' : 'light', { brandColor }), [draft, dark, brandColor]);
  const checks = contrastReport(resolved);
  const theme = getTheme(draft.themeId);
  const hasWorkspaceDefault = !!prefs.data?.workspaceDefault;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Theme Studio"
        description="Choose a theme and tune colours, density, effects and motion. Changes show in the preview first and are saved to your account when you apply them, so they follow you to every device."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="text-xs text-muted-foreground">
              {changed ? t('Unapplied changes') : sync === 'saving' ? t('Saving…') : sync === 'error' ? t('Could not save. Your change is kept on this device and will retry.') : sync === 'saved' ? t('Saved to your account') : ''}
            </span>
            <Button variant="outline" disabled={!changed} onClick={() => setDraft(applied)}>
              <X aria-hidden /> {t('Discard')}
            </Button>
            <Button disabled={!changed} onClick={() => update(draft)}>
              <Check aria-hidden /> {t('Apply')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-layout xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-layout">
          <Card>
            <CardHeader>
              <CardTitle>{t('Theme')}</CardTitle>
              <CardDescription>{t.maybe(theme.description)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset>
                <legend className="sr-only">{t('Theme')}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {THEMES.map((th) => {
                    const on = draft.themeId === th.id;
                    const p = th[dark ? 'dark' : 'light'];
                    return (
                      <label
                        key={th.id}
                        className={cn(
                          'cursor-pointer rounded-lg border p-2 text-xs transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          on ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted',
                        )}
                      >
                        <input type="radio" name="theme" value={th.id} checked={on} onChange={() => set({ themeId: th.id as ThemeId })} className="sr-only" />
                        <span aria-hidden className="mb-2 flex h-10 overflow-hidden rounded-md border border-border" style={{ background: p.background }}>
                          <span className="m-1.5 w-1/3 rounded" style={{ background: p.surface }} />
                          <span className="my-1.5 flex flex-1 flex-col justify-center gap-1 pe-1.5">
                            <span className="h-1.5 w-3/4 rounded-full" style={{ background: p.primary }} />
                            <span className="h-1.5 w-1/2 rounded-full" style={{ background: p.accent }} />
                            <span className="h-1.5 w-2/3 rounded-full" style={{ background: p.secondary }} />
                          </span>
                        </span>
                        <span className={cn('flex items-center gap-1', on && 'font-semibold')}>
                          {on && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
                          <span className="truncate">{th.name}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <Segmented
                legend={t('Mode')}
                name="mode"
                value={draft.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: 'light', label: t('Light') },
                  { value: 'dark', label: t('Dark') },
                  { value: 'system', label: t('Automatic'), hint: t('Follows your operating system') },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Colours')}</CardTitle>
              <CardDescription>
                {t('Leave a colour on the theme’s own, or pick yours. Colours that would be hard to read are adjusted automatically, and the report beside the preview says what changed.')}
                {brandColor && !draft.primary ? ` ${t('Your workspace brand colour is used as the primary colour.')}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <ColorField id="c-primary" label={t('Primary')} value={draft.primary} themeValue={theme[dark ? 'dark' : 'light'].primary} onChange={(primary) => set({ primary })} />
                <ColorField id="c-secondary" label={t('Secondary')} value={draft.secondary} themeValue={theme[dark ? 'dark' : 'light'].secondary} onChange={(secondary) => set({ secondary })} />
                <ColorField id="c-accent" label={t('Accent')} value={draft.accent} themeValue={theme[dark ? 'dark' : 'light'].accent} onChange={(accent) => set({ accent })} />
              </div>
              {draft.themeId === 'custom' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColorField id="c-bg-dark" label={t('Dark background')} value={draft.backgroundDark} themeValue={theme.dark.background} onChange={(backgroundDark) => set({ backgroundDark })} />
                  <ColorField id="c-bg-light" label={t('Light background')} value={draft.backgroundLight} themeValue={theme.light.background} onChange={(backgroundLight) => set({ backgroundLight })} />
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Segmented
                  legend={t('Background tone')}
                  name="tone"
                  value={draft.backgroundTone}
                  onChange={(backgroundTone) => set({ backgroundTone })}
                  options={[
                    { value: 'theme', label: t('Theme') },
                    { value: 'neutral', label: t('Neutral') },
                    { value: 'cool', label: t('Cool') },
                    { value: 'warm', label: t('Warm') },
                  ]}
                />
                <Segmented
                  legend={t('Surface intensity')}
                  name="surface"
                  value={draft.surfaceIntensity}
                  onChange={(surfaceIntensity) => set({ surfaceIntensity })}
                  options={[
                    { value: 'subtle', label: t('Subtle') },
                    { value: 'standard', label: t('Standard') },
                    { value: 'strong', label: t('Strong') },
                  ]}
                />
                <Segmented
                  legend={t('Chart colours')}
                  name="chart"
                  value={draft.chartPalette}
                  onChange={(chartPalette) => set({ chartPalette })}
                  options={[
                    { value: 'theme', label: t('Theme') },
                    { value: 'vivid', label: t('Vivid') },
                    { value: 'calm', label: t('Calm') },
                    { value: 'colorblind', label: t('Colour-blind safe') },
                  ]}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Layout')}</CardTitle>
              <CardDescription>{t('Density changes control heights, card padding and table rows everywhere. Ultra compact keeps every control at least 24 pixels.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Segmented
                legend={t('Interface density')}
                name="density"
                value={draft.density}
                onChange={(density) => set({ density })}
                options={[
                  { value: 'comfortable', label: t('Comfortable') },
                  { value: 'balanced', label: t('Balanced') },
                  { value: 'compact', label: t('Compact') },
                  { value: 'ultra', label: t('Ultra compact') },
                ]}
              />
              <Segmented
                legend={t('Text size')}
                name="font"
                value={draft.fontScale}
                onChange={(fontScale) => set({ fontScale })}
                description={t('Applies to the whole app when you press Apply.')}
                options={[
                  { value: 'small', label: t('Small') },
                  { value: 'default', label: t('Default') },
                  { value: 'large', label: t('Large') },
                  { value: 'larger', label: t('Larger') },
                ]}
              />
              <RangeField id="radius" label={t('Corner radius')} value={draft.radius} min={0} max={20} unit=" px" onChange={(radius) => set({ radius })} />
              <Segmented
                legend={t('Sidebar')}
                name="sidebar"
                value={draft.sidebarStyle}
                onChange={(sidebarStyle) => set({ sidebarStyle })}
                options={[
                  { value: 'glass', label: t('Glass') },
                  { value: 'solid', label: t('Solid') },
                  { value: 'tinted', label: t('Tinted') },
                ]}
              />
              <Segmented
                legend={t('Cards')}
                name="cards"
                value={draft.cardStyle}
                onChange={(cardStyle) => set({ cardStyle })}
                options={[
                  { value: 'outlined', label: t('Outlined') },
                  { value: 'flat', label: t('Flat') },
                  { value: 'elevated', label: t('Elevated') },
                ]}
              />
              <Segmented
                legend={t('Icons')}
                name="icons"
                value={draft.iconStyle}
                onChange={(iconStyle) => set({ iconStyle })}
                options={[
                  { value: 'thin', label: t('Thin') },
                  { value: 'regular', label: t('Regular') },
                  { value: 'bold', label: t('Bold') },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Effects and motion')}</CardTitle>
              <CardDescription>{t('Glass applies to menus, the command palette, Copilot and the sidebar only. Forms and tables always stay opaque.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Segmented
                legend={t('Shadows')}
                name="shadow"
                value={draft.shadow}
                onChange={(shadow) => set({ shadow })}
                options={[
                  { value: 'none', label: t('None') },
                  { value: 'soft', label: t('Soft') },
                  { value: 'medium', label: t('Medium') },
                  { value: 'strong', label: t('Strong') },
                ]}
              />
              <RangeField id="glass" label={t('Glass effect')} value={draft.glass} min={0} max={100} step={5} unit="%" onChange={(glass) => set({ glass })} />
              <Segmented
                legend={t('Workspace background')}
                name="background"
                value={draft.background}
                onChange={(background) => set({ background })}
                options={[
                  { value: 'ambient', label: t('Ambient') },
                  { value: 'gradient', label: t('Gradient') },
                  { value: 'plain', label: t('Plain') },
                ]}
              />
              <Segmented
                legend={t('Motion')}
                name="motion"
                value={draft.motion}
                onChange={(motion) => set({ motion })}
                description={t('Balanced follows your operating system’s reduce-motion setting.')}
                options={[
                  { value: 'full', label: t('Full'), hint: t('All transitions, counters and ambient drift') },
                  { value: 'balanced', label: t('Balanced'), hint: t('Interface transitions and counters, no ambient drift') },
                  { value: 'minimal', label: t('Minimal'), hint: t('Essential fades only') },
                  { value: 'off', label: t('Off'), hint: t('No animation') },
                ]}
              />
              <label className="flex items-start gap-3 text-sm md:col-span-2">
                <input type="checkbox" checked={draft.lowPower} onChange={(e) => set({ lowPower: e.target.checked })} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
                <span>
                  <span className="block font-medium">{t('Low-power mode')}</span>
                  <span className="text-muted-foreground">{t('Removes the ambient background and shows 3D reports in 2D, to save battery and GPU.')}</span>
                </span>
              </label>
            </CardContent>
          </Card>

          <SavedThemes draft={draft} onUse={(s) => setDraft(s)} />

          <Card>
            <CardHeader>
              <CardTitle>{t('Defaults')}</CardTitle>
              <CardDescription>
                {prefs.data?.source === 'user'
                  ? hasWorkspaceDefault
                    ? t('You are using your own settings. Resetting returns you to the workspace default.')
                    : t('You are using your own settings. Resetting returns you to DealFlow’s default.')
                  : prefs.data?.source === 'workspace'
                    ? t('You are using the workspace default.')
                    : t('You are using DealFlow’s default.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={reset.isPending || prefs.data?.source !== 'user'} onClick={() => reset.mutate(undefined, { onSuccess: (r) => setDraft(r.appearance) })}>
                <RotateCcw aria-hidden /> {hasWorkspaceDefault ? t('Reset to the workspace default') : t('Reset to DealFlow’s default')}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(DEFAULT_APPEARANCE)}>
                {t('Load DealFlow’s default into the preview')}
              </Button>
            </CardContent>
            {canManageWorkspace && <WorkspaceDefault draft={draft} />}
          </Card>
        </div>

        <div className="space-y-layout xl:sticky xl:top-20 xl:self-start">
          <Preview paint={paint} dark={dark} />
          <Card>
            <CardHeader>
              <CardTitle>{t('Readability check')}</CardTitle>
              <CardDescription>{dark ? t('WCAG 2.2 AA contrast for the dark variant of this draft.') : t('WCAG 2.2 AA contrast for the light variant of this draft.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1 text-xs" aria-label={t('Contrast checks')}>
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    {c.passes ? <Check className="size-3.5 text-success" aria-hidden /> : <CircleAlert className="size-3.5 text-critical" aria-hidden />}
                    <span className="flex-1">{t.maybe(c.label)}</span>
                    <span className="tabular text-muted-foreground">
                      {c.passes ? t('{ratio}:1 pass', { ratio: c.ratio.toFixed(2) }) : t('{ratio}:1 fails (needs {required}:1)', { ratio: c.ratio.toFixed(2), required: c.required })}
                    </span>
                  </li>
                ))}
              </ul>
              {resolved.adjustments.length > 0 && (
                <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" aria-label={t('Automatic adjustments')}>
                  {resolved.adjustments.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ColorField({ id, label, value, themeValue, onChange }: { id: string; label: string; value: string | null; themeValue: string; onChange: (v: string | null) => void }) {
  const t = useT();
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const invalid = text !== '' && !/^#[0-9a-fA-F]{6}$/.test(text);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          aria-label={t('{name} colour picker', { name: label })}
          value={value ?? themeValue}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-control w-10 shrink-0 cursor-pointer rounded-md border border-input bg-surface p-1"
        />
        <Input
          id={id}
          value={text}
          placeholder={t('Theme ({value})', { value: themeValue })}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
            if (e.target.value === '') onChange(null);
          }}
        />
        {value && (
          <Button variant="ghost" size="icon" aria-label={t('Use the theme’s colour for {name}', { name: label })} onClick={() => onChange(null)}>
            <X aria-hidden />
          </Button>
        )}
      </div>
      {invalid && (
        <p id={`${id}-err`} className="text-xs text-critical">
          {t('Use a 6-digit hex colour such as #00D9FF.')}
        </p>
      )}
    </div>
  );
}

/** A miniature DealFlow screen painted with the draft's tokens, isolated from the rest of the page. */
function Preview({ paint, dark }: { paint: ReturnType<typeof computePaint>; dark: boolean }) {
  const t = useT();
  const bars = [62, 88, 45, 74, 54, 36];
  return (
    <section
      aria-label={t('Live preview')}
      data-testid="theme-preview"
      data-preview=""
      data-card={paint.attrs.card}
      data-sidebar={paint.attrs.sidebar}
      className={cn('overflow-hidden rounded-lg border border-border bg-background text-foreground', dark && 'dark')}
      style={previewStyle(paint, dark)}
    >
      <div className="flex">
        <nav aria-label={t('Preview navigation')} className="df-sidebar hidden w-32 shrink-0 space-y-1 border-e border-border p-2 text-xs sm:block">
          {[
            { icon: LayoutDashboard, label: t('Command') },
            { icon: Users, label: t('Leads') },
            { icon: KanbanSquare, label: t('Deals'), active: true },
            { icon: Mail, label: t('Inbox') },
          ].map((n) => (
            <span key={n.label} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1.5', n.active ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground')}>
              <n.icon className="size-3.5" aria-hidden /> {n.label}
            </span>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('Pipeline')}</p>
            <Badge className="text-[10px]">
              {t('Sample figures')}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              [t('Pipeline value'), '$248.5K'],
              [t('Deals won'), '42'],
            ].map(([k, v]) => (
              <div key={k} className="df-card rounded-lg border border-border bg-surface p-2">
                <p className="text-[11px] text-muted-foreground">{k}</p>
                <p className="tabular text-base font-semibold">{v}</p>
              </div>
            ))}
          </div>
          <div className="df-card rounded-lg border border-border bg-surface p-2">
            <div aria-hidden className="flex h-16 items-end gap-1.5">
              {bars.map((h, i) => (
                <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `hsl(var(--chart-${i + 1}))` }} />
              ))}
            </div>
            <table className="mt-2 w-full text-start text-[11px]">
              <caption className="sr-only">{t('Sample deals')}</caption>
              <thead className="text-muted-foreground">
                <tr>
                  <th className="font-medium">{t('Deal')}</th>
                  <th className="font-medium">{t('Stage')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td>{t('Enterprise expansion')}</td>
                  <td className="text-success">{t('Won')}</td>
                </tr>
                <tr className="border-t border-border">
                  <td>{t('Global research')}</td>
                  <td className="text-warning">{t('At risk')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-1">
            <label htmlFor="preview-field" className="text-[11px] font-medium">
              {t('Client')}
            </label>
            <Input id="preview-field" defaultValue="Northwind Research" className="text-xs" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm">{t('Create bid')}</Button>
            <Button size="sm" variant="outline">
              {t('Preview')}
            </Button>
            <span className="inline-flex items-center rounded-md bg-accent px-2 text-[11px] font-medium text-accent-foreground">{t('AI suggestion')}</span>
            <span className="inline-flex items-center rounded-md bg-secondary px-2 text-[11px] font-medium text-secondary-foreground">{t('Secondary')}</span>
          </div>
          <p className="text-[11px] text-critical">{t('Error text looks like this.')}</p>
        </div>
      </div>
    </section>
  );
}

function SavedThemes({ draft, onUse }: { draft: Appearance; onUse: (a: Appearance) => void }) {
  const t = useT();
  const themes = useSavedThemes();
  const save = useSaveTheme();
  const del = useDeleteTheme();
  const [name, setName] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Saved themes')}</CardTitle>
        <CardDescription>{t('Save the current draft under a name to switch back to it later. Saving under an existing name updates it.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate({ name: name.trim(), settings: draft }, { onSuccess: () => setName('') });
          }}
        >
          <div className="min-w-48 flex-1 space-y-1.5">
            <label htmlFor="theme-name" className="text-sm font-medium">
              {t('Name')}
            </label>
            <Input id="theme-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('For example: Board review')} />
          </div>
          <Button type="submit" variant="outline" disabled={!name.trim() || save.isPending}>
            {t('Save draft as theme')}
          </Button>
        </form>
        {save.error && (
          <p role="alert" className="text-sm text-critical">
            {save.error.message}
          </p>
        )}
        {themes.data && themes.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('Your saved themes')}>
            {themes.data.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span aria-hidden className="flex overflow-hidden rounded-full border border-border">
                  <span className="size-3" style={{ background: s.settings.primary ?? getTheme(s.settings.themeId).dark.primary }} />
                  <span className="size-3" style={{ background: s.settings.accent ?? getTheme(s.settings.themeId).dark.accent }} />
                </span>
                <span className="flex-1 truncate">
                  {s.name} <span className="text-xs text-muted-foreground">· {getTheme(s.settings.themeId).name}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => onUse(s.settings)}>
                  {t('Preview')}
                </Button>
                <Button size="sm" variant="ghost" aria-label={t('Delete {name}', { name: s.name })} disabled={del.isPending} onClick={() => del.mutate(s.id)}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          themes.isSuccess && <p className="text-sm text-muted-foreground">{t('No saved themes yet.')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function WorkspaceDefault({ draft }: { draft: Appearance }) {
  const t = useT();
  const prefs = usePreferencesQuery();
  const ws = useWorkspaceDefault();
  const current = prefs.data?.workspaceDefault;
  return (
    <CardContent className="space-y-2 border-t border-border pt-card">
      <p className="text-sm font-medium">{t('Workspace default')}</p>
      <p className="text-sm text-muted-foreground">
        {current
          ? t('Members who have not chosen their own settings see {theme} ({mode}).', { theme: getTheme(current.themeId).name, mode: t(MODE_NAMES[current.mode]).toLowerCase() })
          : t('No workspace default. Members who have not chosen their own settings see DealFlow’s default.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={ws.isPending} onClick={() => ws.mutate(draft)}>
          {t('Use this draft as the workspace default')}
        </Button>
        {current && (
          <Button variant="ghost" disabled={ws.isPending} onClick={() => ws.mutate(null)}>
            {t('Remove workspace default')}
          </Button>
        )}
      </div>
      {ws.error && (
        <p role="alert" className="text-sm text-critical">
          {ws.error.message}
        </p>
      )}
    </CardContent>
  );
}
