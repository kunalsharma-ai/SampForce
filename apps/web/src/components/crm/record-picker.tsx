'use client';

import { Input } from '@dealflow/ui';
import type { Page } from '@dealflow/types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toQuery } from '@/lib/crm';

export interface PickerValue {
  id: string;
  name: string;
}

interface Props {
  id?: string;
  entity: 'companies' | 'contacts' | 'leads' | 'deals';
  value: PickerValue | null;
  onChange: (v: PickerValue | null) => void;
  placeholder?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

type Option = { id: string; name?: string; fullName?: string; email?: string | null; domain?: string | null };

/** ARIA combobox that searches records of one type as you type. */
export function RecordPicker({ id, entity, value, onChange, placeholder, ...aria }: Props) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [debounced, setDebounced] = useState('');

  useEffect(() => setText(value?.name ?? ''), [value?.name]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 200);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: [entity, 'picker', debounced],
    queryFn: () => api<Page<Option>>(`/${entity}${toQuery({ q: debounced, pageSize: 8, sort: entity === 'companies' ? 'name' : 'createdAt', order: 'asc' })}`),
    enabled: open,
    // Keep showing the last matches while the next search loads, so the list does not flash "Searching…"
    // and the option under the pointer is not replaced mid-click.
    placeholderData: keepPreviousData,
  });
  const options = (results.data?.items ?? []).map((o) => ({ id: o.id, name: o.name ?? o.fullName ?? '', sub: o.domain ?? o.email ?? null }));

  const choose = (o: PickerValue) => {
    onChange({ id: o.id, name: o.name });
    setText(o.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder ?? 'Search…'}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        {...aria}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear selection"
          className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          onClick={() => {
            onChange(null);
            setText('');
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <ul id={listId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {results.isPending ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
          ) : (
            options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className="cursor-pointer rounded px-3 py-2 text-sm aria-selected:bg-muted"
              >
                <span className="font-medium">{o.name}</span>
                {o.sub && <span className="ml-2 text-xs text-muted-foreground">{o.sub}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
