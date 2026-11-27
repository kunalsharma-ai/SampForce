'use client';

import {
  ORG_DOCUMENT_CATEGORIES,
  ORG_DOCUMENT_CATEGORY_LABELS,
  ORG_DOCUMENT_MAX_BYTES,
  ORG_DOCUMENT_VISIBILITIES,
  ORG_DOCUMENT_VISIBILITY_LABELS,
  type OrgAccess,
  type OrgDocumentCategory,
  type OrgDocumentDetail,
  type OrgDocumentMeta,
  type OrgDocumentQuery,
  type OrgDocumentRow,
  type OrgDocumentVisibility,
  type OrgExpiryStatus,
} from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, Input } from '@dealflow/ui';
import { CheckCircle2, Download, Eye, FilePlus2, FileStack, History, Lock, MoreHorizontal, Pencil, RefreshCw, Search, Send, ShieldCheck, Trash2, UploadCloud, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ConfirmDeletionDialog } from '@/components/security/confirm-deletion-dialog';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { documentFileUrl, useOrgDocument, useOrgDocuments, useOrgMutations } from '@/lib/my-organization';
import { CATEGORY_STYLE, EmptyState, ExpiryBadge, FileTypeIcon, formatDay, formatSize, formatWhen, TONES } from './parts';

const EXPIRY_FILTERS: { key: OrgExpiryStatus | ''; label: 'Any expiry' | 'Expired' | 'Expiring soon' | 'Valid' | 'No expiry date' }[] = [
  { key: '', label: 'Any expiry' },
  { key: 'expired', label: 'Expired' },
  { key: 'expiring', label: 'Expiring soon' },
  { key: 'valid', label: 'Valid' },
  { key: 'none', label: 'No expiry date' },
];

/** The document library: search, filters, cards, and the dialogs to upload, look at, change and share documents. */
export function DocumentsPanel({ access, onShare }: { access: OrgAccess; onShare: (ids: string[]) => void }) {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState<OrgDocumentCategory | ''>((params.get('category') as OrgDocumentCategory) ?? '');
  const [expiry, setExpiry] = React.useState<OrgExpiryStatus | ''>((params.get('expiry') as OrgExpiryStatus) ?? '');
  const [shareable, setShareable] = React.useState(params.get('shareable') === 'true');
  const [sort, setSort] = React.useState<NonNullable<OrgDocumentQuery['sort']>>('recent');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(params.get('upload') === '1' && access.canEdit);
  const [openId, setOpenId] = React.useState<string | null>(params.get('document'));

  React.useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  // The upload and document links (from the header, a reminder) are one-shot: drop them from the address once used.
  const clearParam = React.useCallback(
    (key: string) => {
      if (!params.get(key)) return;
      const next = new URLSearchParams(params.toString());
      next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  React.useEffect(() => {
    if (params.get('upload') === '1' && access.canEdit) setUploading(true);
    if (params.get('document')) setOpenId(params.get('document'));
  }, [params, access.canEdit]);

  const query: OrgDocumentQuery = { q: search || undefined, category: category || undefined, expiry: expiry || undefined, shareable: shareable ? 'true' : undefined, sort };
  const docs = useOrgDocuments(query);
  const filtered = !!(search || category || expiry || shareable);
  const list = docs.data ?? [];
  const shareableIds = new Set(list.filter((d) => d.clientShareable).map((d) => d.id));
  const chosen = selected.filter((id) => shareableIds.has(id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">{t('Search documents')}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by title, issuer, number, tag or file name')} className="ps-9" />
          </label>
          <Select aria-label={t('Expiry')} value={expiry} onChange={(e) => setExpiry(e.target.value as OrgExpiryStatus | '')} className="w-auto">
            {EXPIRY_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {t(f.label)}
              </option>
            ))}
          </Select>
          <Select aria-label={t('Sort by')} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
            <option value="recent">{t('Recently updated')}</option>
            <option value="title">{t('Title A to Z')}</option>
            <option value="expiry">{t('Expiry date')}</option>
          </Select>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-surface px-3 text-sm">
            <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
            {t('Approved for clients')}
          </label>
          {access.canEdit && (
            <Button onClick={() => setUploading(true)}>
              <FilePlus2 className="size-4" aria-hidden /> {t('Upload document')}
            </Button>
          )}
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label={t('Category')}>
          <CategoryChip active={!category} onClick={() => setCategory('')} label={t('All categories')} />
          {ORG_DOCUMENT_CATEGORIES.map((c) => (
            <CategoryChip key={c} active={category === c} onClick={() => setCategory(category === c ? '' : c)} label={t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[c])} category={c} />
          ))}
        </div>
      </div>

      {chosen.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm shadow-sm backdrop-blur">
          <span className="font-medium">{t('{count} selected to share', { count: chosen.length })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected([])}>
              {t('Clear')}
            </Button>
            <Button size="sm" onClick={() => onShare(chosen)}>
              <Send className="size-4" aria-hidden /> {t('Share with a client')}
            </Button>
          </div>
        </div>
      )}

      {docs.isPending ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-muted/40 motion-reduce:animate-none" />
          ))}
        </ul>
      ) : docs.isError ? (
        <p className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm">{t('Could not load the documents. Refresh to try again.')}</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title={filtered ? t('No documents match') : t('No documents yet')}
          text={filtered ? t('Try another search or clear the filters.') : t('Keep registration certificates, tax documents, certifications, memberships, presentations and service profiles here, all in one place.')}
          action={
            !filtered && access.canEdit ? (
              <Button onClick={() => setUploading(true)}>
                <UploadCloud className="size-4" aria-hidden /> {t('Upload the first document')}
              </Button>
            ) : filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQ('');
                  setCategory('');
                  setExpiry('');
                  setShareable(false);
                }}
              >
                {t('Clear filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('{count} documents', { count: list.length })}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => (
              <DocumentCard
                key={d.id}
                doc={d}
                access={access}
                selected={selected.includes(d.id)}
                onSelect={(on) => setSelected((s) => (on ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                onOpen={() => setOpenId(d.id)}
                onShare={() => onShare([d.id])}
              />
            ))}
          </ul>
        </>
      )}

      {access.canEdit && (
        <UploadDialog
          open={uploading}
          access={access}
          onClose={() => {
            setUploading(false);
            clearParam('upload');
          }}
          onUploaded={(id) => setOpenId(id)}
        />
      )}
      <DocumentDialog
        id={openId}
        access={access}
        onShare={(id) => onShare([id])}
        onClose={() => {
          setOpenId(null);
          clearParam('document');
        }}
      />
    </div>
  );
}

function CategoryChip({ active, onClick, label, category }: { active: boolean; onClick: () => void; label: string; category?: OrgDocumentCategory }) {
  const style = category ? CATEGORY_STYLE[category] : null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background/70 text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      {style && <style.icon className="size-3.5" aria-hidden />}
      {label}
    </button>
  );
}

function DocumentCard({ doc: d, access, selected, onSelect, onOpen, onShare }: { doc: OrgDocumentRow; access: OrgAccess; selected: boolean; onSelect: (on: boolean) => void; onOpen: () => void; onShare: () => void }) {
  const t = useT();
  const style = CATEGORY_STYLE[d.category];
  return (
    <li
      className={cn(
        'group relative flex flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-sm transition hover:shadow-md motion-reduce:transition-none',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border',
        d.expiry === 'expired' && !selected && 'border-rose-500/40',
      )}
      data-document={d.title}
    >
      <div className="flex items-start gap-3">
        <FileTypeIcon contentType={d.file.contentType} fileName={d.file.fileName} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block text-start font-semibold leading-snug hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="line-clamp-2 break-words">{d.title}</span>
            <span className="absolute inset-0" aria-hidden />
          </button>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', TONES[style.tone])}>
              <style.icon className="size-3" aria-hidden />
              {t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[d.category])}
            </span>
            {d.visibility !== 'ALL' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground" title={t.maybe(ORG_DOCUMENT_VISIBILITY_LABELS[d.visibility])}>
                <Lock className="size-3" aria-hidden />
                {d.visibility === 'SUPER' ? t('Super only') : t('Managers')}
              </span>
            )}
          </p>
        </div>
        {d.clientShareable && (
          <label className="relative z-[1] inline-flex size-8 cursor-pointer items-center justify-center rounded-lg hover:bg-muted" title={t('Select to share')}>
            <span className="sr-only">{t('Select {title} to share', { title: d.title })}</span>
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
          </label>
        )}
      </div>
      {d.description && <p className="line-clamp-2 text-sm text-muted-foreground">{d.description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <ExpiryBadge expiry={d.expiry} daysLeft={d.daysLeft} expiryDate={d.expiryDate} />
        {d.clientShareable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300">
            <CheckCircle2 className="size-3" aria-hidden /> {t('Approved for clients')}
          </span>
        )}
        {d.versionCount > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <History className="size-3" aria-hidden /> {t('Version {n}', { n: d.file.version })}
          </span>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {t('Updated {date}', { date: formatDay(d.updatedAt.slice(0, 10), t.formatLocale) })} · {formatSize(d.file.sizeBytes)}
        </span>
        <span className="relative z-[1] flex shrink-0 gap-1">
          <IconLink href={documentFileUrl(d.id)} label={t('Download {title}', { title: d.title })} icon={Download} />
          {d.clientShareable && access.canShare && <IconButton onClick={onShare} label={t('Share {title} with a client', { title: d.title })} icon={Send} />}
          <IconButton onClick={onOpen} label={t('Open {title}', { title: d.title })} icon={Eye} />
        </span>
      </div>
    </li>
  );
}

function IconButton({ onClick, label, icon: Icon }: { onClick: () => void; label: string; icon: typeof Eye }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-background/70 text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function IconLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Eye }) {
  return (
    <a href={href} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-background/70 text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Icon className="size-4" aria-hidden />
    </a>
  );
}

// ───────────── Upload and edit ─────────────

interface MetaForm {
  title: string;
  category: OrgDocumentCategory;
  description: string;
  issuer: string;
  referenceNumber: string;
  issueDate: string;
  expiryDate: string;
  tags: string;
  visibility: OrgDocumentVisibility;
  clientShareable: boolean;
}

const emptyMeta = (): MetaForm => ({ title: '', category: 'registration', description: '', issuer: '', referenceNumber: '', issueDate: '', expiryDate: '', tags: '', visibility: 'ALL', clientShareable: false });
const metaOf = (d: OrgDocumentRow): MetaForm => ({
  title: d.title,
  category: d.category,
  description: d.description ?? '',
  issuer: d.issuer ?? '',
  referenceNumber: d.referenceNumber ?? '',
  issueDate: d.issueDate ?? '',
  expiryDate: d.expiryDate ?? '',
  tags: d.tags.join(', '),
  visibility: d.visibility,
  clientShareable: d.clientShareable,
});
const toMeta = (f: MetaForm): OrgDocumentMeta => ({
  title: f.title.trim(),
  category: f.category,
  description: f.description.trim() || null,
  issuer: f.issuer.trim() || null,
  referenceNumber: f.referenceNumber.trim() || null,
  issueDate: f.issueDate || null,
  expiryDate: f.expiryDate || null,
  tags: f.tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  visibility: f.visibility,
  clientShareable: f.clientShareable,
});

/** A title from a file name: "iso-9001_certificate.pdf" becomes "Iso 9001 certificate". */
function titleFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : '';
}

function errorsOf(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.details) return {};
  const out: Record<string, string> = {};
  for (const d of e.details) out[d.path.split('.')[0] ?? ''] ??= d.message;
  return out;
}

function MetaFields({ value: v, onChange, access, errors, idPrefix }: { value: MetaForm; onChange: (v: MetaForm) => void; access: OrgAccess; errors: Record<string, string>; idPrefix: string }) {
  const t = useT();
  const set = <K extends keyof MetaForm>(k: K, val: MetaForm[K]) => onChange({ ...v, [k]: val });
  const visibilities = ORG_DOCUMENT_VISIBILITIES.filter((x) => x !== 'SUPER' || access.level === 'SUPER');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={`${idPrefix}-title`} label={t('Title *')} error={errors.title}>
          <Input value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={200} placeholder={t('For example, Certificate of incorporation')} />
        </Field>
      </div>
      <Field id={`${idPrefix}-category`} label={t('Category')} error={errors.category}>
        <Select value={v.category} onChange={(e) => set('category', e.target.value as OrgDocumentCategory)}>
          {ORG_DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[c])}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${idPrefix}-issuer`} label={t('Issued by')} error={errors.issuer}>
        <Input value={v.issuer} onChange={(e) => set('issuer', e.target.value)} maxLength={200} placeholder={t('For example, Registrar of Companies')} />
      </Field>
      <Field id={`${idPrefix}-reference`} label={t('Reference or certificate number')} error={errors.referenceNumber}>
        <Input value={v.referenceNumber} onChange={(e) => set('referenceNumber', e.target.value)} maxLength={120} />
      </Field>
      <Field id={`${idPrefix}-tags`} label={t('Tags')} hint={t('Separate tags with commas.')} error={errors.tags}>
        <Input value={v.tags} onChange={(e) => set('tags', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-issued`} label={t('Issue date')} error={errors.issueDate}>
        <Input type="date" value={v.issueDate} onChange={(e) => set('issueDate', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-expires`} label={t('Expiry date')} hint={t('We remind the Super and Manager Workspaces 30 days and 7 days before.')} error={errors.expiryDate}>
        <Input type="date" value={v.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} min={v.issueDate || undefined} />
      </Field>
      <div className="sm:col-span-2">
        <Field id={`${idPrefix}-description`} label={t('Description')} error={errors.description}>
          <Textarea rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
        </Field>
      </div>
      <Field id={`${idPrefix}-visibility`} label={t('Who can see it')} error={errors.visibility}>
        <Select value={v.visibility} onChange={(e) => set('visibility', e.target.value as OrgDocumentVisibility)}>
          {visibilities.map((x) => (
            <option key={x} value={x}>
              {t.maybe(ORG_DOCUMENT_VISIBILITY_LABELS[x])}
            </option>
          ))}
        </Select>
      </Field>
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 self-end rounded-xl border p-3 text-sm transition',
          v.clientShareable ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border bg-background/60',
          v.visibility !== 'ALL' && 'cursor-not-allowed opacity-60',
        )}
      >
        <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={v.clientShareable && v.visibility === 'ALL'} disabled={v.visibility !== 'ALL'} onChange={(e) => set('clientShareable', e.target.checked)} />
        <span>
          <span className="block font-medium">{t('Approved for clients')}</span>
          <span className="block text-xs text-muted-foreground">{v.visibility === 'ALL' ? t('Anyone in the team can share it with a client.') : t('Only documents every workspace can see can be shared with clients.')}</span>
        </span>
      </label>
    </div>
  );
}

function UploadDialog({ open, access, onClose, onUploaded }: { open: boolean; access: OrgAccess; onClose: () => void; onUploaded: (id: string) => void }) {
  const t = useT();
  const { upload } = useOrgMutations();
  const [file, setFile] = React.useState<File | null>(null);
  const [meta, setMeta] = React.useState<MetaForm>(emptyMeta);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dragging, setDragging] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setFile(null);
    setMeta(emptyMeta());
    setErrors({});
    upload.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > ORG_DOCUMENT_MAX_BYTES) {
      setErrors({ file: t('Files can be up to 15 MB.') });
      return;
    }
    setErrors({});
    setFile(f);
    setMeta((m) => (m.title ? m : { ...m, title: titleFromFile(f.name) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrors({ file: t('Choose a file to upload.') });
      return;
    }
    if (!meta.title.trim()) {
      setErrors({ title: t('Give the document a title') });
      return;
    }
    try {
      const doc = await upload.mutateAsync({ file, meta: toMeta(meta) });
      onClose();
      onUploaded(doc.id);
    } catch (err) {
      setErrors(errorsOf(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !upload.isPending && onClose()}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Upload a document')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('PDF, images, Word, Excel, PowerPoint, text or ZIP, up to 15 MB.')}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn('rounded-2xl border-2 border-dashed p-5 text-center transition', dragging ? 'border-primary bg-primary/10' : errors.file ? 'border-critical/60' : 'border-border bg-background/60')}
          >
            <input ref={input} type="file" className="sr-only" id="org-upload-file" onChange={(e) => pick(e.target.files?.[0])} aria-describedby={errors.file ? 'org-upload-file-error' : undefined} />
            {file ? (
              <div className="flex items-center gap-3 text-start">
                <FileTypeIcon contentType={file.type} fileName={file.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
                  {t('Choose another')}
                </Button>
              </div>
            ) : (
              <label htmlFor="org-upload-file" className="flex cursor-pointer flex-col items-center gap-2">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <UploadCloud className="size-6" aria-hidden />
                </span>
                <span className="font-medium">{t('Drop a file here or choose one')}</span>
                <span className="text-xs text-muted-foreground">{t('The file stays private to your organization until you share it.')}</span>
              </label>
            )}
            {errors.file && (
              <p id="org-upload-file-error" role="alert" className="mt-2 text-xs text-critical">
                {errors.file}
              </p>
            )}
          </div>
          <MetaFields value={meta} onChange={setMeta} access={access} errors={errors} idPrefix="org-upload" />
          {upload.error && !Object.keys(errorsOf(upload.error)).length && (
            <p role="alert" className="text-sm text-critical">
              {upload.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={upload.isPending}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              <UploadCloud className="size-4" aria-hidden /> {upload.isPending ? t('Uploading…') : t('Upload')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── One document ─────────────

type Mode = 'view' | 'edit' | 'replace';

function DocumentDialog({ id, access, onShare, onClose }: { id: string | null; access: OrgAccess; onShare: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const doc = useOrgDocument(id);
  const [mode, setMode] = React.useState<Mode>('view');
  React.useEffect(() => setMode('view'), [id]);
  const d = doc.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[3%] max-h-[94vh] max-w-4xl overflow-y-auto p-0">
        {doc.isPending ? (
          <div className="space-y-3 p-6" aria-busy>
            <DialogTitle className="sr-only">{t('Loading the document')}</DialogTitle>
            <div className="h-8 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-72 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
          </div>
        ) : !d ? (
          <div className="p-6">
            <DialogTitle className="text-lg font-semibold">{t('Document not found')}</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('It may have been deleted, or it is kept for other workspaces.')}</DialogDescription>
          </div>
        ) : mode === 'edit' ? (
          <EditDocument doc={d} access={access} onDone={() => setMode('view')} />
        ) : mode === 'replace' ? (
          <ReplaceDocument doc={d} onDone={() => setMode('view')} />
        ) : (
          <DocumentView doc={d} access={access} onEdit={() => setMode('edit')} onReplace={() => setMode('replace')} onShare={() => onShare(d.id)} onDeleted={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentView({ doc: d, access, onEdit, onReplace, onShare, onDeleted }: { doc: OrgDocumentDetail; access: OrgAccess; onEdit: () => void; onReplace: () => void; onShare: () => void; onDeleted: () => void }) {
  const t = useT();
  const { update, remove } = useOrgMutations();
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const style = CATEGORY_STYLE[d.category];
  const canApprove = access.canEdit && d.visibility === 'ALL';

  const toggleApproval = async () => {
    setError(null);
    try {
      await update.mutateAsync({ id: d.id, input: { clientShareable: !d.clientShareable } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 border-b border-border p-5 lg:border-b-0 lg:border-e">
        <div className="mb-4 flex items-start gap-3 pe-8">
          <FileTypeIcon contentType={d.file.contentType} fileName={d.file.fileName} size="lg" />
          <div className="min-w-0">
            <DialogTitle className="break-words text-xl font-bold leading-tight">{d.title}</DialogTitle>
            <DialogDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', TONES[style.tone])}>
                <style.icon className="size-3" aria-hidden />
                {t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[d.category])}
              </span>
              <span className="text-muted-foreground">
                {d.file.fileName} · {formatSize(d.file.sizeBytes)}
              </span>
            </DialogDescription>
          </div>
        </div>
        <Preview doc={d} />
      </div>
      <aside className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={documentFileUrl(d.id)}>
              <Download className="size-4" aria-hidden /> {t('Download')}
            </a>
          </Button>
          {d.clientShareable && access.canShare && (
            <Button size="sm" variant="outline" onClick={onShare}>
              <Send className="size-4" aria-hidden /> {t('Share')}
            </Button>
          )}
          {access.canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label={t('More actions')}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" aria-hidden /> {t('Edit details')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onReplace}>
                  <RefreshCw className="size-4" aria-hidden /> {t('Replace file')}
                </DropdownMenuItem>
                {access.canDelete && (
                  <DropdownMenuItem onSelect={() => setConfirming(true)} className="text-critical focus:text-critical">
                    <Trash2 className="size-4" aria-hidden /> {t('Delete document')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className={cn('rounded-xl border p-3 text-sm', d.clientShareable ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-background/60')}>
          <p className="flex items-center gap-1.5 font-semibold">
            {d.clientShareable ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />}
            {d.clientShareable ? t('Approved for clients') : t('Internal only')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {d.clientShareable
              ? d.approvedBy
                ? t('Approved by {name} on {date}', { name: d.approvedBy.name, date: formatDay((d.approvedAt ?? d.updatedAt).slice(0, 10), t.formatLocale) })
                : t('Anyone in the team can share it with a client.')
              : d.visibility === 'ALL'
                ? t('Not shared with clients until it is approved.')
                : t.maybe(ORG_DOCUMENT_VISIBILITY_LABELS[d.visibility])}
          </p>
          {canApprove && (
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={toggleApproval} disabled={update.isPending}>
              {d.clientShareable ? t('Withdraw from clients') : t('Approve for clients')}
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Meta label={t('Expiry')}>{d.expiryDate ? <ExpiryBadge expiry={d.expiry} daysLeft={d.daysLeft} expiryDate={d.expiryDate} /> : t('Does not expire')}</Meta>
          <Meta label={t('Issue date')}>{d.issueDate && formatDay(d.issueDate, t.formatLocale)}</Meta>
          <Meta label={t('Issued by')}>{d.issuer}</Meta>
          <Meta label={t('Reference')}>{d.referenceNumber}</Meta>
          <Meta label={t('Who can see it')}>{t.maybe(ORG_DOCUMENT_VISIBILITY_LABELS[d.visibility])}</Meta>
          <Meta label={t('Uploaded')}>{d.createdBy ? t('{date} by {name}', { date: formatDay(d.createdAt.slice(0, 10), t.formatLocale), name: d.createdBy.name }) : formatDay(d.createdAt.slice(0, 10), t.formatLocale)}</Meta>
        </dl>
        {d.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{d.description}</p>}
        {d.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('Tags')}>
            {d.tags.map((tag) => (
              <li key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                {tag}
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby="org-doc-versions">
          <h3 id="org-doc-versions" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" aria-hidden /> {t('Version history')}
          </h3>
          <ol className="space-y-1.5">
            {d.versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 py-2 text-xs">
                <span className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-bold', v.version === d.file.version ? 'bg-primary text-primary-foreground' : 'bg-muted')}>v{v.version}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.fileName}</span>
                  <span className="block text-muted-foreground">
                    {formatWhen(v.createdAt, t.formatLocale)}
                    {v.uploadedBy && ` · ${v.uploadedBy.name}`}
                  </span>
                  {v.note && <span className="block text-muted-foreground">“{v.note}”</span>}
                </span>
                <a href={documentFileUrl(d.id, { version: v.version })} className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted" aria-label={t('Download version {n}', { n: v.version })} title={t('Download version {n}', { n: v.version })}>
                  <Download className="size-3.5" aria-hidden />
                </a>
              </li>
            ))}
          </ol>
        </section>
        {(error || remove.error) && (
          <p role="alert" className="text-sm text-critical">
            {error ?? remove.error?.message}
          </p>
        )}
      </aside>
      <ConfirmDeletionDialog
        open={confirming}
        title={t('Delete this document?')}
        description={t('“{title}” and all {count} versions of its file will be deleted for every workspace. Client links stop showing it.', { title: d.title, count: d.versionCount })}
        onCancel={() => setConfirming(false)}
        onConfirmed={async (pass) => {
          setConfirming(false);
          try {
            await remove.mutateAsync({ id: d.id, pass });
            onDeleted();
          } catch {
            // Shown above from remove.error.
          }
        }}
      />
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{children}</dd>
    </div>
  );
}

/** The file in the page when the browser can show it: PDFs and text in a frame, images as they are. */
function Preview({ doc: d }: { doc: OrgDocumentDetail }) {
  const t = useT();
  const url = documentFileUrl(d.id, { version: d.file.version, inline: true });
  if (!d.file.previewable)
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center">
        <FileTypeIcon contentType={d.file.contentType} fileName={d.file.fileName} size="lg" />
        <p className="text-sm text-muted-foreground">{t('This kind of file cannot be shown here. Download it to open it.')}</p>
        <Button asChild size="sm" variant="outline">
          <a href={documentFileUrl(d.id)}>
            <Download className="size-4" aria-hidden /> {t('Download')}
          </a>
        </Button>
      </div>
    );
  if (d.file.contentType.startsWith('image/'))
    return (
      <div className="flex max-h-[70vh] min-h-72 items-center justify-center overflow-auto rounded-2xl border border-border bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={t('Preview of {title}', { title: d.title })} className="max-h-[66vh] max-w-full rounded-lg object-contain shadow" />
      </div>
    );
  return <iframe src={url} title={t('Preview of {title}', { title: d.title })} className="h-[70vh] min-h-72 w-full rounded-2xl border border-border bg-white" />;
}

function EditDocument({ doc, access, onDone }: { doc: OrgDocumentDetail; access: OrgAccess; onDone: () => void }) {
  const t = useT();
  const { update } = useOrgMutations();
  const [meta, setMeta] = React.useState<MetaForm>(() => metaOf(doc));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meta.title.trim()) return setErrors({ title: t('Give the document a title') });
    try {
      await update.mutateAsync({ id: doc.id, input: toMeta(meta) });
      onDone();
    } catch (err) {
      setErrors(errorsOf(err));
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-6">
      <div>
        <DialogTitle className="text-lg font-semibold">{t('Edit document details')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('The file stays the same. Use Replace file to upload a new version.')}</DialogDescription>
      </div>
      <MetaFields value={meta} onChange={setMeta} access={access} errors={errors} idPrefix="org-edit" />
      {update.error && !Object.keys(errorsOf(update.error)).length && (
        <p role="alert" className="text-sm text-critical">
          {update.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('Saving…') : t('Save changes')}
        </Button>
      </div>
    </form>
  );
}

function ReplaceDocument({ doc, onDone }: { doc: OrgDocumentDetail; onDone: () => void }) {
  const t = useT();
  const { replace } = useOrgMutations();
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError(t('Choose a file to upload.'));
    if (file.size > ORG_DOCUMENT_MAX_BYTES) return setError(t('Files can be up to 15 MB.'));
    setError(null);
    try {
      await replace.mutateAsync({ id: doc.id, file, note: note.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-5 p-6">
      <div>
        <DialogTitle className="text-lg font-semibold">{t('Replace “{title}”', { title: doc.title })}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('The new file becomes version {n}. Earlier versions stay in the history.', { n: doc.file.version + 1 })}</DialogDescription>
      </div>
      <Field id="org-replace-file" label={t('New file')} error={error ?? undefined}>
        <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      {file && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <FileTypeIcon contentType={file.type} fileName={file.name} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} aria-label={t('Remove')} className="rounded p-1 hover:bg-muted">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <Field id="org-replace-note" label={t('What changed (optional)')}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('For example, Renewed for 2027')} />
      </Field>
      <p className="text-xs text-muted-foreground">{t('If the renewed document has a new expiry date, edit the details after replacing it.')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={replace.isPending}>
          <RefreshCw className="size-4" aria-hidden /> {replace.isPending ? t('Uploading…') : t('Replace file')}
        </Button>
      </div>
    </form>
  );
}
