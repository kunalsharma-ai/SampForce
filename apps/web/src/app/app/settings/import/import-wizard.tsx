'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field } from '@dealflow/ui';
import { type ImportEntity, type ImportResult, parseCsv } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { UploadZone } from '@/components/forms/upload-zone';
import { useCustomFields } from '@/lib/crm';
import { fmtLocale } from '@/lib/i18n/locale';

const MAX_BYTES = 2_000_000;
const LABELS: Record<string, string> = {
  fullName: 'Full name', companyName: 'Company', jobTitle: 'Job title', industry: 'Industry', email: 'Email', phone: 'Phone', country: 'Country (ISO)',
  city: 'City', timezone: 'Time zone', website: 'Website', source: 'Source', campaignSource: 'Campaign', estimatedValue: 'Estimated value', currency: 'Currency',
  status: 'Status', tags: 'Tags', firstName: 'First name', lastName: 'Last name', name: 'Name', domain: 'Domain',
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string> = { name: 'fullName', fullname: 'fullName', company: 'companyName', companyname: 'companyName', organization: 'companyName', title: 'jobTitle', jobtitle: 'jobTitle', emailaddress: 'email', mobile: 'phone', phonenumber: 'phone', firstname: 'firstName', lastname: 'lastName', surname: 'lastName', website: 'website', url: 'website' };

export function ImportWizard() {
  const qc = useQueryClient();
  const initial = useSearchParams().get('entity');
  const [entity, setEntity] = useState<ImportEntity>(initial === 'contacts' || initial === 'companies' ? initial : 'leads');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'create'>('skip');
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  const fields = useQuery({ queryKey: ['import-fields'], queryFn: () => api<Record<ImportEntity, string[]>>('/imports/fields'), staleTime: Infinity });
  const custom = useCustomFields(entity);
  const targets = useMemo(
    () => [...(fields.data?.[entity] ?? []).map((f) => ({ value: f, label: LABELS[f] ?? f })), ...(custom.data ?? []).map((d) => ({ value: `customFields.${d.key}`, label: `${d.label} (custom)` }))],
    [fields.data, custom.data, entity],
  );
  const rows = useMemo(() => (csv ? parseCsv(csv) : []), [csv]);
  const headers = rows[0] ?? [];
  const preview = rows.slice(1, 4);

  function autoMap(hs: string[], ent: ImportEntity) {
    const available = new Set([...(fields.data?.[ent] ?? []), ...(custom.data ?? []).map((d) => `customFields.${d.key}`)]);
    const next: Record<string, string> = {};
    for (const h of hs) {
      const n = norm(h);
      let target = [...available].find((t) => norm(t) === n) ?? ALIASES[n];
      if (ent === 'companies' && (n === 'name' || n === 'company' || n === 'companyname')) target = 'name';
      if (target && available.has(target) && !Object.values(next).includes(target)) next[h] = target;
    }
    setMapping(next);
  }

  async function onFile(file: File | undefined) {
    setChecked(null);
    setDone(null);
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError('This file is larger than 2 MB. Split it into smaller files.');
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setFileSize(file.size);
    setCsv(text);
    autoMap(parseCsv(text)[0] ?? [], entity);
  }

  // The field list may arrive after the file was chosen; map automatically once it does.
  const fieldsReady = !!fields.data && !custom.isPending;
  useEffect(() => {
    if (fieldsReady && headers.length && Object.keys(mapping).length === 0) autoMap(headers, entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the inputs to auto-mapping become available
  }, [fieldsReady, csv]);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api<ImportResult>('/imports', { method: 'POST', json: { entity, csv, mapping, duplicateStrategy, dryRun } }),
    onSuccess: (r) => {
      if (r.dryRun) setChecked(r);
      else {
        setDone(r);
        void qc.invalidateQueries({ queryKey: [entity] });
      }
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a file</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="import-entity" label="Import into">
            <Select
              value={entity}
              onChange={(e) => {
                const ent = e.target.value as ImportEntity;
                setEntity(ent);
                setChecked(null);
                setDone(null);
                autoMap(headers, ent);
              }}
            >
              <option value="leads">Leads</option>
              <option value="contacts">Contacts</option>
              <option value="companies">Companies</option>
            </Select>
          </Field>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-sm font-medium">CSV file</p>
            <UploadZone
              label="Choose a CSV file"
              accept={['.csv', 'text/csv']}
              maxBytes={MAX_BYTES}
              hint="CSV up to 2 MB. The first row must contain column names."
              file={fileName && !fileError ? { name: fileName, size: fileSize } : null}
              onFile={(f) => void onFile(f)}
            />
            {fileError && (
              <p role="alert" className="text-xs text-critical">
                {fileError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Match columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Column mapping</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-2 font-medium">Column in file</th>
                    <th scope="col" className="pb-2 font-medium">Sample values</th>
                    <th scope="col" className="w-56 pb-2 font-medium">DealFlow field</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={`${h}-${i}`} className="border-t border-border">
                      <td className="py-2 font-medium">{h || <span className="text-muted-foreground">(blank)</span>}</td>
                      <td className="max-w-[16rem] truncate py-2 text-muted-foreground">{preview.map((r) => r[i]).filter(Boolean).join(' · ')}</td>
                      <td className="py-2">
                        <Select
                          aria-label={`Field for column ${h}`}
                          className="h-9"
                          value={mapping[h] ?? ''}
                          onChange={(e) => {
                            setChecked(null);
                            setMapping((m) => ({ ...m, [h]: e.target.value }));
                          }}
                        >
                          <option value="">Don’t import</option>
                          {targets.map((t) => (
                            <option key={t.value} value={t.value} disabled={Object.entries(mapping).some(([col, v]) => v === t.value && col !== h)}>
                              {t.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Field id="import-dupes" label="When a row matches an existing record (same email or phone; for companies, same name or domain)">
              <Select value={duplicateStrategy} onChange={(e) => { setDuplicateStrategy(e.target.value as 'skip' | 'create'); setChecked(null); }}>
                <option value="skip">Skip the row</option>
                <option value="create">Import it anyway</option>
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>
                Check file
              </Button>
              <Button onClick={() => run.mutate(false)} disabled={!checked || checked.created === 0 || run.isPending || !!done}>
                <FileUp aria-hidden /> Import {checked ? checked.created.toLocaleString(fmtLocale()) : ''} rows
              </Button>
              {!checked && <span className="text-xs text-muted-foreground">Check the file first; nothing is saved during the check.</span>}
            </div>
            {run.error && (
              <p role="alert" className="text-sm text-critical">
                {run.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {(checked || done) && <ResultCard result={(done ?? checked)!} entity={entity} />}
    </div>
  );
}

function ResultCard({ result, entity }: { result: ImportResult; entity: ImportEntity }) {
  return (
    <Card className={result.dryRun ? undefined : 'border-success/50'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {!result.dryRun && <CheckCircle2 className="size-4 text-success" aria-hidden />}
          {result.dryRun ? '3. Check results' : 'Import complete'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm" aria-live="polite">
        <div className="flex flex-wrap gap-2">
          <Badge>{result.totalRows} rows</Badge>
          <Badge tone="success">
            {result.created} {result.dryRun ? 'ready to import' : 'imported'}
          </Badge>
          <Badge tone="warning">{result.skippedDuplicates} duplicates skipped</Badge>
          <Badge tone={result.errors.length ? 'critical' : 'neutral'}>{result.errors.length} with errors</Badge>
        </div>
        {result.errors.length > 0 && (
          <div className="max-h-60 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">Rows with errors</caption>
              <thead className="sticky top-0 bg-muted text-start">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">Row</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.slice(0, 200).map((e) => (
                  <tr key={e.row} className="border-t border-border">
                    <td className="px-3 py-1.5 tabular-nums">{e.row}</td>
                    <td className="px-3 py-1.5">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!result.dryRun && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${entity}`}>View {entity}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
