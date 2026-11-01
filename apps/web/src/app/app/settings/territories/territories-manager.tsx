'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { type TerritoryInput, territoryInputSchema, type TerritoryRow } from '@dealflow/types';
import { Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { MultiCombobox } from '@/components/forms/combobox';
import { countryName, countryOptions } from '@/components/forms/locale-data';
import { ApiError } from '@/lib/api';
import { useMembers } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useTerritories, useTerritoryMutations } from '@/lib/territories';

const EMPTY: TerritoryInput = { name: '', description: null, managerId: null, countries: [] };

export function TerritoriesManager() {
  const t = useT();
  const canManage = useCan('tenant:manage');
  const list = useTerritories();
  const { remove } = useTerritoryMutations();
  const [editing, setEditing] = useState<TerritoryRow | null>(null);
  // Kept here so the confirmation survives the form switching back from editing to adding.
  const [notice, setNotice] = useState<string | null>(null);
  const names = (codes: string[]) => codes.map((c) => countryName(c, t.formatLocale)).sort((a, b) => a.localeCompare(b, t.formatLocale)).join(', ');

  return (
    <div className="space-y-4">
      {canManage ? (
        <TerritoryForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} notice={notice} onNotice={setNotice} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('Only owners and administrators can change territories.')}</p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Your territories')}</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-24" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No territories yet.')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('Your territories')}>
              {list.data.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start gap-2 py-3 text-sm">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-medium">
                      {row.name} <Badge className="ms-1">{t.plural('count.countries', row.countries.length)}</Badge>
                    </p>
                    {row.description && <p className="text-muted-foreground">{row.description}</p>}
                    <p className="text-xs text-muted-foreground">{row.countries.length ? names(row.countries) : t('No countries yet')}</p>
                    {row.manager && <p className="text-xs text-muted-foreground">{t('Managed by {name}', { name: row.manager.name })}</p>}
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: row.name })} onClick={() => { setNotice(null); setEditing(row); }}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('Delete {name}', { name: row.name })}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(t('Delete {name}? Its deals become “Not in a territory”. Deals and companies are not changed.', { name: row.name }))) {
                            remove.mutate(row.id, { onSuccess: () => editing?.id === row.id && setEditing(null) });
                          }
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {remove.error && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {remove.error.message}
            </p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t('A country can be in one territory only. Deals whose company has no country, or a country no territory covers, show as “Not in a territory”.')}{' '}
        <Link href="/app/deals?view=territory" className="text-primary underline">
          {t('Open the Territory view')}
        </Link>
      </p>
    </div>
  );
}

function TerritoryForm({ editing, onDone, notice, onNotice }: { editing: TerritoryRow | null; onDone: () => void; notice: string | null; onNotice: (n: string | null) => void }) {
  const t = useT();
  const members = useMembers();
  const { save } = useTerritoryMutations();
  const [v, setV] = useState<TerritoryInput>(
    editing ? { name: editing.name, description: editing.description, managerId: editing.manager?.id ?? null, countries: editing.countries } : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const options = useMemo(() => countryOptions(t.formatLocale), [t.formatLocale]);
  const apiError = save.error instanceof ApiError ? save.error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t('Edit {name}', { name: editing.name }) : t('Add a territory')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            onNotice(null);
            const parsed = territoryInputSchema.safeParse(v);
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            save.mutate(
              { id: editing?.id ?? null, input: parsed.data },
              {
                onSuccess: (row) => {
                  onNotice(editing ? t('Saved {name}.', { name: row.name }) : t('Added {name}.', { name: row.name }));
                  if (editing) onDone();
                  else setV(EMPTY);
                },
              },
            );
          }}
        >
          <Field id="territory-name" label={t('Name')} error={errors.name}>
            <Input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('For example: DACH')} />
          </Field>
          <Field id="territory-manager" label={t('Manager')} hint={t('Optional')}>
            <Select value={v.managerId ?? ''} onChange={(e) => setV({ ...v, managerId: e.target.value || null })}>
              <option value="">{t('No manager')}</option>
              {members.data
                ?.filter((m) => m.status === 'ACTIVE')
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="territory-countries" label={t('Countries')} error={errors.countries} hint={t('Type to search, then press Enter to add.')}>
              <MultiCombobox
                id="territory-countries"
                options={options}
                value={v.countries}
                onChange={(countries) => setV({ ...v, countries })}
                itemLabel={t('country')}
                placeholder={t('Search countries…')}
                max={250}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="territory-description" label={t('Description')} hint={t('Optional')}>
              <Input value={v.description ?? ''} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value || null })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('Saving…') : editing ? t('Save changes') : t('Add territory')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={onDone}>
                {t('Cancel')}
              </Button>
            )}
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {apiError?.message ?? save.error.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
