'use client';

import type { TableDensity } from '@dealflow/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
} from '@dealflow/ui';
import { ArrowDown, ArrowUp, Bookmark, Columns3, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useViewMutations } from '@/lib/table-views';
import type { TableView } from './use-table-view';

const DENSITY_LABEL: Record<TableDensity, string> = {
  auto: 'Follow my settings',
  comfortable: 'Comfortable',
  balanced: 'Balanced',
  compact: 'Compact',
  ultra: 'Ultra compact',
};

export function DensityMenu<T>({ view }: { view: TableView<T> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Row density: ${DENSITY_LABEL[view.config.density]}`}>
          <Rows3 aria-hidden /> <span className="hidden xl:inline">Density</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Row density</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={view.config.density} onValueChange={(v) => view.setDensity(v as TableDensity)}>
          {(Object.keys(DENSITY_LABEL) as TableDensity[]).map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>
              {DENSITY_LABEL[d]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Show, hide and reorder columns. Applies at once; the first visible column links to the record. */
export function ColumnsDialog<T>({ view }: { view: TableView<T> }) {
  const [open, setOpen] = useState(false);
  const visible = view.config.columns;
  const all = [...visible.map((id) => view.columns.find((c) => c.id === id)!).filter(Boolean), ...view.columns.filter((c) => !visible.includes(c.id))];
  const [status, setStatus] = useState('');
  const move = (id: string, dir: -1 | 1) => {
    const i = visible.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const next = [...visible];
    [next[i], next[j]] = [next[j]!, next[i]!];
    view.setColumns(next);
    setStatus(`${view.columns.find((c) => c.id === id)?.header} moved ${dir < 0 ? 'left' : 'right'}.`);
  };
  const toggle = (id: string) => {
    const on = visible.includes(id);
    if (on && visible.length === 1) return;
    view.setColumns(on ? visible.filter((c) => c !== id) : [...visible, id]);
    setStatus(`${view.columns.find((c) => c.id === id)?.header} ${on ? 'hidden' : 'shown'}.`);
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Columns3 aria-hidden /> <span className="hidden xl:inline">Columns</span>
        <span className="sr-only xl:hidden">Columns</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80vh] flex-col p-6">
          <DialogTitle className="text-lg font-semibold">Columns</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Choose which columns show and their order. Drag a column edge in the table to change its width.</DialogDescription>
          <ol className="mt-3 flex-1 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Table columns">
            {all.map((c) => {
              const i = visible.indexOf(c.id);
              const on = i >= 0;
              return (
                <li key={c.id} className="flex items-center gap-2 px-3 py-1">
                  <label className="flex min-h-control-sm flex-1 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={on} disabled={on && visible.length === 1} onChange={() => toggle(c.id)} />
                    {c.header}
                  </label>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${c.header} left`} disabled={!on || i === 0} onClick={() => move(c.id, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${c.header} right`} disabled={!on || i === visible.length - 1} onClick={() => move(c.id, 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ol>
          <p role="status" className="mt-2 min-h-5 text-xs text-muted-foreground">
            {status}
          </p>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => view.setColumns(view.defaults.columns)}>
              Default columns
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Switch between the default layout and saved views; save, share or delete views. */
export function ViewsMenu<T>({ view }: { view: TableView<T> }) {
  const m = useViewMutations(view.entity);
  const [naming, setNaming] = useState<null | 'new' | 'rename'>(null);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mine = view.views.data?.filter((v) => v.mine) ?? [];
  const others = view.views.data?.filter((v) => !v.mine) ?? [];
  const active = view.active;

  useEffect(() => {
    if (naming) {
      setName(naming === 'rename' ? (active?.name ?? '') : '');
      setShared(naming === 'rename' ? !!active?.shared : false);
      setError(null);
    }
  }, [naming, active]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const onError = (err: Error) => setError(err instanceof ApiError ? err.message : 'Could not save the view.');
    if (naming === 'new') {
      m.create.mutate(
        { name: name.trim(), shared, config: view.config },
        { onSuccess: (v) => (view.apply(v), setNaming(null), setNotice(`Saved view “${v.name}”.`)), onError },
      );
    } else if (active) {
      m.update.mutate({ id: active.id, name: name.trim(), shared }, { onSuccess: () => (setNaming(null), setNotice('View updated.')), onError });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`View: ${active?.name ?? 'Default view'}${view.dirty ? ' (changed)' : ''}`}>
            <Bookmark aria-hidden />
            <span className="max-w-32 truncate">{active?.name ?? 'Default view'}</span>
            {view.dirty && <span aria-hidden className="size-1.5 rounded-full bg-warning" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuRadioGroup value={active?.id ?? 'default'} onValueChange={(id) => view.apply(view.views.data?.find((v) => v.id === id) ?? null)}>
            <DropdownMenuRadioItem value="default">Default view</DropdownMenuRadioItem>
            {mine.length > 0 && <DropdownMenuLabel>My views</DropdownMenuLabel>}
            {mine.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                <span className="flex-1 truncate">{v.name}</span>
                {v.shared && <span className="text-[10px] text-muted-foreground">Shared</span>}
              </DropdownMenuRadioItem>
            ))}
            {others.length > 0 && <DropdownMenuLabel>Shared with the workspace</DropdownMenuLabel>}
            {others.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                <span className="flex-1 truncate">{v.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">{v.ownerName}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {active?.mine && view.dirty && (
            <DropdownMenuItem onSelect={() => m.update.mutate({ id: active.id, config: view.config }, { onSuccess: () => setNotice(`Saved changes to “${active.name}”.`) })}>
              Save changes to “{active.name}”
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setNaming('new')}>Save as new view…</DropdownMenuItem>
          {view.dirty && <DropdownMenuItem onSelect={view.reset}>Discard changes</DropdownMenuItem>}
          {active?.mine && (
            <>
              <DropdownMenuItem onSelect={() => setNaming('rename')}>Rename or share…</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  m.remove.mutate(active.id, {
                    onSuccess: () => {
                      view.apply(null);
                      setNotice(`Deleted view “${active.name}”.`);
                    },
                  })
                }
              >
                Delete “{active.name}”
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {notice}
      </span>
      <Dialog open={!!naming} onOpenChange={(o) => !o && setNaming(null)}>
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">{naming === 'new' ? 'Save view' : 'Rename or share view'}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            A view keeps the columns, widths, sort, filters, search and density. Shared views can be used, but not changed, by everyone in the workspace.
          </DialogDescription>
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <Field id="view-name" label="View name" error={error ?? undefined}>
              <Input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Share with everyone in this workspace
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setNaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || m.create.isPending || m.update.isPending}>
                Save view
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
