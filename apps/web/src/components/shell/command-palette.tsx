'use client';

import { Dialog, DialogContent, DialogTitle } from '@dealflow/ui';
import type { Permission, SearchHit } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Building2, ContactRound, Handshake, Plus, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { moduleHref, MODULES } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { type QuickCreateKind, useQuickCreate } from '@/stores/quick-create';

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

/** Global search (Ctrl/⌘ K): records the user can read, quick create, and navigation. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { data: me } = useSession();
  const openCreate = useQuickCreate((s) => s.open);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search DealFlow</DialogTitle>
        <Command label="Search DealFlow" shouldFilter={false} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search leads, contacts, companies, deals or modules…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-96 overflow-y-auto p-2">
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
            <Command.Group heading="Create">
              {CREATE.filter((c) => me?.permissions.includes(c.permission) && matches(c.label, query)).map((c) => (
                <Command.Item key={c.kind} value={`create-${c.kind}`} onSelect={() => create(c.kind)} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-muted">
                  <Plus className="size-4 text-muted-foreground" aria-hidden />
                  {c.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Modules">
              {MODULES.filter((m) => matches(`${m.label} ${m.summary}`, query)).map((m) => (
                <Command.Item
                  key={m.slug || 'home'}
                  value={`module-${m.slug || 'home'}`}
                  onSelect={() => go(moduleHref(m))}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
                >
                  <m.icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  {m.status === 'planned' && <span className="text-xs text-muted-foreground">Phase {m.phase}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function matches(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || q.split(/\s+/).every((w) => text.toLowerCase().includes(w));
}
