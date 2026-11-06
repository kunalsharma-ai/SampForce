'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import {
  FORM_FIELD_KEYS,
  FORM_FIELD_LABELS,
  type FormFieldKey,
  type LeadFormRow,
  opsFor,
  SEGMENT_FIELDS,
  SEGMENT_OP_LABELS,
  type SegmentEntity,
  type SegmentOp,
  type SegmentPreview,
  type SegmentRow,
  type SegmentRule,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { api, downloadFile } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCampaigns, useForms, useSegments } from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { rich, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

export function MarketingWorkspace() {
  const t = useT();
  const [tab, setTab] = useState<'segments' | 'forms'>('segments');
  return (
    <>
      <Tabs label={t('Marketing sections')} value={tab} onChange={setTab} tabs={[{ key: 'segments', label: t('Segments') }, { key: 'forms', label: t('Lead forms') }]} />
      {tab === 'segments' ? <Segments /> : <Forms />}
    </>
  );
}

const NO_VALUE: SegmentOp[] = ['is_empty', 'is_not_empty', 'is_true', 'is_false'];

function Segments() {
  const t = useT();
  const segments = useSegments();
  const [editing, setEditing] = useState<SegmentRow | 'new' | null>(null);
  const canManage = useCan('marketing:manage');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('Saved segments')}</CardTitle>
            <InfoTip topic="marketing.segments" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {segments.isPending ? (
            <Skeleton className="h-20" />
          ) : !segments.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('No segments yet.')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {segments.data.map((s) => (
                <li key={s.id}>
                  <button type="button" className="w-full py-2 text-start hover:text-primary" onClick={() => setEditing(s)} aria-current={editing !== 'new' && editing?.id === s.id}>
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.entity === 'lead' ? t('Leads') : t('Contacts')} · {t.plural('count.rules', s.rules.rules.length)} · {t('updated {time}', { time: relativeTime(s.updatedAt) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {canManage ? t('New segment') : t('Explore a segment')}
          </Button>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        {editing ? <SegmentBuilder key={editing === 'new' ? 'new' : editing.id} segment={editing === 'new' ? null : editing} onSaved={setEditing} /> : <p className="text-sm text-muted-foreground">{t('Pick a segment or start a new one.')}</p>}
      </div>
    </div>
  );
}

function SegmentBuilder({ segment, onSaved }: { segment: SegmentRow | null; onSaved: (s: SegmentRow | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('marketing:manage');
  const canExport = useCan('data:export');
  const [name, setName] = useState(segment?.name ?? '');
  const [entity, setEntity] = useState<SegmentEntity>(segment?.entity ?? 'lead');
  const [match, setMatch] = useState<'all' | 'any'>(segment?.rules.match ?? 'all');
  const [rules, setRules] = useState<SegmentRule[]>(segment?.rules.rules ?? []);
  const fields = SEGMENT_FIELDS[entity];
  const body = { entity, rules: { match, rules } };

  const preview = useMutation({ mutationFn: () => api<SegmentPreview>('/segments/preview', { method: 'POST', json: body }) });
  const save = useMutation({
    mutationFn: () => api<SegmentRow>(segment ? `/segments/${segment.id}` : '/segments', { method: segment ? 'PUT' : 'POST', json: { name, ...body } }),
    onSuccess: async (s) => {
      await qc.invalidateQueries({ queryKey: ['segments'] });
      onSaved(s);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/segments/${segment!.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['segments'] });
      onSaved(null);
    },
  });
  // Preview as soon as the builder opens, so the counts are visible straight away.
  useEffect(() => {
    preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setRule = (i: number, patch: Partial<SegmentRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstField = Object.keys(fields)[0]!;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{segment ? segment.name : t('New segment')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="seg-name" label={t('Name')}>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="w-56" disabled={!canManage} />
          </Field>
          <Field id="seg-entity" label={t('People')}>
            <Select
              id="seg-entity"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as SegmentEntity);
                setRules([]);
              }}
              className="w-36"
            >
              <option value="lead">{t('Leads')}</option>
              <option value="contact">{t('Contacts')}</option>
            </Select>
          </Field>
          <Field id="seg-match" label={t('Match')}>
            <Select id="seg-match" value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')} className="w-44">
              <option value="all">{t('All rules')}</option>
              <option value="any">{t('Any rule')}</option>
            </Select>
          </Field>
        </div>
        <ul className="space-y-2">
          {rules.map((r, i) => {
            const def = fields[r.field];
            const ops = opsFor(entity, r.field);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Select aria-label={t('Rule {n} field', { n: i + 1 })} value={r.field} onChange={(e) => setRule(i, { field: e.target.value, op: opsFor(entity, e.target.value)[0]!, value: '' })} className="h-9 w-52">
                  {Object.entries(fields).map(([k, f]) => (
                    <option key={k} value={k}>
                      {t.maybe(f.label)}
                    </option>
                  ))}
                </Select>
                <Select aria-label={t('Rule {n} condition', { n: i + 1 })} value={r.op} onChange={(e) => setRule(i, { op: e.target.value as SegmentOp })} className="h-9 w-40">
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {t.maybe(SEGMENT_OP_LABELS[o])}
                    </option>
                  ))}
                </Select>
                {!NO_VALUE.includes(r.op) &&
                  (def?.options ? (
                    <Select aria-label={t('Rule {n} value', { n: i + 1 })} value={String(r.value ?? '')} onChange={(e) => setRule(i, { value: e.target.value })} className="h-9 w-40">
                      <option value="">{t('Choose…')}</option>
                      {def.options.map((o) => (
                        <option key={o} value={o}>
                          {t.maybe(o.replace(/_/g, ' ').toLowerCase())}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input aria-label={t('Rule {n} value', { n: i + 1 })} value={String(r.value ?? '')} onChange={(e) => setRule(i, { value: e.target.value })} className="h-9 w-40" />
                  ))}
                <Button type="button" size="icon" variant="ghost" aria-label={t('Remove rule {n}', { n: i + 1 })} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={rules.length >= 20} onClick={() => setRules((rs) => [...rs, { field: firstField, op: opsFor(entity, firstField)[0]!, value: '' }])}>
            <Plus aria-hidden /> {t('Add rule')}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()}>
            {t('Preview')}
          </Button>
          {canManage && (
            <Button type="button" size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              {t('Save segment')}
            </Button>
          )}
          {canManage && segment && (
            <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('Delete')}
            </Button>
          )}
        </div>
        <ErrorText error={preview.error ?? save.error ?? remove.error} />
        {preview.data && (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm" aria-live="polite">
            <p>
              {rich(t('{total} match · {optedIn} opted in to marketing · {optedOut} opted out'), {
                total: <span className="font-semibold tabular-nums">{preview.data.total}</span>,
                optedIn: <span className="tabular-nums">{preview.data.optedIn}</span>,
                optedOut: <span className="tabular-nums">{preview.data.optedOut}</span>,
              })}
            </p>
            {preview.data.sample.length > 0 && (
              <ul className="divide-y divide-border">
                {preview.data.sample.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-1">
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.email ?? t('no email')}</span>
                    <Badge className="ms-auto" tone={p.marketingConsent === 'OPTED_IN' ? 'success' : p.marketingConsent === 'OPTED_OUT' ? 'critical' : 'neutral'}>
                      {p.marketingConsent === 'OPTED_IN' ? t('Opted in') : p.marketingConsent === 'OPTED_OUT' ? t('Opted out') : t('Unknown')}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {segment && canExport && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button size="sm" variant="outline" onClick={() => downloadFile(`/segments/${segment.id}/export`, `${segment.name}.csv`)}>
              <Download aria-hidden /> {t('Export opted-in')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadFile(`/segments/${segment.id}/export?optedInOnly=false`, `${segment.name}.csv`)}>
              {t('Export all except opted-out')}
            </Button>
            <p className="w-full text-xs text-muted-foreground">{t('Exports never include people who opted out, and every export is recorded in the audit log.')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Forms() {
  const t = useT();
  const forms = useForms();
  const canManage = useCan('marketing:manage');
  return (
    <div className="space-y-4">
      {canManage && <FormBuilder />}
      {forms.isPending ? (
        <Skeleton className="h-24" />
      ) : !forms.data?.length ? (
        <p className="text-sm text-muted-foreground">{t('No lead forms yet.')}</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {forms.data.map((f) => (
            <FormCard key={f.id} form={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FormCard({ form: f }: { form: LeadFormRow }) {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('marketing:manage');
  const [copied, setCopied] = useState('');
  const url = typeof window !== 'undefined' ? `${window.location.origin}/f/${f.publicToken}` : `/f/${f.publicToken}`;
  const embed = `<iframe src="${url}" title="${f.title.replace(/"/g, '&quot;')}" style="width:100%;min-height:560px;border:0"></iframe>`;
  const toggle = useMutation({
    mutationFn: () =>
      api(`/forms/${f.id}`, {
        method: 'PUT',
        json: { name: f.name, title: f.title, intro: f.intro, fields: f.fields, consentText: f.consentText, successMessage: f.successMessage, source: f.source, campaignId: f.campaign?.id ?? null, active: !f.active },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forms'] }),
  });
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('');
    }
  };
  return (
    <li>
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{f.name}</h3>
            <Badge tone={f.active ? 'success' : 'neutral'}>{f.active ? t('Live') : t('Off')}</Badge>
            <span className="ms-auto text-xs text-muted-foreground">{t.plural('count.submissions', f.submissions)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {f.fields.map((x) => x.label).join(', ')} · {f.consentText ? t('asks for marketing consent') : t('no consent question')}
            {f.campaign && ` · ${t('campaign {name}', { name: f.campaign.name })}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`/f/${f.publicToken}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {t('Open form')}
            </a>
            <Button size="sm" variant="ghost" onClick={() => copy(url, 'link')}>
              <Copy aria-hidden /> {t('Copy link')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => copy(embed, 'embed')}>
              <Copy aria-hidden /> {t('Copy embed code')}
            </Button>
            {canManage && (
              <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                {f.active ? t('Turn off') : t('Turn on')}
              </Button>
            )}
          </div>
          <p aria-live="polite" className="text-xs text-success">
            {copied && (copied === 'link' ? t('Copied the link.') : t('Copied the embed code.'))}
          </p>
          <ErrorText error={toggle.error} />
        </CardContent>
      </Card>
    </li>
  );
}

function FormBuilder() {
  const t = useT();
  const qc = useQueryClient();
  const campaigns = useCampaigns();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [consent, setConsent] = useState(() => t('I would like to receive product news by email. I can unsubscribe at any time.'));
  const [campaignId, setCampaignId] = useState('');
  const [picked, setPicked] = useState<Record<FormFieldKey, 'off' | 'optional' | 'required'>>({
    fullName: 'required', email: 'required', phone: 'off', companyName: 'optional', jobTitle: 'off', country: 'off', message: 'optional',
  });
  const create = useMutation({
    mutationFn: () =>
      api('/forms', {
        method: 'POST',
        json: {
          name, title, intro: intro || null, consentText: consent || null, campaignId: campaignId || null,
          fields: FORM_FIELD_KEYS.filter((k) => picked[k] !== 'off').map((k) => ({ key: k, label: t.maybe(FORM_FIELD_LABELS[k]), required: picked[k] === 'required' })),
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      setName('');
      setTitle('');
      await qc.invalidateQueries({ queryKey: ['forms'] });
    },
  });
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {t('New lead form')}
      </Button>
    );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('New lead form')}</CardTitle>
          <InfoTip topic="marketing.forms" />
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field id="form-name" label={t('Internal name')}>
            <Input id="form-name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field id="form-title" label={t('Heading visitors see')}>
            <Input id="form-title" required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </Field>
          <Field id="form-intro" label={t('Intro (optional)')} className="md:col-span-2">
            <Textarea id="form-intro" value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={1000} />
          </Field>
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="text-sm font-medium">{t('Fields')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FORM_FIELD_KEYS.map((k) => (
                <label key={k} className="flex items-center justify-between gap-2 text-sm">
                  <span>{t.maybe(FORM_FIELD_LABELS[k])}</span>
                  <Select
                    aria-label={t('{name} field', { name: t.maybe(FORM_FIELD_LABELS[k]) })}
                    value={picked[k]}
                    disabled={k === 'fullName'}
                    onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.value as 'off' | 'optional' | 'required' }))}
                    className="h-8 w-32"
                  >
                    <option value="off">{t('Not asked')}</option>
                    <option value="optional">{t('Optional')}</option>
                    <option value="required">{t('Required')}</option>
                  </Select>
                </label>
              ))}
            </div>
          </fieldset>
          <Field id="form-consent" label={t('Marketing consent text')} hint={t('Shown next to an unticked box. Leave empty to not ask; nobody is opted in without ticking it.')} className="md:col-span-2">
            <Textarea id="form-consent" value={consent} onChange={(e) => setConsent(e.target.value)} maxLength={1000} />
          </Field>
          <Field id="form-campaign" label={t('Campaign (optional)')}>
            <Select id="form-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">{t('None')}</option>
              {(campaigns.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t('Create form')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
          </div>
          <div className="md:col-span-2">
            <ErrorText error={create.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
