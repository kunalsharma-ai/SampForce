'use client';

import { Button, cn } from '@dealflow/ui';
import { FileUp, X } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/lib/i18n';

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

type FileText = '{file} is not a supported file. Use {types}.' | '{file} is {size}. The limit is {limit}.' | '{file} is empty.' | 'any {type}' | '{types} up to {limit}.';
/** Writes the messages below; the upload zone passes its translator, and tests use this English default. */
type Say = (text: FileText, vars: Record<string, string>) => string;
const english: Say = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/** Checks a file against an accept list (".csv", "image/*", "image/png") and a size limit; returns a problem or null. */
export function fileProblem(file: { name: string; type: string; size: number }, accept: string[], maxBytes: number, say: Say = english): string | null {
  const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
  const ok =
    accept.length === 0 ||
    accept.some((a) => {
      const rule = a.trim().toLowerCase();
      if (rule.startsWith('.')) return ext === rule;
      if (rule.endsWith('/*')) return file.type.toLowerCase().startsWith(rule.slice(0, -1));
      return file.type.toLowerCase() === rule;
    });
  if (!ok) return say('{file} is not a supported file. Use {types}.', { file: file.name, types: describeAccept(accept, say) });
  if (file.size > maxBytes) return say('{file} is {size}. The limit is {limit}.', { file: file.name, size: formatBytes(file.size), limit: formatBytes(maxBytes) });
  if (file.size === 0) return say('{file} is empty.', { file: file.name });
  return null;
}

function describeAccept(accept: string[], say: Say): string {
  const names = accept.map((a) => (a.startsWith('.') ? a.slice(1).toUpperCase() : a.endsWith('/*') ? say('any {type}', { type: a.slice(0, -2) }) : (a.split('/')[1] ?? a).toUpperCase()));
  return [...new Set(names)].join(', ');
}

/**
 * Drop zone for one file with a real file button, so it works by keyboard and screen reader as well as by drag and
 * drop. Type and size are checked before `onFile` is called; problems are announced.
 */
export function UploadZone({
  label,
  accept,
  maxBytes,
  onFile,
  file,
  onClear,
  busy,
  disabled,
  hint,
}: {
  label: string;
  /** Extensions and MIME types, as for <input accept>. */
  accept: string[];
  maxBytes: number;
  onFile: (file: File) => void;
  /** The chosen file, shown with a remove button. */
  file?: { name: string; size: number } | null;
  onClear?: () => void;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const t = useT();
  const inputId = React.useId();
  const hintId = React.useId();
  const ref = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const take = (f: File | undefined) => {
    if (!f || disabled) return;
    const p = fileProblem(f, accept, maxBytes, t);
    setProblem(p);
    if (!p) onFile(f);
  };
  return (
    <div className="space-y-1.5">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        data-dragging={over || undefined}
        className={cn(
          'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-6 text-center transition-colors',
          over && 'border-primary bg-primary/5',
          problem && 'border-critical',
          disabled && 'opacity-60',
        )}
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm">
          {t('Drag a file here, or')}{' '}
          <Button type="button" size="sm" variant="outline" disabled={disabled || busy} onClick={() => ref.current?.click()} aria-describedby={hintId}>
            {label}
          </Button>
        </p>
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint ?? t('{types} up to {limit}.', { types: describeAccept(accept, t), limit: formatBytes(maxBytes) })}
        </p>
        <input
          ref={ref}
          id={inputId}
          type="file"
          accept={accept.join(',')}
          aria-label={label}
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <div aria-live="polite">
        {problem ? (
          <p role="alert" className="text-xs text-critical">
            {problem}
          </p>
        ) : file ? (
          <p className="flex items-center gap-2 text-xs">
            <span className="font-medium">{file.name}</span>
            <span className="text-muted-foreground">{formatBytes(file.size)}</span>
            {busy && <span className="text-muted-foreground">{t('Uploading…')}</span>}
            {onClear && !busy && (
              <button type="button" onClick={onClear} aria-label={t('Remove {name}', { name: file.name })} className="grid size-6 place-items-center rounded hover:bg-muted">
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
