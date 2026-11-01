'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, type CustomFieldDef, customFieldDefSchema } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const ENTITY_NAMES: Record<(typeof CUSTOM_FIELD_ENTITIES)[number], MessageKey> = { LEAD: 'Leads', CONTACT: 'Contacts', COMPANY: 'Companies', OPPORTUNITY: 'Deals' };
const TYPE_NAMES: Record<(typeof CUSTOM_FIELD_TYPES)[number], MessageKey> = { TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', BOOLEAN: 'Yes / no', SELECT: 'Dropdown' };

export function CustomFieldsManager() {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('tenant:manage');
  const defs = useQuery({ queryKey: ['custom-fields', 'all'], queryFn: () => api<CustomFieldDef[]>('/custom-fields') });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/custom-fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });

  return (
    <div className="space-y-4">
      {canManage && <NewFieldForm />}
      {defs.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        CUSTOM_FIELD_ENTITIES.map((entity) => {
          const rows = defs.data?.filter((d) => d.entity === entity) ?? [];
          return (
            <Card key={entity}>
              <CardHeader>
                <CardTitle className="text-base">{t(ENTITY_NAMES[entity])}</CardTitle>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('No custom fields.')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="font-medium">{d.label}</span>
                        <code className="rounded bg-muted px-1.5 text-xs">{d.key}</code>
                        <Badge>{t(TYPE_NAMES[d.type])}</Badge>
                        {d.required && <Badge tone="warning">{t('Required')}</Badge>}
                        {d.options.length > 0 && <span className="text-xs text-muted-foreground">{d.options.join(', ')}</span>}
                        {canManage && (
                          <Button variant="ghost" size="icon" className="ms-auto" aria-label={t('Archive {label}', { label: d.label })} onClick={() => archive.mutate(d.id)} disabled={archive.isPending}>
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      <p className="text-xs text-muted-foreground">{t('Archiving hides a field from forms. Values already saved on records are kept.')}</p>
    </div>
  );
}

function NewFieldForm() {
  const t = useT();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<(typeof CUSTOM_FIELD_ENTITIES)[number]>('LEAD');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<(typeof CUSTOM_FIELD_TYPES)[number]>('TEXT');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: unknown) => api<CustomFieldDef>('/custom-fields', { method: 'POST', json: body }),
    onSuccess: () => {
      setLabel('');
      setKey('');
      setKeyTouched(false);
      setOptions('');
      setRequired(false);
      void qc.invalidateQueries({ queryKey: ['custom-fields'] });
    },
  });
  const autoKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
  const effectiveKey = keyTouched ? key : autoKey;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Add a field')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { entity, label, key: effectiveKey, type, required, options: type === 'SELECT' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] };
            const parsed = customFieldDefSchema.safeParse(body);
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            create.mutate(parsed.data);
          }}
        >
          <Field id="cf-entity" label={t('Record type')}>
            <Select value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)}>
              {CUSTOM_FIELD_ENTITIES.map((en) => (
                <option key={en} value={en}>
                  {t(ENTITY_NAMES[en])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-type" label={t('Type')}>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {CUSTOM_FIELD_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(TYPE_NAMES[ty])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-label" label={t('Label')} error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </Field>
          <Field id="cf-key" label={t('Key')} error={errors.key} hint={t('Used in imports and the API')}>
            <Input
              value={effectiveKey}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value);
              }}
              maxLength={40}
            />
          </Field>
          {type === 'SELECT' && (
            <div className="sm:col-span-2">
              <Field id="cf-options" label={t('Options')} error={errors.options} hint={t('Separate with commas')}>
                <Input value={options} onChange={(e) => setOptions(e.target.value)} />
              </Field>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            {t('Required on new and edited records')}
          </label>
          <div className="flex items-center justify-end gap-2">
            {create.error && (
              <p role="alert" className="text-sm text-critical">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending || !label.trim()}>
              {t('Add field')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
