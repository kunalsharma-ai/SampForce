'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModuleDef } from '@/lib/navigation';
import { orderedModules, useNavigation, useUpdateNavigation } from '@/lib/workspace-nav';
import { useShell } from '@/stores/shell';

const GROUPS: ModuleDef['group'][] = ['Workspace', 'Engage', 'Intelligence', 'Revenue', 'Organization'];
const key = (m: ModuleDef) => m.slug || 'home';

/**
 * Reorder and hide sidebar modules. Changes are a draft until Save, so moving several items is one request.
 * Hidden modules stay reachable from search (Ctrl K); Settings can never be hidden.
 */
export function CustomizeMenuDialog() {
  const open = useShell((s) => s.customizeOpen);
  const setOpen = useShell((s) => s.setCustomizeOpen);
  const { nav } = useNavigation();
  const update = useUpdateNavigation();
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    setOrder(orderedModules(nav, true).map(key));
    setHidden(new Set(nav.hiddenModules));
    setStatus('');
    // Only when the dialog opens: later server updates must not throw away the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = orderedModules({ moduleOrder: order, hiddenModules: [] }, true);
  const move = (m: ModuleDef, dir: -1 | 1) => {
    const peers = all.filter((x) => x.group === m.group).map(key);
    const i = peers.indexOf(key(m));
    const j = i + dir;
    if (j < 0 || j >= peers.length) return;
    const a = order.indexOf(peers[i]!);
    const b = order.indexOf(peers[j]!);
    const next = [...order];
    [next[a], next[b]] = [next[b]!, next[a]!];
    setOrder(next);
    setStatus(`${m.label} moved ${dir < 0 ? 'up' : 'down'}.`);
  };
  const toggleHidden = (m: ModuleDef) => {
    const next = new Set(hidden);
    if (next.has(key(m))) next.delete(key(m));
    else next.add(key(m));
    setHidden(next);
    setStatus(`${m.label} ${next.has(key(m)) ? 'hidden' : 'shown'}.`);
  };
  const save = () =>
    update.mutate({ moduleOrder: order, hiddenModules: [...hidden] }, { onSuccess: () => setOpen(false), onError: () => setStatus('Could not save the menu. Try again.') });
  const reset = () => update.mutate({ moduleOrder: [], hiddenModules: [] }, { onSuccess: () => setOpen(false) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogTitle className="text-lg font-semibold">Customize menu</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Reorder modules within each section and hide the ones you do not use. Hidden modules are still found by search. Saved for you in this workspace.
        </DialogDescription>
        <div className="-mx-2 mt-2 flex-1 space-y-4 overflow-y-auto px-2">
          {GROUPS.map((g) => {
            const list = all.filter((m) => m.group === g);
            return (
              <section key={g} aria-labelledby={`cm-${g}`}>
                <h3 id={`cm-${g}`} className="pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g}
                </h3>
                <ol className="divide-y divide-border rounded-md border border-border" aria-label={`${g} modules`}>
                  {list.map((m, i) => {
                    const isHidden = hidden.has(key(m));
                    const locked = m.slug === 'settings';
                    return (
                      <li key={key(m)} className="flex items-center gap-2 px-2 py-1">
                        <m.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className={isHidden ? 'flex-1 text-sm text-muted-foreground line-through' : 'flex-1 text-sm'}>{m.label}</span>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${m.label} up`} disabled={i === 0} onClick={() => move(m, -1)}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${m.label} down`} disabled={i === list.length - 1} onClick={() => move(m, 1)}>
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={isHidden ? `Show ${m.label}` : `Hide ${m.label}`}
                          aria-pressed={isHidden}
                          disabled={locked}
                          title={locked ? 'Settings is always shown' : undefined}
                          onClick={() => toggleHidden(m)}
                        >
                          {isHidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
        <p role="status" className="min-h-5 text-xs text-muted-foreground">
          {status}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={reset} disabled={update.isPending}>
            <RotateCcw aria-hidden /> Restore default menu
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={update.isPending}>
              Save menu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
