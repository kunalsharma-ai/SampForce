'use client';

import { Button, Card, Input } from '@dealflow/ui';
import {
  FEATURE_GROUPS,
  FEATURES,
  FIELD_ACCESS_CATALOGUE,
  FIELD_ENTITIES,
  FIELD_ENTITY_LABEL,
  type FeatureKey,
  type MenuSections,
  type WorkspaceRules,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/*
 * Section and field access per level (redesign R8, ADR 0092). The Console Admin decides which sections of the menu
 * and which fields of companies, employees, deals and RFQs Manager and Executive Workspaces may see. The Super
 * Workspace always sees everything and hands down only what the Console leaves open. The Console reads in English.
 */

type Level = 'manager' | 'executive';
const LEVELS: { key: Level; label: string; short: string }[] = [
  { key: 'manager', label: 'Manager Workspaces', short: 'Manager' },
  { key: 'executive', label: 'Executive Workspaces', short: 'Executive' },
];
const sectionsKey = (l: Level): 'managerHiddenSections' | 'executiveHiddenSections' => (l === 'manager' ? 'managerHiddenSections' : 'executiveHiddenSections');
const fieldsKey = (l: Level): 'managerHiddenFields' | 'executiveHiddenFields' => (l === 'manager' ? 'managerHiddenFields' : 'executiveHiddenFields');
const modulesKey = (l: Level): 'managerModules' | 'executiveModules' => (l === 'manager' ? 'managerModules' : 'executiveModules');

const toggle = <T extends string>(list: readonly T[], item: T, hide: boolean): T[] => (hide ? [...new Set([...list, item])] : list.filter((x) => x !== item));

/** The grid of sections and fields; a ticked box means the level may see it. */
export function AccessMatrix({ value, onChange, disabled, name }: { value: WorkspaceRules; onChange: (r: WorkspaceRules) => void; disabled: boolean; name: string }) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);
  const hiddenCount = (l: Level) => value[sectionsKey(l)].length + value[fieldsKey(l)].length;
  const setSection = (l: Level, key: FeatureKey, see: boolean) => onChange({ ...value, [sectionsKey(l)]: toggle(value[sectionsKey(l)], key, !see) });
  const setField = (l: Level, fid: string, see: boolean) => onChange({ ...value, [fieldsKey(l)]: toggle(value[fieldsKey(l)], fid, !see) });
  const setGroup = (l: Level, keys: FeatureKey[], see: boolean) =>
    onChange({ ...value, [sectionsKey(l)]: see ? value[sectionsKey(l)].filter((k) => !keys.includes(k)) : [...new Set([...value[sectionsKey(l)], ...keys])] });

  return (
    <div className="space-y-4 text-sm" data-access-matrix={name}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-medium">Sections and fields each level may see</h3>
          <p className="text-xs text-muted-foreground">
            Ticked means the level may see it. The Super Workspace always sees everything and can pass on only what is ticked here; nobody in the client&apos;s workspaces can change this.
          </p>
          <p className="mt-1 text-xs text-muted-foreground" data-access-summary="">
            {LEVELS.map((l) => `${l.short}: ${hiddenCount(l.key) ? `${hiddenCount(l.key)} hidden` : 'everything'}`).join(' · ')}
          </p>
        </div>
        <div className="w-full space-y-1 sm:w-64">
          <label htmlFor={`${id}-filter`} className="text-xs font-medium">
            Find a section or field
          </label>
          <Input id={`${id}-filter`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Email, RFQs, Reports…" />
        </div>
      </div>

      <div className="space-y-2" data-access-sections="">
        {FEATURE_GROUPS.map((group) => {
          const rows = FEATURES.filter((f) => f.group === group && (match(f.label) || match(group)));
          if (!rows.length) return null;
          return (
            <details key={group} className="rounded-lg border border-border" open={!!needle} data-access-group={group}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 font-medium">
                <span>{group}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {LEVELS.map((l) => {
                    const off = !value[modulesKey(l.key)].includes(group);
                    const n = rows.filter((r) => value[sectionsKey(l.key)].includes(r.key)).length;
                    return `${l.short}: ${off ? 'module off' : n ? `${n} hidden` : 'all'}`;
                  }).join(' · ')}
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[28rem] text-left">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        Section
                      </th>
                      <th scope="col" className="w-20 px-2 py-1.5 text-center font-medium">
                        Super
                      </th>
                      {LEVELS.map((l) => (
                        <th key={l.key} scope="col" className="w-24 px-2 py-1.5 text-center font-medium">
                          {l.short}
                          {!disabled && value[modulesKey(l.key)].includes(group) && (
                            <span className="ms-1 inline-flex gap-1">
                              <button type="button" className="underline" onClick={() => setGroup(l.key, rows.map((r) => r.key), true)} aria-label={`${l.short}: show all of ${group}`}>
                                all
                              </button>
                              <button type="button" className="underline" onClick={() => setGroup(l.key, rows.map((r) => r.key), false)} aria-label={`${l.short}: hide all of ${group}`}>
                                none
                              </button>
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.key} className="border-t border-border/60" data-access-section={f.key}>
                        <th scope="row" className={`px-3 py-1.5 font-normal ${f.parent ? 'ps-7' : ''}`}>
                          {f.label}
                        </th>
                        <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">Always</td>
                        {LEVELS.map((l) => {
                          const moduleOff = !value[modulesKey(l.key)].includes(group);
                          return (
                            <td key={l.key} className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                disabled={disabled || moduleOff}
                                checked={!moduleOff && !value[sectionsKey(l.key)].includes(f.key)}
                                onChange={(e) => setSection(l.key, f.key, e.target.checked)}
                                aria-label={`${l.label} may see ${f.label}`}
                                title={moduleOff ? `The ${group} module is off for ${l.label}` : undefined}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>

      <div className="space-y-2" data-access-fields="">
        {FIELD_ENTITIES.map((entity) => {
          const rows = FIELD_ACCESS_CATALOGUE.filter((f) => f.entity === entity && (match(f.label) || match(FIELD_ENTITY_LABEL[entity])));
          if (!rows.length) return null;
          return (
            <details key={entity} className="rounded-lg border border-border" open={!!needle} data-access-entity={entity}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 font-medium">
                <span>{FIELD_ENTITY_LABEL[entity]} fields</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {LEVELS.map((l) => {
                    const n = rows.filter((r) => value[fieldsKey(l.key)].includes(r.id)).length;
                    return `${l.short}: ${n ? `${n} hidden` : 'all'}`;
                  }).join(' · ')}
                </span>
              </summary>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[28rem] text-left">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-1.5 font-medium">
                        Field
                      </th>
                      <th scope="col" className="w-20 px-2 py-1.5 text-center font-medium">
                        Super
                      </th>
                      {LEVELS.map((l) => (
                        <th key={l.key} scope="col" className="w-24 px-2 py-1.5 text-center font-medium">
                          {l.short}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.id} className="border-t border-border/60" data-access-field={f.id}>
                        <th scope="row" className="px-3 py-1.5 font-normal">
                          {f.label}
                        </th>
                        <td className="px-2 py-1.5 text-center text-xs text-muted-foreground">Always</td>
                        {LEVELS.map((l) => (
                          <td key={l.key} className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={!value[fieldsKey(l.key)].includes(f.id)}
                              onChange={(e) => setField(l.key, f.id, e.target.checked)}
                              aria-label={`${l.label} may see ${FIELD_ENTITY_LABEL[entity]} ${f.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
        <p className="text-xs text-muted-foreground">
          A hidden field shows as empty for that level everywhere (lists, record pages, the API) and cannot be changed by it. Names, owners and statuses always show.
        </p>
      </div>
    </div>
  );
}

/** The client profile's switches for the separate Leads and Accounts pages (moved here from the client's Settings). */
export function ClientMenuSectionsCard({ tenantId, admin }: { tenantId: string; admin: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const key = ['operator', 'menu-sections', tenantId];
  const q = useQuery({ queryKey: key, queryFn: () => api<MenuSections>(`/operator/workspace-rules/clients/${tenantId}/menu-sections`) });
  const [draft, setDraft] = useState<MenuSections | null>(null);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState('');
  const save = useMutation({
    mutationFn: (next: MenuSections) => api<MenuSections>(`/operator/workspace-rules/clients/${tenantId}/menu-sections`, { method: 'PUT', json: { ...next, reason } }),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      setDraft(null);
      setReason('');
      setSaved('Saved. The client sees the change on its next page load.');
    },
  });
  if (!q.data) return <ErrorText error={q.error} />;
  const value = draft ?? q.data;
  const rows = [
    { key: 'leads', label: 'Show the Inbound contacts page', text: 'A separate list for inbound contacts. Off: they live with their companies and contacts.' },
    { key: 'accounts', label: 'Show the Accounts page', text: 'A separate list of accounts. Off: Companies is the account list.' },
  ] as const;
  return (
    <Card className="space-y-3 p-5" aria-labelledby={`${id}-h`} data-client-menu-sections="">
      <h2 id={`${id}-h`} className="font-medium">
        Hidden sections
      </h2>
      <p className="text-sm text-muted-foreground">Inbound contacts and Accounts are hidden in every workspace of this client until switched on here.</p>
      {rows.map((r) => (
        <label key={r.key} className="flex items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            role="switch"
            className="mt-1"
            disabled={!admin || save.isPending}
            checked={value[r.key]}
            onChange={(e) => (setSaved(''), setDraft({ ...value, [r.key]: e.target.checked }))}
          />
          <span>
            <span className="block text-sm font-medium">{r.label}</span>
            <span className="block text-xs text-muted-foreground">{r.text}</span>
          </span>
        </label>
      ))}
      {admin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              Reason
            </label>
            <Input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the sections change" />
          </div>
          <Button disabled={!draft || save.isPending || reason.trim().length < 3} onClick={() => draft && save.mutate(draft)}>
            Save sections
          </Button>
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {saved}
      </p>
      <ErrorText error={save.error} />
    </Card>
  );
}
