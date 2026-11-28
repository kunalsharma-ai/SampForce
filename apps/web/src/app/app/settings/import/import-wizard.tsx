'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field } from '@dealflow/ui';
import {
  combinedImportTargets,
  type CustomFieldDef,
  customFieldLabelFor,
  headingSide,
  IMPORT_FIELD_ALIASES,
  type ImportEntity,
  type ImportFileResult,
  type ImportResult,
  type ImportTarget,
  parseCsv,
  suggestMapping,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { UploadZone } from '@/components/forms/upload-zone';
import { useCustomFields } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const MAX_BYTES = 2_000_000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LABELS: Record<string, MessageKey> = {
  fullName: 'Full name', companyName: 'Company', jobTitle: 'Job title', industry: 'Industry', email: 'Email', phone: 'Phone', country: 'Country',
  city: 'City', state: 'State', timezone: 'Time zone', website: 'Website', source: 'Source', campaignSource: 'Campaign', estimatedValue: 'Estimated value', currency: 'Currency',
  status: 'Status', tags: 'Tags', firstName: 'First name', lastName: 'Last name', name: 'Name', domain: 'Domain', linkedinUrl: 'LinkedIn URL', department: 'Department',
  address: 'Address', postalCode: 'Postal code', primaryEmail: 'Company email', primaryPhone: 'Company phone', companySize: 'Company size', companyType: 'Company type',
  notes: 'Notes', remarks: 'Remarks',
};
const VIEW: Record<ImportEntity, MessageKey> = { leads: 'View inbound contacts', contacts: 'View contacts', companies: 'View companies', companies_contacts: 'View companies' };
const ENTITY_FIELDS: Record<Exclude<ImportEntity, 'companies_contacts'>, 'leads' | 'contacts' | 'companies'> = { leads: 'leads', contacts: 'contacts', companies: 'companies' };
/** Custom fields a column can fill: not calculated ones, not files, and only ones the person may edit. */
const usable = (list: CustomFieldDef[] | undefined) => (list ?? []).filter((d) => d.type !== 'FORMULA' && d.type !== 'FILE' && d.access.edit);
const isNew = (target: string | undefined) => target === 'new' || target === 'new:company' || target === 'new:contact';

/**
 * Settings → Import (ADR 0066). Headings are matched to fields as the file is read, typos and synonyms included;
 * columns no field matches become new custom fields for people who configure the CRM. One row can be a company and
 * one of its employees. CSV and Excel (.xlsx) files.
 */
export function ImportWizard() {
  const t = useT();
  const qc = useQueryClient();
  const initial = useSearchParams().get('entity');
  const [entity, setEntity] = useState<ImportEntity>(initial === 'leads' || initial === 'contacts' || initial === 'companies' ? initial : 'companies_contacts');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [sheet, setSheet] = useState<string | null>(null);
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'create'>('skip');
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const canAddFields = useCan('crm:configure');

  const fields = useQuery({ queryKey: ['import-fields'], queryFn: () => api<Record<ImportEntity, string[]>>('/imports/fields'), staleTime: Infinity });
  const leadFields = useCustomFields('leads');
  const contactFields = useCustomFields('contacts');
  const companyFields = useCustomFields('companies');
  const leadDefs = leadFields.data;
  const contactDefs = contactFields.data;
  const companyDefs = companyFields.data;

  /** Every field a column can go into, grouped for the menu, with the names automatic matching looks for. */
  const groups = useMemo(() => {
    const list = fields.data?.[entity] ?? [];
    const label = (f: string) => (LABELS[f] ? t(LABELS[f]) : f);
    const custom = (prefix: string, defs: CustomFieldDef[]) => defs.map((d) => ({ value: `${prefix}customFields.${d.key}`, label: d.label, aliases: [d.key] }));
    if (entity === 'companies_contacts') {
      const targets = combinedImportTargets(list);
      const side = (s: 'company' | 'contact') => targets.filter((x) => x.value.startsWith(`${s}.`)).map((x) => ({ ...x, label: label(x.value.slice(s.length + 1)) }));
      return [
        { label: t('Company'), options: [...side('company'), ...custom('company.', usable(companyDefs))] },
        { label: t('Employee'), options: [...side('contact'), ...custom('contact.', usable(contactDefs))] },
      ];
    }
    const defs = usable({ leads: leadDefs, contacts: contactDefs, companies: companyDefs }[ENTITY_FIELDS[entity]]);
    const own = list.map((value) => ({ value, label: label(value), aliases: IMPORT_FIELD_ALIASES[value] }));
    return [{ label: t('Fields'), options: [...own, ...custom('', defs)] }];
  }, [fields.data, entity, leadDefs, contactDefs, companyDefs, t]);
  const targets: (ImportTarget & { label: string })[] = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  const rows = useMemo(() => (csv ? parseCsv(csv) : []), [csv]);
  const headers = rows[0] ?? [];
  const preview = rows.slice(1, 4);
  const hasValues = (i: number) => rows.slice(1).some((r) => (r[i] ?? '').trim() !== '');

  function autoMap(hs: string[], ent: ImportEntity) {
    const next: Record<string, string> = suggestMapping(hs, targets);
    hs.forEach((h, i) => {
      if (!h.trim() || h in next) return;
      // Columns nothing matches become new fields (for people who may add fields); empty columns are left out.
      next[h] = canAddFields && hasValues(i) ? (ent === 'companies_contacts' ? `new:${headingSide(h)}` : 'new') : '';
    });
    setMapping(next);
  }

  async function onFile(file: File | undefined) {
    setChecked(null);
    setDone(null);
    setFileError(null);
    setSheet(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError(t('This file is larger than 2 MB. Split it into smaller files.'));
      return;
    }
    setReading(true);
    try {
      let text: string;
      if (/\.xlsx$/i.test(file.name) || file.type === XLSX) {
        const read = await api<ImportFileResult>('/imports/file', { method: 'POST', body: file, headers: { 'content-type': XLSX } });
        text = read.csv;
        setSheet(read.sheet);
      } else text = await file.text();
      setFileName(file.name);
      setFileSize(file.size);
      setMapping({});
      setCsv(text);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : t('Could not read this file.'));
    } finally {
      setReading(false);
    }
  }

  // Map automatically once the file and the field lists are both there, and again when the record type changes.
  const fieldsReady = !!fields.data && !leadFields.isPending && !contactFields.isPending && !companyFields.isPending;
  useEffect(() => {
    if (fieldsReady && headers.length) autoMap(headers, entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the inputs to auto-mapping change
  }, [fieldsReady, csv, entity]);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api<ImportResult>('/imports', { method: 'POST', json: { entity, csv, mapping, duplicateStrategy, dryRun } }),
    onSuccess: (r) => {
      if (r.dryRun) setChecked(r);
      else {
        setDone(r);
        for (const key of entity === 'companies_contacts' ? ['companies', 'contacts', 'custom-fields'] : [entity, 'custom-fields', 'companies']) void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const matched = Object.values(mapping).filter((v) => v && !isNew(v)).length;
  const adding = Object.values(mapping).filter(isNew).length;
  const combinedHint = entity !== 'companies_contacts' && headers.some((h) => headingSide(h) === 'contact' && /employee|contact|poc/i.test(h)) && headers.some((h) => /company|organi[sz]ation/i.test(h));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('1. Choose a file')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="import-entity" label={t('Import into')}>
            <Select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as ImportEntity);
                setChecked(null);
                setDone(null);
              }}
            >
              <option value="companies_contacts">{t('Companies with their employees')}</option>
              <option value="leads">{t('Inbound contacts')}</option>
              <option value="contacts">{t('Contacts')}</option>
              <option value="companies">{t('Companies')}</option>
            </Select>
          </Field>
          <p className="self-end pb-2 text-xs text-muted-foreground sm:pb-3">
            {entity === 'companies_contacts'
              ? t('Each row is a company and one of its employees. Rows with the same company name become one company; companies you already have are matched by name or website.')
              : t('Each row becomes one record.')}
          </p>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-sm font-medium">{t('CSV or Excel file')}</p>
            <UploadZone
              label={t('Choose a CSV or Excel file')}
              accept={['.csv', '.xlsx']}
              maxBytes={MAX_BYTES}
              hint={t('CSV or Excel (.xlsx) up to 2 MB. The first row must contain column names; any names work.')}
              file={fileName && !fileError ? { name: fileName, size: fileSize } : null}
              onFile={(f) => void onFile(f)}
            />
            {reading && <p className="text-xs text-muted-foreground">{t('Reading the file…')}</p>}
            {sheet && <p className="text-xs text-muted-foreground">{t('Read from the sheet “{sheet}”.', { sheet })}</p>}
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
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">{t('2. Match columns')}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">
                <Wand2 aria-hidden className="size-3" /> {t('{count} matched', { count: matched })}
              </Badge>
              {adding > 0 && (
                <Badge tone="primary">
                  <Sparkles aria-hidden className="size-3" /> {t('{count} new fields', { count: adding })}
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => autoMap(headers, entity)}>
                {t('Match again')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {combinedHint && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <span className="flex-1">{t('This file has company and employee columns. Import each row as a company with its employee?')}</span>
                <Button size="sm" variant="outline" onClick={() => setEntity('companies_contacts')}>
                  {t('Import as companies with their employees')}
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {canAddFields
                ? t('Headings are matched to fields even with different spelling or small typos. Columns that match no field are added as new custom fields when you import.')
                : t('Headings are matched to fields even with different spelling or small typos. Columns that match no field are left out; an administrator can add fields for them.')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <caption className="sr-only">{t('Column mapping')}</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-2 text-start font-medium">{t('Column in file')}</th>
                    <th scope="col" className="pb-2 text-start font-medium">{t('Sample values')}</th>
                    <th scope="col" className="w-64 pb-2 text-start font-medium">{t('SampForce field')}</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => {
                    const value = mapping[h] ?? '';
                    return (
                      <tr key={`${h}-${i}`} className="border-t border-border align-top">
                        <td className="py-2 pe-3 font-medium">{h || <span className="text-muted-foreground">{t('(blank)')}</span>}</td>
                        <td className="max-w-[16rem] truncate py-2 pe-3 text-muted-foreground">{preview.map((r) => r[i]).filter(Boolean).join(' · ')}</td>
                        <td className="py-2">
                          <Select
                            aria-label={t('Field for column {column}', { column: h })}
                            className="h-9"
                            value={value}
                            disabled={!h}
                            onChange={(e) => {
                              setChecked(null);
                              setMapping((m) => ({ ...m, [h]: e.target.value }));
                            }}
                          >
                            <option value="">{t('Don’t import')}</option>
                            {canAddFields &&
                              (entity === 'companies_contacts' ? (
                                <optgroup label={t('Add as a new field')}>
                                  <option value="new:company">{t('New company field')}</option>
                                  <option value="new:contact">{t('New employee field')}</option>
                                </optgroup>
                              ) : (
                                <option value="new">{t('New field')}</option>
                              ))}
                            {groups.map((g) => (
                              <optgroup key={g.label} label={g.label}>
                                {g.options.map((f) => (
                                  <option key={f.value} value={f.value} disabled={Object.entries(mapping).some(([col, v]) => v === f.value && col !== h)}>
                                    {f.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </Select>
                          {isNew(value) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t('Adds the text field “{label}”.', { label: customFieldLabelFor(h) })}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Field
              id="import-dupes"
              label={
                entity === 'companies_contacts'
                  ? t('When an employee is already in SampForce (same email, phone or LinkedIn)')
                  : t('When a row matches an existing record (same email or phone; for companies, same name or domain)')
              }
            >
              <Select value={duplicateStrategy} onChange={(e) => { setDuplicateStrategy(e.target.value as 'skip' | 'create'); setChecked(null); }}>
                <option value="skip">{t('Skip the row')}</option>
                <option value="create">{t('Import it anyway')}</option>
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>
                {t('Check file')}
              </Button>
              <Button onClick={() => run.mutate(false)} disabled={!checked || checked.created === 0 || run.isPending || !!done}>
                <FileUp aria-hidden /> {t('Import {count} rows', { count: checked ? checked.created : '' })}
              </Button>
              {!checked && <span className="text-xs text-muted-foreground">{t('Check the file first; nothing is saved during the check.')}</span>}
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
  const t = useT();
  const combined = entity === 'companies_contacts';
  return (
    <Card className={result.dryRun ? undefined : 'border-success/50'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {!result.dryRun && <CheckCircle2 className="size-4 text-success" aria-hidden />}
          {result.dryRun ? t('3. Check results') : t('Import complete')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm" aria-live="polite">
        <div className="flex flex-wrap gap-2">
          <Badge>{t('{count} rows', { count: result.totalRows })}</Badge>
          <Badge tone="success">
            {result.dryRun ? t('{count} ready to import', { count: result.created }) : t('{count} imported', { count: result.created })}
          </Badge>
          <Badge tone="warning">{t('{count} duplicates skipped', { count: result.skippedDuplicates })}</Badge>
          <Badge tone={result.errors.length ? 'critical' : 'neutral'}>{t('{count} with errors', { count: result.errors.length })}</Badge>
        </div>
        {combined && (
          <ul className="grid gap-1 sm:grid-cols-3">
            <li>{result.dryRun ? t('New companies to add: {count}', { count: result.companiesCreated ?? 0 }) : t('New companies added: {count}', { count: result.companiesCreated ?? 0 })}</li>
            <li>{t('Existing companies matched: {count}', { count: result.companiesMatched ?? 0 })}</li>
            <li>{result.dryRun ? t('Employees to add: {count}', { count: result.contactsCreated ?? 0 }) : t('Employees added: {count}', { count: result.contactsCreated ?? 0 })}</li>
          </ul>
        )}
        {!!result.newFields?.length && (
          <div>
            <p className="font-medium">{result.dryRun ? t('New custom fields this import adds') : t('New custom fields added')}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {result.newFields.map((f) => (
                <li key={`${f.entity}.${f.key}`}>
                  <Badge tone="primary">
                    {f.label} · {f.entity === 'COMPANY' ? t('Company') : f.entity === 'CONTACT' ? t('Employee') : t('Inbound contact')}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.errors.length > 0 && (
          <div className="max-h-60 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <caption className="sr-only">{t('Rows with errors')}</caption>
              <thead className="sticky top-0 bg-muted text-start">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">{t('Row')}</th>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">{t('Problem')}</th>
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
            <Link href={`/app/${combined ? 'companies' : entity}`}>{t(VIEW[entity])}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
