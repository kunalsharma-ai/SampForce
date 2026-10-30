'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import {
  DATE_BUCKETS,
  type FilterOp,
  MAX_REPORT_FILTERS,
  MAX_REPORT_ROWS,
  OPS_FOR_KIND,
  REPORT_CATALOG,
  REPORT_CHARTS,
  REPORT_ENTITIES,
  REPORT_TEMPLATES,
  type ReportDefinition,
  type ReportEntity,
  type ReportFilter,
  type ReportRow,
  type ReportVisibility,
  reportDefinitionSchema,
  reportField,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Save, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ReportView } from '@/components/reports/report-view';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, downloadFile } from '@/lib/api';
import { useMembers } from '@/lib/crm';
import { useReport, useReportResult } from '@/lib/reports';
import { useCan } from '@/lib/session';

const METRIC_LABEL = {
  count: 'Count of records',
  sum: 'Sum of',
  avg: 'Average of',
  min: 'Lowest',
  max: 'Highest',
} as const;
const CHART_LABEL = {
  table: 'Table',
  bar: 'Bar chart',
  line: 'Line chart (over time)',
  pie: 'Pie chart',
  number: 'Single number',
} as const;
const SORT_LABEL = {
  value_desc: 'Largest value first',
  value_asc: 'Smallest value first',
  label_asc: 'Group A to Z / oldest first',
  label_desc: 'Group Z to A / newest first',
} as const;
const OP_LABEL: Record<FilterOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  contains: 'contains',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  is_empty: 'is empty',
  not_empty: 'is not empty',
  last_n_days: 'in the last … days',
};
const DATE_OP_LABEL: Partial<Record<FilterOp, string>> = {
  gte: 'is on or after',
  lte: 'is on or before',
};

const plural = (noun: string, n: number) =>
  n === 1 ? noun : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`;

const blank = (entity: ReportEntity = 'deals'): ReportDefinition => ({
  entity,
  metric: { fn: 'count' },
  groupBy: null,
  filters: [],
  chart: 'table',
  sort: 'value_desc',
  limit: 20,
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ReportEditor({ id }: { id?: string }) {
  const existing = useReport(id);
  if (id && existing.isPending) return <Skeleton className="h-96" />;
  if (id && existing.error) return <ErrorText error={existing.error} />;
  return <Editor report={existing.data} key={existing.data?.id ?? 'new'} />;
}

function Editor({ report }: { report?: ReportRow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const canWrite = useCan('reports:write');
  const canExport = useCan('data:export');
  const templateParam = params.get('template');
  const template = templateParam === null ? undefined : REPORT_TEMPLATES[Number(templateParam)];
  const readOnly = !!report && !report.editable;
  const [name, setName] = useState(report?.name ?? template?.name ?? '');
  const [description, setDescription] = useState(report?.description ?? '');
  const [visibility, setVisibility] = useState<ReportVisibility>(report?.visibility ?? 'PRIVATE');
  const [def, setDef] = useState<ReportDefinition>(
    report?.definition ?? template?.definition ?? blank(),
  );
  const parsed = useMemo(() => reportDefinitionSchema.safeParse(def), [def]);
  const debounced = useDebounced(parsed.success ? parsed.data : null, 350);
  const result = useReportResult(debounced);
  const [saveError, setSaveError] = useState<Error | null>(null);

  const save = useMutation({
    mutationFn: (asCopy: boolean) => {
      const body = {
        name: asCopy ? `${name} (copy)` : name,
        description: description || null,
        visibility: asCopy ? 'PRIVATE' : visibility,
        definition: def,
      };
      return report && !asCopy
        ? api<ReportRow>(`/reports/${report.id}`, { method: 'PUT', json: body })
        : api<ReportRow>('/reports', { method: 'POST', json: body });
    },
    onSuccess: (row) => {
      setSaveError(null);
      void qc.invalidateQueries({ queryKey: ['reports'] });
      if (row.id !== report?.id) router.push(`/app/reports/${row.id}`);
    },
    onError: (e: Error) => setSaveError(e),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/reports/${report!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
      router.push('/app/reports');
    },
    onError: (e: Error) => setSaveError(e),
  });

  const entity = REPORT_CATALOG[def.entity];
  const numeric = entity.fields.filter((f) => f.kind === 'number' || f.kind === 'money');
  const groupable = entity.fields.filter((f) => f.groupable);
  const groupField = def.groupBy ? reportField(def.entity, def.groupBy.field) : undefined;
  const issues = parsed.success ? [] : parsed.error.issues;
  const issueAt = (path: string) => issues.find((i) => i.path.join('.') === path)?.message;
  const patch = (p: Partial<ReportDefinition>) => setDef((d) => ({ ...d, ...p }));

  const setEntity = (e: ReportEntity) => setDef(blank(e));
  const setMetric = (fn: ReportDefinition['metric']['fn']) =>
    patch({
      metric:
        fn === 'count'
          ? { fn }
          : {
              fn,
              field:
                def.metric.field && numeric.some((f) => f.key === def.metric.field)
                  ? def.metric.field
                  : numeric[0]?.key,
            },
    });
  const setGroup = (key: string) => {
    if (!key)
      return patch({
        groupBy: null,
        chart: def.chart === 'number' || def.chart === 'table' ? def.chart : 'table',
      });
    const f = reportField(def.entity, key)!;
    patch({
      groupBy:
        f.kind === 'date' ? { field: key, bucket: def.groupBy?.bucket ?? 'month' } : { field: key },
      chart:
        def.chart === 'number'
          ? 'bar'
          : def.chart === 'line' && f.kind !== 'date'
            ? 'bar'
            : def.chart,
      sort: f.kind === 'date' ? 'label_asc' : def.sort,
    });
  };
  const charts = REPORT_CHARTS.filter((c) =>
    def.groupBy
      ? c !== 'number' && (c !== 'line' || groupField?.kind === 'date')
      : c === 'table' || c === 'number',
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        {report ? report.name : 'New report'}
      </h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {readOnly ? 'Definition' : report ? 'Edit report' : 'Build the report'}
            </CardTitle>
            {readOnly && (
              <p className="text-sm text-muted-foreground">
                Shared by {report.createdBy?.name ?? 'a former member'}. You can view it
                {canWrite ? ' or save your own copy' : ''}.
              </p>
            )}
          </CardHeader>
          <CardContent>
            <fieldset disabled={readOnly} className="space-y-4">
              <legend className="sr-only">Report definition</legend>
              <Field id="r-name" label="Name">
                <Input
                  id="r-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field id="r-entity" label="Records">
                <Select
                  id="r-entity"
                  value={def.entity}
                  onChange={(e) => setEntity(e.target.value as ReportEntity)}
                >
                  {REPORT_ENTITIES.map((e) => (
                    <option key={e} value={e}>
                      {REPORT_CATALOG[e].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="r-metric" label="Measure">
                  <Select
                    id="r-metric"
                    value={def.metric.fn}
                    onChange={(e) => setMetric(e.target.value as ReportDefinition['metric']['fn'])}
                  >
                    <option value="count">{METRIC_LABEL.count}</option>
                    {numeric.length > 0 &&
                      (['sum', 'avg', 'min', 'max'] as const).map((m) => (
                        <option key={m} value={m}>
                          {METRIC_LABEL[m]}
                        </option>
                      ))}
                  </Select>
                </Field>
                {def.metric.fn !== 'count' && (
                  <Field id="r-metric-field" label="Field" error={issueAt('metric.field')}>
                    <Select
                      id="r-metric-field"
                      value={def.metric.field ?? ''}
                      onChange={(e) =>
                        patch({ metric: { fn: def.metric.fn, field: e.target.value } })
                      }
                    >
                      {numeric.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field id="r-group" label="Group by">
                  <Select
                    id="r-group"
                    value={def.groupBy?.field ?? ''}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option value="">No grouping</option>
                    {groupable.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {groupField?.kind === 'date' && (
                  <Field id="r-bucket" label="By">
                    <Select
                      id="r-bucket"
                      value={def.groupBy?.bucket ?? 'month'}
                      onChange={(e) =>
                        patch({
                          groupBy: {
                            field: def.groupBy!.field,
                            bucket: e.target.value as (typeof DATE_BUCKETS)[number],
                          },
                        })
                      }
                    >
                      {DATE_BUCKETS.map((b) => (
                        <option key={b} value={b}>
                          {b.charAt(0).toUpperCase() + b.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <Filters def={def} onChange={(filters) => patch({ filters })} issueAt={issueAt} />
              <div className="grid grid-cols-2 gap-3">
                <Field id="r-chart" label="Show as" error={issueAt('chart')}>
                  <Select
                    id="r-chart"
                    value={def.chart}
                    onChange={(e) => patch({ chart: e.target.value as ReportDefinition['chart'] })}
                  >
                    {charts.map((c) => (
                      <option key={c} value={c}>
                        {CHART_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {def.groupBy && (
                  <Field id="r-limit" label="Rows">
                    <Input
                      id="r-limit"
                      type="number"
                      min={1}
                      max={MAX_REPORT_ROWS}
                      value={def.limit}
                      onChange={(e) =>
                        patch({
                          limit: Math.max(
                            1,
                            Math.min(MAX_REPORT_ROWS, Number(e.target.value) || 1),
                          ),
                        })
                      }
                    />
                  </Field>
                )}
              </div>
              {def.groupBy && (
                <Field id="r-sort" label="Order">
                  <Select
                    id="r-sort"
                    value={def.sort}
                    onChange={(e) => patch({ sort: e.target.value as ReportDefinition['sort'] })}
                  >
                    {Object.entries(SORT_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                id="r-visibility"
                label="Who can see it"
                hint={
                  visibility === 'WORKSPACE'
                    ? 'Everyone in the workspace with report access. Each person still only sees records their role can read.'
                    : 'Only you.'
                }
              >
                <Select
                  id="r-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ReportVisibility)}
                >
                  <option value="PRIVATE">Only me</option>
                  <option value="WORKSPACE">Shared with the workspace</option>
                </Select>
              </Field>
              <Field id="r-desc" label="Description (optional)">
                <Textarea
                  id="r-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </Field>
            </fieldset>
            <div className="mt-5 flex flex-wrap gap-2">
              {!readOnly && canWrite && (
                <Button
                  onClick={() => save.mutate(false)}
                  disabled={!parsed.success || !name.trim() || save.isPending}
                >
                  <Save aria-hidden /> {report ? 'Save changes' : 'Save report'}
                </Button>
              )}
              {report && canWrite && (
                <Button
                  variant="outline"
                  onClick={() => save.mutate(true)}
                  disabled={!parsed.success || save.isPending}
                >
                  <Copy aria-hidden /> Save a copy
                </Button>
              )}
              {report && canExport && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void downloadFile(`/reports/${report.id}/export`, 'report.csv').catch(
                      setSaveError,
                    )
                  }
                >
                  <Download aria-hidden /> Export CSV
                </Button>
              )}
              {report && !readOnly && (
                <Button
                  variant="ghost"
                  className="text-critical"
                  onClick={() =>
                    window.confirm(
                      `Delete “${report.name}”? It is also removed from any dashboards.`,
                    ) && remove.mutate()
                  }
                  disabled={remove.isPending}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              )}
            </div>
            {report && (
              <p className="mt-2 text-xs text-muted-foreground">
                Export uses the saved version of the report.
              </p>
            )}
            <div className="mt-3">
              <ErrorText error={saveError} />
            </div>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{name.trim() || 'Preview'}</CardTitle>
            {result.data && (
              <p className="text-sm text-muted-foreground">
                {result.data.records.toLocaleString('en-US')}{' '}
                {plural(entity.noun, result.data.records)} match
                {result.data.records === 1 ? 'es' : ''}
                {result.isFetching ? ' · updating…' : ''}
              </p>
            )}
          </CardHeader>
          <CardContent aria-live="polite" aria-busy={result.isFetching}>
            {!parsed.success ? (
              <ul className="space-y-1 text-sm text-warning">
                {issues.map((i) => (
                  <li key={`${i.path.join('.')}-${i.message}`}>Finish the report: {i.message}.</li>
                ))}
              </ul>
            ) : result.error ? (
              <ErrorText error={result.error} />
            ) : !result.data ? (
              <Skeleton className="h-64" />
            ) : (
              <ReportView result={result.data} chart={debounced?.chart ?? def.chart} height={320} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Filters({
  def,
  onChange,
  issueAt,
}: {
  def: ReportDefinition;
  onChange: (f: ReportFilter[]) => void;
  issueAt: (p: string) => string | undefined;
}) {
  const fields = REPORT_CATALOG[def.entity].fields;
  const set = (i: number, f: ReportFilter) =>
    onChange(def.filters.map((x, j) => (j === i ? f : x)));
  const add = () => {
    const f = fields.find((x) => x.kind === 'enum') ?? fields[0]!;
    onChange([...def.filters, defaultFilter(f.key, def.entity)]);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Filters</legend>
      {def.filters.length === 0 && (
        <p className="text-xs text-muted-foreground">
          All {REPORT_CATALOG[def.entity].label.toLowerCase()} are included.
        </p>
      )}
      {def.filters.map((flt, i) => {
        const field = reportField(def.entity, flt.field)!;
        const ops = OPS_FOR_KIND[field.kind];
        const err = issueAt(`filters.${i}.value`) ?? issueAt(`filters.${i}.op`);
        return (
          <div key={i} className="space-y-1 rounded-lg border border-border p-2">
            <div className="flex gap-2">
              <Select
                aria-label={`Filter ${i + 1} field`}
                value={flt.field}
                onChange={(e) => set(i, defaultFilter(e.target.value, def.entity))}
                className="min-w-0 flex-1"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() => onChange(def.filters.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex gap-2">
              <Select
                aria-label={`Filter ${i + 1} condition`}
                value={flt.op}
                onChange={(e) =>
                  set(i, {
                    field: flt.field,
                    op: e.target.value as FilterOp,
                    value: defaultValue(field.kind, e.target.value as FilterOp, field.options),
                  })
                }
                className="min-w-0 flex-1"
              >
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {(field.kind === 'date' && DATE_OP_LABEL[o]) || OP_LABEL[o]}
                  </option>
                ))}
              </Select>
              <FilterValue
                index={i}
                filter={flt}
                entity={def.entity}
                onChange={(value) => set(i, { ...flt, value })}
              />
            </div>
            {err && (
              <p className="text-xs text-critical" role="alert">
                {err}
              </p>
            )}
          </div>
        );
      })}
      {def.filters.length < MAX_REPORT_FILTERS && (
        <Button variant="outline" size="sm" onClick={add}>
          Add filter
        </Button>
      )}
    </fieldset>
  );
}

function defaultValue(
  kind: string,
  op: FilterOp,
  options?: readonly string[],
): ReportFilter['value'] {
  if (op === 'is_empty' || op === 'not_empty') return undefined;
  if (op === 'last_n_days') return 30;
  if (op === 'in') return options?.slice(0, 1) ?? [];
  if (kind === 'enum') return options?.[0];
  if (kind === 'boolean') return true;
  if (kind === 'number' || kind === 'money') return 0;
  if (kind === 'date') return new Date().toISOString().slice(0, 10);
  return '';
}

function defaultFilter(key: string, entity: ReportEntity): ReportFilter {
  const f = reportField(entity, key)!;
  const op = OPS_FOR_KIND[f.kind][0]!;
  return { field: key, op, value: defaultValue(f.kind, op, f.options) };
}

function FilterValue({
  index,
  filter,
  entity,
  onChange,
}: {
  index: number;
  filter: ReportFilter;
  entity: ReportEntity;
  onChange: (v: ReportFilter['value']) => void;
}) {
  const field = reportField(entity, filter.field)!;
  const members = useMembers();
  const label = `Filter ${index + 1} value`;
  const cls = 'min-w-0 flex-1';
  if (filter.op === 'is_empty' || filter.op === 'not_empty') return null;
  if (filter.op === 'last_n_days')
    return (
      <Input
        aria-label={`${label} (days)`}
        type="number"
        min={1}
        max={3660}
        value={Number(filter.value ?? 30)}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cls}
      />
    );
  if (filter.op === 'in' && field.kind === 'enum') {
    const v = (Array.isArray(filter.value) ? filter.value : []) as string[];
    return (
      <select
        aria-label={label}
        multiple
        value={v}
        onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        className={`${cls} h-20 rounded-md border border-input bg-background px-2 text-sm`}
      >
        {field.options!.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ').toLowerCase()}
          </option>
        ))}
      </select>
    );
  }
  if (filter.op === 'in') {
    const v = (Array.isArray(filter.value) ? filter.value : []) as string[];
    return (
      <Input
        aria-label={`${label} (comma separated)`}
        value={v.join(', ')}
        placeholder="DE, IN, US"
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        className={cls}
      />
    );
  }
  switch (field.kind) {
    case 'enum':
      return (
        <Select
          aria-label={label}
          value={String(filter.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          {field.options!.map((o) => (
            <option key={o} value={o}>
              {o.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </Select>
      );
    case 'boolean':
      return (
        <Select
          aria-label={label}
          value={String(filter.value)}
          onChange={(e) => onChange(e.target.value === 'true')}
          className={cls}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </Select>
      );
    case 'user':
      return (
        <Select
          aria-label={label}
          value={String(filter.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          <option value="">Choose a member</option>
          {members.data?.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case 'date':
      return (
        <Input
          aria-label={label}
          type="date"
          value={String(filter.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
    case 'number':
    case 'money':
      return (
        <Input
          aria-label={label}
          type="number"
          step="any"
          value={Number(filter.value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cls}
        />
      );
    case 'country':
      return (
        <Input
          aria-label={`${label} (two-letter code)`}
          maxLength={2}
          value={String(filter.value ?? '')}
          placeholder="DE"
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className={cls}
        />
      );
    default:
      return (
        <Input
          aria-label={label}
          value={String(filter.value ?? '')}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
  }
}
