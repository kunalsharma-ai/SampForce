'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type CrmEntity, ENTITY_LABEL, useCustomFields } from '@/lib/crm';
import { toFormValues } from '@/lib/crm-fields';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { RecordFormDialog } from './record-form';
import { InfoTip } from '@/components/info-tip';
import { PageHelp } from '@/components/page-help';

/** Label and value pairs. Labels are catalogue phrases; custom field names (data) pass through `t.maybe`. */
export function DetailList({ items }: { items: [MessageKey | { text: string }, React.ReactNode][] }) {
  const t = useT();
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={typeof label === 'string' ? label : label.text} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{typeof label === 'string' ? t(label) : label.text}</dt>
          <dd className="truncate text-sm">{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CustomFieldList({ entity, values }: { entity: CrmEntity; values: Record<string, unknown> }) {
  const defs = useCustomFields(entity);
  const t = useT();
  if (!defs.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('Custom fields')}</CardTitle>
          <InfoTip topic="record.customFields" />
        </div>
      </CardHeader>
      <CardContent>
        <DetailList
          items={defs.data.map((d) => {
            const v = values[d.key];
            return [{ text: d.label }, typeof v === 'boolean' ? (v ? t('Yes') : t('No')) : (v as React.ReactNode)];
          })}
        />
      </CardContent>
    </Card>
  );
}

/** Title row for a record page: back link, edit and delete (both permission-gated). */
export function RecordHeader({
  entity,
  id,
  title,
  subtitle,
  row,
  badges,
  actions,
  editable = true,
}: {
  entity: CrmEntity;
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  row?: Record<string, unknown>;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  editable?: boolean;
}) {
  const canWrite = useCan(`${entity}:write` as 'leads:write');
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const qc = useQueryClient();
  const label = ENTITY_LABEL[entity];

  async function remove() {
    try {
      await api(`/${entity}/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: [entity] });
      router.push(`/app/${entity}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Could not delete.'));
    }
  }

  return (
    <div className="mb-6 space-y-3">
      <Link href={`/app/${entity}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t.maybe(label.many)}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              <span className="truncate">{title}</span>
              {badges}
            </h1>
            <PageHelp />
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions}
          {canWrite && editable && row && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> {t('Edit')}
            </Button>
          )}
          {canWrite && (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} aria-label={t.maybe(`Delete ${label.one.toLowerCase()}`)}>
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {row && (
        <RecordFormDialog
          entity={entity}
          open={editing}
          onOpenChange={setEditing}
          recordId={id}
          initial={toFormValues(entity, row)}
          onSaved={() => void qc.invalidateQueries({ queryKey: [entity, 'detail', id] })}
        />
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">{t.maybe(`Delete this ${label.one.toLowerCase()}?`)}</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('“{title}” will be removed from lists and search. The change is recorded in the audit log.', { title })}
          </DialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t('Cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              {t('Delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

export function DetailError({ error }: { error: Error }) {
  const notFound = error instanceof ApiError && error.status === 404;
  const t = useT();
  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-3 p-6">
        <p role="alert" className="font-medium">
          {notFound ? t('This record does not exist or was deleted.') : error.message}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/app">{t('Back to the Command Center')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
