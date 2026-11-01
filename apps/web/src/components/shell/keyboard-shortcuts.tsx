'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { CREATE, GO_TO, isTypingTarget, resolveShortcut, SINGLE } from '@/lib/shortcuts';
import { usePreferences } from '@/stores/preferences';
import { useQuickCreate } from '@/stores/quick-create';
import { useShell } from '@/stores/shell';

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex gap-1">
      {keys.split(' ').map((k) => (
        <kbd key={k} className="min-w-6 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Listens for app-wide shortcuts and renders the "?" reference sheet. Mounted once by the shell. */
export function KeyboardShortcuts() {
  const router = useRouter();
  const open = useShell((s) => s.shortcutsOpen);
  const setOpen = useShell((s) => s.setShortcutsOpen);
  const prefix = useRef<{ key: 'g' | 'n'; at: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const p = prefix.current && Date.now() - prefix.current.at < 1200 ? prefix.current.key : null;
      const action = resolveShortcut(e, p, isTypingTarget(e.target));
      if (p) prefix.current = null;
      if (!action) return;
      const shell = useShell.getState();
      switch (action.type) {
        case 'prefix':
          prefix.current = { key: action.prefix, at: Date.now() };
          return;
        case 'search':
          e.preventDefault();
          shell.setSearchOpen((v) => !v);
          return;
        case 'focus':
          e.preventDefault();
          shell.toggleFocus();
          return;
        case 'sidebar':
          usePreferences.getState().toggleSidebar();
          return;
        case 'help':
          shell.setShortcutsOpen(true);
          return;
        case 'go':
          router.push(action.href);
          return;
        case 'create':
          useQuickCreate.getState().open(action.kind);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Letter shortcuts work anywhere except while you are typing in a field. On a Mac, use ⌘ instead of Ctrl.
        </DialogDescription>
        <div className="mt-2 grid gap-6 sm:grid-cols-2">
          <section aria-labelledby="ks-general">
            <h3 id="ks-general" className="pb-2 text-sm font-semibold">
              General
            </h3>
            <dl className="space-y-1.5 text-sm">
              {SINGLE.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-3">
                  <dt>{s.label}</dt>
                  <dd>
                    <Keys keys={s.keys} />
                  </dd>
                </div>
              ))}
            </dl>
            <h3 className="pb-2 pt-4 text-sm font-semibold">Create</h3>
            <dl className="space-y-1.5 text-sm">
              {CREATE.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <dt>{s.label}</dt>
                  <dd>
                    <Keys keys={`N ${s.key.toUpperCase()}`} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="ks-go">
            <h3 id="ks-go" className="pb-2 text-sm font-semibold">
              Go to
            </h3>
            <dl className="space-y-1.5 text-sm">
              {GO_TO.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <dt>{s.label}</dt>
                  <dd>
                    <Keys keys={`G ${s.key.toUpperCase()}`} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
