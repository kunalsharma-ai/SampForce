'use client';

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@dealflow/ui';
import {
  CONSOLE_PALETTE_DEFS,
  type ConsolePreferences,
  type ConsolePreferencesUpdate,
  type OperatorMe,
} from '@dealflow/types';
import {
  ChevronRight,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Palette,
  Search,
  ShieldCheck,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Link from 'next/link';
import type { Crumb } from './console-nav';

export function ConsoleBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              key={`${c.href}-${i}`}
              className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex')}
            >
              {i > 0 && (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              )}
              {last ? (
                <span aria-current="page" className="truncate font-medium" data-crumb-current>
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const MODES = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

/** Palette and colour mode for the whole Console (ADR 0074); saved to the operator, so it follows them across devices. */
function AppearanceMenu({
  prefs,
  onChange,
}: {
  prefs: ConsolePreferences;
  onChange: (p: ConsolePreferencesUpdate) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Appearance">
          <Palette aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] p-4">
        <p className="text-sm font-medium">Appearance</p>
        <div
          role="radiogroup"
          aria-label="Colour mode"
          className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={prefs.mode === m.id}
              onClick={() => onChange({ mode: m.id })}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors',
                prefs.mode === m.id
                  ? 'bg-surface font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <m.icon className="size-3.5" aria-hidden />
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Palette
        </p>
        <div role="radiogroup" aria-label="Palette" className="mt-2 grid gap-1.5">
          {CONSOLE_PALETTE_DEFS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={prefs.palette === p.id}
              data-palette={p.id}
              onClick={() => onChange({ palette: p.id })}
              className={cn(
                'flex w-full min-w-0 items-center gap-3 rounded-lg border px-2.5 py-2 text-start transition-colors',
                prefs.palette === p.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-muted/60',
              )}
            >
              <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                {p.swatch.map((c) => (
                  <span
                    key={c}
                    className="size-5 rounded-full border-2 border-surface"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ConsoleTopBar({
  me,
  crumbs,
  onSearch,
  onMenu,
  onPreferences,
  onSignOut,
}: {
  me: OperatorMe;
  crumbs: Crumb[];
  onSearch: () => void;
  onMenu: () => void;
  onPreferences: (p: ConsolePreferencesUpdate) => void;
  onSignOut: () => void;
}) {
  const initials = me.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <header className="df-glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/70 px-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open the menu"
        onClick={onMenu}
      >
        <Menu aria-hidden />
      </Button>
      <ConsoleBreadcrumbs crumbs={crumbs} />
      <div className="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSearch}
          className="hidden h-9 w-72 items-center gap-2 rounded-lg border border-border bg-surface/70 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex"
          data-console-search
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-start">Search the Console</span>
          <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[11px]">
            Ctrl K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Search the Console"
          onClick={onSearch}
        >
          <Search aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={me.preferences.sound ? 'Sounds on' : 'Sounds off'}
          aria-pressed={me.preferences.sound}
          title={
            me.preferences.sound ? 'Sounds on: click to turn off' : 'Sounds off: click to turn on'
          }
          onClick={() => onPreferences({ sound: !me.preferences.sound })}
          data-console-sound={me.preferences.sound ? 'on' : 'off'}
        >
          {me.preferences.sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        </Button>
        <AppearanceMenu prefs={me.preferences} onChange={onPreferences} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ms-1 flex items-center gap-2 rounded-full p-0.5 pe-2 transition-colors hover:bg-muted"
              aria-label={`Account: ${me.name}`}
            >
              <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-semibold text-primary-foreground">
                {initials}
              </span>
              <span className="hidden text-start leading-tight xl:block">
                <span className="block text-sm font-medium">{me.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {me.roleName}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block text-sm font-medium">{me.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {me.email}
              </span>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Platform staff · {me.roleName}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/operator/account">
                <ShieldCheck aria-hidden /> Account &amp; security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
