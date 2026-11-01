'use client';

import { cn } from '@dealflow/ui';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import * as React from 'react';
import { fuzzyFilter } from '@/lib/fuzzy';

export interface ComboOption {
  value: string;
  label: string;
  /** Extra words that should match the search (a code, a dial prefix…). */
  keywords?: string;
  /** Shown to the right of the label. */
  hint?: string;
}

const MAX_SHOWN = 60;

interface AriaProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

/** Keyboard model shared by the single and multi comboboxes (ARIA 1.2 combobox with a listbox popup). */
function useListNav(count: number, open: boolean) {
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    if (active >= count) setActive(Math.max(0, count - 1));
  }, [count, active]);
  const move = (by: number) => setActive((a) => (count === 0 ? 0 : (a + by + count) % count));
  return { active: open ? active : -1, setActive, move };
}

/**
 * Searchable single select. Type to filter (fuzzy: "unk" finds United Kingdom), arrow keys to move, Enter to pick,
 * Escape to close. The input shows the chosen option's label when it is not being edited.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  clearable = true,
  disabled,
  className,
  ...aria
}: AriaProps & {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const listId = React.useId();
  const selected = options.find((o) => o.value === value) ?? null;
  const [text, setText] = React.useState<string | null>(null); // null = not editing
  const [open, setOpen] = React.useState(false);
  const shown = React.useMemo(
    () => (text ? fuzzyFilter(options, text, (o) => `${o.label} ${o.keywords ?? ''}`) : options).slice(0, MAX_SHOWN),
    [options, text],
  );
  const nav = useListNav(shown.length, open);
  const listRef = React.useRef<HTMLUListElement>(null);
  React.useEffect(() => {
    if (nav.active >= 0) listRef.current?.querySelector(`[data-index="${nav.active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [nav.active]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setText(null);
    setOpen(false);
  };
  const openList = () => {
    if (disabled) return;
    setOpen(true);
    nav.setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
  };

  return (
    <div className={cn('relative', className)}>
      <input
        {...aria}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[nav.active] ? `${listId}-${nav.active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={text ?? selected?.label ?? ''}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          nav.setActive(0);
        }}
        onFocus={(e) => e.target.select()}
        onClick={openList}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setText(null);
          }, 120)
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return openList();
            nav.move(e.key === 'ArrowDown' ? 1 : -1);
          } else if (e.key === 'Home' && open) {
            e.preventDefault();
            nav.setActive(0);
          } else if (e.key === 'End' && open) {
            e.preventDefault();
            nav.setActive(shown.length - 1);
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const o = shown[nav.active];
            if (o) pick(o);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setText(null);
          }
        }}
        className="flex h-control w-full rounded-md border border-input bg-surface py-2 ps-3 pe-14 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-critical"
      />
      <span className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
        <ChevronsUpDown className="size-4" />
      </span>
      {clearable && value && !disabled && (
        <button
          type="button"
          aria-label="Clear selection"
          className="absolute end-7 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          onClick={() => onChange('')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label={aria['aria-label']} className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {shown.length === 0 ? (
            <li role="presentation" className="px-2 py-1.5 text-sm text-muted-foreground">
              No matches
            </li>
          ) : (
            shown.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => nav.setActive(i)}
                onClick={() => pick(o)}
                className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm', i === nav.active && 'bg-muted')}
              >
                <Check className={cn('size-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="truncate">{o.label}</span>
                {o.hint && <span className="ms-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Searchable multi-select shown as removable chips. With `creatable`, typing a new value and pressing Enter or a comma
 * adds it (for free-form tags). Backspace in an empty field removes the last chip.
 */
export function MultiCombobox({
  options = [],
  value,
  onChange,
  placeholder = 'Type to add…',
  creatable = false,
  max,
  maxLength = 40,
  itemLabel = 'item',
  disabled,
  ...aria
}: AriaProps & {
  options?: ComboOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  creatable?: boolean;
  max?: number;
  maxLength?: number;
  /** Used in "Remove {itemLabel} X" and the limit message. */
  itemLabel?: string;
  disabled?: boolean;
}) {
  const listId = React.useId();
  const statusId = React.useId();
  const [text, setText] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const full = max !== undefined && value.length >= max;
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const shown = React.useMemo(() => {
    const avail = options.filter((o) => !value.includes(o.value));
    const filtered = text.trim() ? fuzzyFilter(avail, text, (o) => `${o.label} ${o.keywords ?? ''}`) : avail;
    const t = text.trim();
    const exact = options.some((o) => o.label.toLowerCase() === t.toLowerCase()) || value.some((v) => v.toLowerCase() === t.toLowerCase());
    const create: ComboOption[] = creatable && t && !exact ? [{ value: t.slice(0, maxLength), label: `Add “${t.slice(0, maxLength)}”` }] : [];
    return [...create, ...filtered].slice(0, MAX_SHOWN);
  }, [options, value, text, creatable, maxLength]);
  const nav = useListNav(shown.length, open && !full);

  const add = (v: string) => {
    const clean = v.trim().slice(0, maxLength);
    if (!clean || full) return;
    if (value.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      setStatus(`${labelOf(clean)} is already added.`);
      return;
    }
    onChange([...value, clean]);
    setStatus(`Added ${labelOf(clean)}.`);
    setText('');
  };
  const remove = (v: string) => {
    onChange(value.filter((x) => x !== v));
    setStatus(`Removed ${labelOf(v)}.`);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <div
        className={cn(
          'flex min-h-control w-full flex-wrap items-center gap-1 rounded-md border border-input bg-surface px-1.5 py-1 text-sm focus-within:ring-2 focus-within:ring-ring',
          aria['aria-invalid'] && 'border-critical',
          disabled && 'opacity-50',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <ul aria-label={aria['aria-label'] ? `${aria['aria-label']}: selected` : 'Selected'} className="contents">
          {value.map((v) => (
            <li key={v} className="inline-flex items-center gap-0.5 rounded bg-muted py-0.5 ps-2 pe-0.5 text-xs font-medium">
              {labelOf(v)}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${itemLabel} ${labelOf(v)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(v);
                }}
                className="grid size-6 place-items-center rounded hover:bg-background/60"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <input
          {...aria}
          ref={inputRef}
          role="combobox"
          aria-expanded={open && !full && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={[aria['aria-describedby'], statusId].filter(Boolean).join(' ')}
          aria-activedescendant={open && shown[nav.active] ? `${listId}-${nav.active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          readOnly={full}
          maxLength={maxLength}
          placeholder={full ? `Limit of ${max} reached` : value.length ? '' : placeholder}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (creatable && v.includes(',')) {
              v.split(',').slice(0, -1).forEach(add);
              setText(v.split(',').at(-1) ?? '');
            } else setText(v);
            setOpen(true);
            nav.setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              if (creatable && text.trim()) add(text);
            }, 120)
          }
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              nav.move(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter') {
              if (!text.trim() && !(open && shown[nav.active])) return;
              e.preventDefault();
              const o = open ? shown[nav.active] : undefined;
              if (o) add(o.value);
              else if (creatable) add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              remove(value.at(-1)!);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="min-w-24 flex-1 bg-transparent px-1.5 py-1 outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id={statusId} className="sr-only" aria-live="polite">
        {status}
      </p>
      {open && !full && shown.length > 0 && (
        <ul id={listId} role="listbox" aria-multiselectable="true" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {shown.map((o, i) => (
            <li
              key={o.value + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => nav.setActive(i)}
              onClick={() => add(o.value)}
              className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm', i === nav.active && 'bg-muted')}
            >
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="ms-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
