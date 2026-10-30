'use client';

import { Dialog, DialogContent, DialogTitle } from '@dealflow/ui';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { moduleHref, MODULES } from '@/lib/navigation';

/**
 * Global search (Ctrl/⌘ K). Phase 1 searches navigation; record search across leads, contacts,
 * companies and deals is added in Phase 2 behind the same palette.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search DealFlow</DialogTitle>
        <Command label="Search DealFlow" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
          <Command.Input
            autoFocus
            placeholder="Jump to a module or setting…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="p-6 text-center text-sm text-muted-foreground">
              No matches. Record search arrives with the Core CRM release.
            </Command.Empty>
            <Command.Group heading="Modules">
              {MODULES.map((m) => (
                <Command.Item
                  key={m.slug || 'home'}
                  value={`${m.label} ${m.summary}`}
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
