'use client';

import { CUSTOM_FIELD_LIMITS, type CustomFieldDef, type CustomFieldEntity, resolveFields } from '@dealflow/types';
import { Badge, Button, Field, Input } from '@dealflow/ui';
import { useQuery } from '@tanstack/react-query';
import { Download, Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { CurrencyInput } from '@/components/forms/inputs';
import { formatBytes } from '@/components/forms/upload-zone';
import { api, ApiError, downloadFile } from '@/lib/api';
import { formatMoney } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { Select, Textarea } from './select';

/** A file saved in a FILE custom field, as the API returns it. */
export type FieldFile = { id: string; name: string; size: number; contentType: string };
type Money = { amount: number | string; currency: string };

/** The workspace's active custom fields on one record type, as the person sees them (ADR 0062). */
export function useFieldDefs(entity: CustomFieldEntity | null) {
  return useQuery({
    queryKey: ['custom-fields', entity],
    queryFn: () => api<CustomFieldDef[]>(`/custom-fields?entity=${entity}`),
    enabled: !!entity,
    staleTime: 60_000,
  });
}

/** Turns a stored value into what the input holds (dates and times as the browser inputs expect them). */
export function fieldFormValue(def: CustomFieldDef, v: unknown): unknown {
  if (v === null || v === undefined) return '';
  if (def.type === 'DATETIME' && typeof v === 'string') {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }
  return v;
}

/** Turns what the input holds into what the API takes; '' means "no value". */
export function fieldPayloadValue(def: CustomFieldDef, v: unknown): unknown {
  if (v === '' || v === undefined || v === null) return '';
  switch (def.type) {
    case 'DATETIME':
      return typeof v === 'string' && v ? new Date(v).toISOString() : '';
    case 'NUMBER':
      return typeof v === 'string' ? (v.trim() === '' ? '' : Number(v)) : v;
    case 'CURRENCY': {
      const m = v as Money;
      if (typeof m !== 'object') return v;
      return String(m.amount ?? '').trim() === '' ? '' : { amount: Number(m.amount), currency: m.currency };
    }
    case 'FILE':
      return Array.isArray(v) ? (v as FieldFile[]).map((f) => f.id) : v;
    case 'FORMULA':
      return '';
    case 'MULTISELECT':
      return Array.isArray(v) && v.length === 0 ? '' : v;
    default:
      return v;
  }
}

/** The field's default, for a new record's form. */
export function fieldDefault(def: CustomFieldDef): unknown {
  return def.defaultValue === null || def.defaultValue === undefined ? '' : fieldFormValue(def, def.defaultValue);
}

/**
 * Conditions and formulas for a form or a record (ADR 0062), worked out as the person types: which fields show,
 * and what each formula comes to. `get` reads a field's value by key, as the form holds it.
 */
export function fieldLogic(defs: readonly CustomFieldDef[], get: (key: string) => unknown) {
  const { shown, computed } = resolveFields(defs, get);
  return {
    shows: (d: CustomFieldDef) => shown.has(d.key),
    valueOf: (d: CustomFieldDef, v: unknown) => (d.type === 'FORMULA' ? (computed.get(d.key) ?? null) : v),
  };
}

/** One input for any of the custom field types. Read-only and formula fields show their value instead. */
export function CustomFieldInput({ def, id, value, onChange, error, entity }: { def: CustomFieldDef; id: string; value: unknown; onChange: (v: unknown) => void; error?: string; entity: CustomFieldEntity }) {
  const t = useT();
  const label = def.required && def.access.edit ? `${def.label} *` : def.label;
  const hint = def.description ?? undefined;
  const str = value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value);
  const wide = def.type === 'TEXTAREA' || def.type === 'MULTISELECT' || def.type === 'FILE';
  const wrap = (node: React.ReactNode) => <div className={wide ? 'sm:col-span-2' : undefined}>{node}</div>;

  if (def.type === 'FORMULA' || !def.access.edit) {
    return wrap(
      <Field id={id} label={label} hint={def.type === 'FORMULA' ? (hint ?? t('Calculated from other fields.')) : t('Only some designations can change this field.')}>
        <div id={id} className="min-h-9 rounded-md border border-dashed border-border px-3 py-2 text-sm">
          <CustomFieldValue def={def} value={value} empty="—" />
        </div>
      </Field>,
    );
  }

  switch (def.type) {
    case 'SELECT':
    case 'BOOLEAN': {
      const options = def.type === 'BOOLEAN' ? [{ v: 'true', l: t('Yes') }, { v: 'false', l: t('No') }] : def.options.map((o) => ({ v: o, l: o }));
      return wrap(
        <Field id={id} label={label} hint={hint} error={error}>
          <Select value={str} onChange={(e) => onChange(def.type === 'BOOLEAN' ? (e.target.value === '' ? '' : e.target.value === 'true') : e.target.value)}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </Select>
        </Field>,
      );
    }
    case 'CHECKBOX':
      return wrap(
        <div className="flex min-h-9 flex-col justify-end">
          <label className="flex items-center gap-2 text-sm" htmlFor={id}>
            <input id={id} type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            {label}
          </label>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          {error && <span className="text-xs text-critical">{error}</span>}
        </div>,
      );
    case 'MULTISELECT': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return wrap(
        <fieldset aria-describedby={error ? `${id}-error` : undefined}>
          <legend className="mb-1.5 text-sm font-medium">{label}</legend>
          {hint && <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {def.options.map((o) => (
              <label key={o} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={list.includes(o)}
                  onChange={(e) => onChange(e.target.checked ? def.options.filter((x) => x === o || list.includes(x)) : list.filter((x) => x !== o))}
                />
                {o}
              </label>
            ))}
          </div>
          {error && (
            <p id={`${id}-error`} className="mt-1 text-xs text-critical">
              {error}
            </p>
          )}
        </fieldset>,
      );
    }
    case 'TEXTAREA':
      return wrap(
        <Field id={id} label={label} hint={hint} error={error}>
          <Textarea rows={3} value={str} maxLength={CUSTOM_FIELD_LIMITS.textarea} onChange={(e) => onChange(e.target.value)} />
        </Field>,
      );
    case 'CURRENCY': {
      const m = (value && typeof value === 'object' ? value : { amount: str, currency: def.currency ?? 'USD' }) as Money;
      return wrap(
        <Field id={id} label={label} hint={hint} error={error}>
          <CurrencyInput currency={m.currency || def.currency || 'USD'} value={String(m.amount ?? '')} onChange={(amount) => onChange({ amount, currency: m.currency || def.currency || 'USD' })} />
        </Field>,
      );
    }
    case 'FILE':
      return wrap(<FileFieldInput def={def} id={id} label={label} hint={hint} error={error} value={value} onChange={onChange} entity={entity} />);
    default: {
      const type = { NUMBER: 'number', DATE: 'date', DATETIME: 'datetime-local', URL: 'url', EMAIL: 'email', PHONE: 'tel' }[def.type as string] ?? 'text';
      return wrap(
        <Field id={id} label={label} hint={hint} error={error}>
          <Input type={type} inputMode={def.type === 'NUMBER' ? 'decimal' : undefined} value={str} maxLength={def.type === 'TEXT' ? CUSTOM_FIELD_LIMITS.text : undefined} onChange={(e) => onChange(e.target.value)} />
        </Field>,
      );
    }
  }
}

function FileFieldInput({ def, id, label, hint, error, value, onChange, entity }: { def: CustomFieldDef; id: string; label: string; hint?: string; error?: string; value: unknown; onChange: (v: unknown) => void; entity: CustomFieldEntity }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const files = Array.isArray(value) ? (value as FieldFile[]) : [];
  const full = files.length >= CUSTOM_FIELD_LIMITS.files;

  async function upload(file: File) {
    setProblem(null);
    if (file.size > CUSTOM_FIELD_LIMITS.fileBytes) return setProblem(t('Files can be up to {size}.', { size: formatBytes(CUSTOM_FIELD_LIMITS.fileBytes) }));
    setBusy(true);
    try {
      const q = new URLSearchParams({ entity, key: def.key, name: file.name });
      const saved = await api<FieldFile>(`/custom-fields/files?${q}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
      onChange([...files, saved]);
    } catch (e) {
      setProblem(e instanceof ApiError || e instanceof Error ? e.message : t('Could not upload the file.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field id={id} label={label} hint={hint ?? t('Up to {count} files, {size} each.', { count: CUSTOM_FIELD_LIMITS.files, size: formatBytes(CUSTOM_FIELD_LIMITS.fileBytes) })} error={error ?? problem ?? undefined}>
      <div className="space-y-2">
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={t('Remove {name}', { name: f.name })} onClick={() => onChange(files.filter((x) => x.id !== f.id))}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={input}
          id={id}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy || full} onClick={() => input.current?.click()}>
          <Paperclip aria-hidden />
          {busy ? t('Uploading…') : t('Attach a file')}
        </Button>
      </div>
    </Field>
  );
}

/** A custom field's value for reading: money with its currency, links, chips, local dates and downloadable files. */
export function CustomFieldValue({ def, value, empty = null }: { def: CustomFieldDef; value: unknown; empty?: React.ReactNode }) {
  const t = useT();
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return <>{empty}</>;
  switch (def.type) {
    case 'BOOLEAN':
    case 'CHECKBOX':
      return <>{value === true ? t('Yes') : t('No')}</>;
    case 'CURRENCY': {
      const m = value as Money;
      const amount = Number(m.amount);
      // Small amounts such as a cost per interview keep their cents.
      return <span className="tabular-nums">{amount % 1 ? amount.toLocaleString(t.formatLocale, { style: 'currency', currency: m.currency || 'USD', maximumFractionDigits: 2 }) : formatMoney(amount, m.currency)}</span>;
    }
    case 'NUMBER':
      return <span className="tabular-nums">{Number(value).toLocaleString(t.formatLocale)}</span>;
    case 'FORMULA':
      return (
        <span className="tabular-nums">
          {Number(value).toLocaleString(t.formatLocale, { maximumFractionDigits: def.decimals ?? 2, ...(def.currency ? { style: 'currency', currency: def.currency, minimumFractionDigits: 0 } : {}) })}
        </span>
      );
    case 'DATE':
      return <>{new Date(`${String(value)}T00:00:00`).toLocaleDateString(t.formatLocale, { dateStyle: 'medium' })}</>;
    case 'DATETIME':
      return <>{new Date(String(value)).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}</>;
    case 'MULTISELECT':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((v) => (
            <Badge key={v}>{v}</Badge>
          ))}
        </span>
      );
    case 'URL':
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline-offset-2 hover:underline">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );
    case 'EMAIL':
      return (
        <a href={`mailto:${String(value)}`} className="break-all text-primary underline-offset-2 hover:underline">
          {String(value)}
        </a>
      );
    case 'PHONE':
      return (
        <a href={`tel:${String(value).replace(/[^\d+]/g, '')}`} className="text-primary underline-offset-2 hover:underline">
          {String(value)}
        </a>
      );
    case 'FILE':
      return (
        <span className="flex flex-col gap-1">
          {(value as FieldFile[]).map((f) => (
            <button key={f.id} type="button" className="flex items-center gap-1.5 text-start text-primary underline-offset-2 hover:underline" onClick={() => void downloadFile(`/custom-fields/files/${f.id}`, f.name)}>
              <Download className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
            </button>
          ))}
        </span>
      );
    case 'TEXTAREA':
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
    default:
      return <>{String(value)}</>;
  }
}
