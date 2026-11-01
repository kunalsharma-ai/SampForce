'use client';

import { Dialog, DialogContent, DialogTitle } from '@dealflow/ui';
import type { Permission, SearchHit } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Bot, Building2, Clock, ContactRound, Handshake, Keyboard, Maximize2, Moon, Palette, Plus, SlidersHorizontal, Star, Sun, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fuzzyFilter } from '@/lib/fuzzy';
import { moduleHref, MODULES, phaseLabel } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { useNavigation } from '@/lib/workspace-nav';
import { useCopilot } from '@/stores/copilot';
import { usePreferences } from '@/stores/preferences';
import { type QuickCreateKind, useQuickCreate } from '@/stores/quick-create';
import { useShell } from '@/stores/shell';

const ITEM = 'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-muted';

const HIT_META = {
  lead: { icon: UserPlus, path: 'leads', label: 'Lead' },
  contact: { icon: ContactRound, path: 'contacts', label: 'Contact' },
  company: { icon: Building2, path: 'companies', label: 'Company' },
  deal: { icon: Handshake, path: 'deals', label: 'Deal' },
} as const;

const CREATE: { kind: QuickCreateKind; label: string; permission: Permission }[] = [
  { kind: 'leads', label: 'New lead', permission: 'leads:write' },
  { kind: 'contacts', label: 'New contact', permission: 'contacts:write' },
  { kind: 'companies', label: 'New company', permission: 'companies:write' },
  { kind: 'deals', label: 'New deal', permission: 'deals:write' },
  { kind: 'task', label: 'New task', permission: 'activities:write' },
];

/**
 * Global search and commands (Ctrl/⌘ K): records the person can read, favourites, recent pages, quick create,
 * navigation (including hidden modules), shell actions and a hand-off to Copilot. Matching is fuzzy (lib/fuzzy.ts).
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { data: me } = useSession();
  const openCreate = useQuickCreate((s) => s.open);
  const { nav } = useNavigation();
  const ask = useCopilot((s) => s.ask);
  const mode = usePreferences((s) => s.appearance.mode);
  const setMode = usePreferences((s) => s.setTheme);
  const shell = useShell();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const hits = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchHit[]>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const create = (kind: QuickCreateKind) => {
    onOpenChange(false);
    openCreate(kind);
  };
  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const q = query.trim();
  // A question (several words, or ending in "?") goes to Copilot first, so Enter asks it rather than opening a page.
  const question = q.endsWith('?') || q.split(/\s+/).length >= 4;
  const dark = mode === 'dark' || (mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const actions = [
    { id: 'focus', label: shell.focus ? 'Exit Focus Workspace' : 'Turn on Focus Workspace', icon: Maximize2, run: shell.toggleFocus },
    { id: 'mode', label: dark ? 'Switch to light mode' : 'Switch to dark mode', icon: dark ? Sun : Moon, run: () => setMode(dark ? 'light' : 'dark') },
    { id: 'studio', label: 'Open Theme Studio', icon: Palette, run: () => router.push('/app/settings/appearance') },
    { id: 'menu', label: 'Customize menu', icon: SlidersHorizontal, run: () => shell.setCustomizeOpen(true) },
    { id: 'keys', label: 'Keyboard shortcuts', icon: Keyboard, run: () => shell.setShortcutsOpen(true) },
  ];
  const favs = fuzzyFilter(nav.pinned, q, (p) => p.label);
  const recent = fuzzyFilter(nav.recent.slice(0, q ? 15 : 5), q, (r) => r.label);
  const creates = fuzzyFilter(
    CREATE.filter((c) => me?.permissions.includes(c.permission)),
    q,
    (c) => c.label,
  );
  const modules = fuzzyFilter(MODULES, q, (m) => `${m.label} ${m.summary}`);
  const acts = fuzzyFilter(actions, q, (a) => a.label);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search DealFlow</DialogTitle>
        <Command label="Search DealFlow" shouldFilter={false} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search records, pages and commands…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-96 overflow-y-auto p-2">
            {question && (
              <Command.Group heading="Copilot">
                <Command.Item value="ask-copilot" onSelect={() => run(() => ask(q))} className={ITEM}>
                  <Bot className="size-4 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Ask Copilot: “{q}”</span>
                </Command.Item>
              </Command.Group>
            )}
            {debounced.length >= 2 && (
              <Command.Group heading="Records">
                {hits.isFetching && !hits.data ? (
                  <Command.Loading>
                    <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
                  </Command.Loading>
                ) : hits.data?.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No records match “{debounced}”.</p>
                ) : (
                  hits.data?.map((h) => {
                    const meta = HIT_META[h.entity];
                    return (
                      <Command.Item
                        key={`${h.entity}-${h.id}`}
                        value={`${h.entity}-${h.id}`}
                        onSelect={() => go(`/app/${meta.path}/${h.id}`)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
                      >
                        <meta.icon className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          {h.title}
                          {h.subtitle && <span className="ml-2 text-xs text-muted-foreground">{h.subtitle}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{meta.label}</span>
                      </Command.Item>
                    );
                  })
                )}
              </Command.Group>
            )}
            {favs.length > 0 && (
              <Command.Group heading="Favourites">
                {favs.map((p) => (
                  <Command.Item key={p.href} value={`fav-${p.href}`} onSelect={() => go(p.href)} className={ITEM}>
                    <Star className="size-4 text-muted-foreground" aria-hidden />
                    {p.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {recent.length > 0 && (
              <Command.Group heading="Recent">
                {recent.map((r) => (
                  <Command.Item key={r.href} value={`recent-${r.href}`} onSelect={() => go(r.href)} className={ITEM}>
                    <Clock className="size-4 text-muted-foreground" aria-hidden />
                    {r.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {creates.length > 0 && (
              <Command.Group heading="Create">
                {creates.map((c) => (
                  <Command.Item key={c.kind} value={`create-${c.kind}`} onSelect={() => create(c.kind)} className={ITEM}>
                    <Plus className="size-4 text-muted-foreground" aria-hidden />
                    {c.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {modules.length > 0 && (
              <Command.Group heading="Modules">
                {modules.map((m) => (
                  <Command.Item key={m.slug || 'home'} value={`module-${m.slug || 'home'}`} onSelect={() => go(moduleHref(m))} className={ITEM}>
                    <m.icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{m.label}</span>
                    {m.status === 'planned' && <span className="text-xs text-muted-foreground">{phaseLabel(m.phase)}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {acts.length > 0 && (
              <Command.Group heading="Actions">
                {acts.map((a) => (
                  <Command.Item key={a.id} value={`action-${a.id}`} onSelect={() => run(a.run)} className={ITEM}>
                    <a.icon className="size-4 text-muted-foreground" aria-hidden />
                    {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {!question && q.length >= 3 && (
              <Command.Group heading="Copilot">
                <Command.Item value="ask-copilot" onSelect={() => run(() => ask(q))} className={ITEM}>
                  <Bot className="size-4 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Ask Copilot: “{q}”</span>
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
