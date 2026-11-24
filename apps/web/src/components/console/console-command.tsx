'use client';

import { Dialog, DialogContent, DialogTitle } from '@dealflow/ui';
import {
  type ConsolePalette,
  CONSOLE_PALETTE_DEFS,
  type ConsolePreferencesUpdate,
  type ConsoleSearchKind,
  type ConsoleSearchResult,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import {
  Building2,
  CreditCard,
  FileText,
  Layers,
  Moon,
  Palette,
  Sun,
  Ticket,
  UserRound,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fuzzyFilter } from '@/lib/fuzzy';
import { consolePagesFor } from './console-nav';

const ITEM =
  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-primary/10 aria-selected:text-foreground';

const KIND: Record<ConsoleSearchKind, { icon: typeof Building2; label: string; heading: string }> =
  {
    client: { icon: Building2, label: 'Client', heading: 'Clients' },
    user: { icon: UserRound, label: 'Person', heading: 'People' },
    workspace: { icon: Layers, label: 'Workspace', heading: 'Workspaces' },
    invoice: { icon: FileText, label: 'Invoice', heading: 'Invoices' },
    ticket: { icon: Ticket, label: 'Ticket', heading: 'Support tickets' },
    plan: { icon: CreditCard, label: 'Plan', heading: 'Plans' },
  };

/**
 * Global search and commands for the Console (Ctrl/⌘ K, ADR 0074): clients, people and their emails, workspaces,
 * invoices, tickets and plans from the server, plus every Console page and the appearance commands.
 */
export function ConsoleCommand({
  open,
  onOpenChange,
  dark,
  sound,
  permissions,
  onPreferences,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  permissions: readonly string[];
  dark: boolean;
  sound: boolean;
  onPreferences: (p: ConsolePreferencesUpdate) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const result = useQuery({
    queryKey: ['operator', 'search', debounced],
    queryFn: () => api<ConsoleSearchResult>(`/operator/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const run = (p: ConsolePreferencesUpdate) => {
    onOpenChange(false);
    onPreferences(p);
  };

  const q = query.trim();
  const pages = fuzzyFilter(consolePagesFor(permissions), q, (p) => `${p.label} ${p.group}`);
  const actions = [
    {
      id: 'mode',
      label: dark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: dark ? Sun : Moon,
      run: () => run({ mode: dark ? 'light' : 'dark' }),
    },
    {
      id: 'sound',
      label: sound ? 'Turn sounds off' : 'Turn sounds on',
      icon: sound ? VolumeX : Volume2,
      run: () => run({ sound: !sound }),
    },
    ...CONSOLE_PALETTE_DEFS.map((p) => ({
      id: `palette-${p.id}`,
      label: `Use the ${p.name} palette`,
      icon: Palette,
      run: () => run({ palette: p.id as ConsolePalette }),
    })),
  ];
  const acts = fuzzyFilter(actions, q, (a) => a.label);
  const hits = result.data?.q === debounced ? result.data.hits : [];
  const kinds = (Object.keys(KIND) as ConsoleSearchKind[]).filter((k) =>
    hits.some((h) => h.kind === k),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search the Console</DialogTitle>
        {/* cmdk's input is an open combobox, which the dialog leaves Escape to; here Escape closes the search. */}
        <Command
          label="Search the Console"
          shouldFilter={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onOpenChange(false);
            }
          }}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
        >
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search clients, people, emails, workspaces, invoices, tickets, plans…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-[26rem] overflow-y-auto p-2">
            {debounced.length >= 2 && result.isFetching && !hits.length && (
              <Command.Loading>
                <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
              </Command.Loading>
            )}
            {debounced.length >= 2 &&
              result.isSuccess &&
              result.data.q === debounced &&
              hits.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground" data-search-empty>
                  Nothing in the Console matches “{debounced}”.
                </p>
              )}
            {result.error && (
              <p className="px-3 py-2 text-sm text-critical">{result.error.message}</p>
            )}
            {kinds.map((kind) => {
              const meta = KIND[kind];
              return (
                <Command.Group key={kind} heading={meta.heading}>
                  {hits
                    .filter((h) => h.kind === kind)
                    .map((h) => (
                      <Command.Item
                        key={`${h.kind}-${h.id}`}
                        value={`${h.kind}-${h.id}`}
                        onSelect={() => go(h.href)}
                        className={ITEM}
                        data-search-hit={h.kind}
                      >
                        <meta.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">
                          {h.title}
                          {h.detail && (
                            <span className="ms-2 text-xs text-muted-foreground">{h.detail}</span>
                          )}
                        </span>
                        <span className="text-xs text-muted-foreground">{meta.label}</span>
                      </Command.Item>
                    ))}
                </Command.Group>
              );
            })}
            {pages.length > 0 && (
              <Command.Group heading="Go to">
                {pages.map((p) => (
                  <Command.Item
                    key={p.href}
                    value={`page-${p.href}`}
                    onSelect={() => go(p.href)}
                    className={ITEM}
                  >
                    <p.icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-xs text-muted-foreground">{p.group}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {acts.length > 0 && (
              <Command.Group heading="Appearance">
                {acts.map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`action-${a.id}`}
                    onSelect={a.run}
                    className={ITEM}
                  >
                    <a.icon className="size-4 text-muted-foreground" aria-hidden />
                    {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
