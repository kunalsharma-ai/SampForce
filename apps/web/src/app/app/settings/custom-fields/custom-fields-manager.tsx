'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES, type CustomFieldDef, customFieldDefSchema } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { titleCase } from '@/lib/crm';
import { useCan } from '@/lib/session';

const ENTITY_NAMES = { LEAD: 'Leads', CONTACT: 'Contacts', COMPANY: 'Companies', OPPORTUNITY: 'Deals' } as const;

export function CustomFieldsManager() {
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
                <CardTitle className="text-base">{ENTITY_NAMES[entity]}</CardTitle>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custom fields.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {rows.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="font-medium">{d.label}</span>
                        <code className="rounded bg-muted px-1.5 text-xs">{d.key}</code>
                        <Badge>{titleCase(d.type)}</Badge>
                        {d.required && <Badge tone="warning">Required</Badge>}
                        {d.options.length > 0 && <span className="text-xs text-muted-foreground">{d.options.join(', ')}</span>}
                        {canManage && (
                          <Button variant="ghost" size="icon" className="ms-auto" aria-label={`Archive ${d.label}`} onClick={() => archive.mutate(d.id)} disabled={archive.isPending}>
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
      <p className="text-xs text-muted-foreground">Archiving hides a field from forms. Values already saved on records are kept.</p>
    </div>
  );
}

function NewFieldForm() {
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
        <CardTitle className="text-base">Add a field</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { entity, label, key: effectiveKey, type, required, options: type === 'SELECT' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] };
            const parsed = customFieldDefSchema.safeParse(body);
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
              return;
            }
            setErrors({});
            create.mutate(parsed.data);
          }}
        >
          <Field id="cf-entity" label="Record type">
            <Select value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)}>
              {CUSTOM_FIELD_ENTITIES.map((en) => (
                <option key={en} value={en}>
                  {ENTITY_NAMES[en]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-type" label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'SELECT' ? 'Dropdown' : t === 'BOOLEAN' ? 'Yes / no' : titleCase(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-label" label="Label" error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          </Field>
          <Field id="cf-key" label="Key" error={errors.key} hint="Used in imports and the API">
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
              <Field id="cf-options" label="Options" error={errors.options} hint="Separate with commas">
                <Input value={options} onChange={(e) => setOptions(e.target.value)} />
              </Field>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required on new and edited records
          </label>
          <div className="flex items-center justify-end gap-2">
            {create.error && (
              <p role="alert" className="text-sm text-critical">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={create.isPending || !label.trim()}>
              Add field
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
