import Ionicons from '@expo/vector-icons/Ionicons';
import { MOBILE_MODULE_BY_KEY, type MobileLiveRecordModule, type MobileRecord, type MobileRecordOptions, type MobileRecordPage } from '@dealflow/types';
import { Redirect, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../lib/api';
import { currentLanguage, t, tMaybe } from '../lib/i18n';
import {
  buildBody,
  datePresets,
  type FieldSpec,
  FormError,
  formFields,
  missingRequired,
  PRIORITIES,
  PRIORITY_LABEL,
  RECORD_STATUS_LABEL,
  recordTitle,
  refName,
  toFormValue,
  valueOf,
  visibleFields,
} from '../lib/records';
import { useApi, useController, useSignedIn, useTheme } from '../lib/session';
import { type ApprovalNeeded, approvalNeededOf, AskManagerCard } from './approvals';
import { Body, Button, Card, ErrorNote, Field, Loading, Row, Screen, SectionLabel } from './ui';

/*
 * Lists, record pages and forms for leads, contacts, follow-ups and tasks (ADR 0072, M4). One set of screens serves
 * the four modules; what each shows and lets the person change comes from their published Mobile Configuration.
 */

const BASE = '/mobile/records';
const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
};

function useModule(module: MobileLiveRecordModule) {
  const s = useSignedIn();
  return { s, m: s.config.modules.find((x) => x.key === module) ?? null };
}

function useOptions() {
  return useApi<MobileRecordOptions>(`${BASE}/options`);
}

function formatDate(v: string, withTime = true): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  try {
    return d.toLocaleString(currentLanguage(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
  } catch {
    return d.toISOString();
  }
}

/** A field's value as the record page shows it. */
function display(f: FieldSpec, v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const name = refName(v);
  if (name) return name;
  if (f.key === 'priority') return tMaybe(PRIORITY_LABEL[String(v)] ?? String(v));
  if (f.key === 'status' && typeof v === 'string') return tMaybe(RECORD_STATUS_LABEL[v] ?? v);
  if ((f.kind === 'datetime' || f.key === 'nextFollowUpAt' || f.key === 'createdAt') && typeof v === 'string') return formatDate(v);
  if (f.kind === 'date' && typeof v === 'string') return formatDate(v, false);
  if (typeof v === 'boolean') return v ? t('Yes') : t('No');
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function subtitle(module: MobileLiveRecordModule, r: MobileRecord): string | undefined {
  const parts: (string | null)[] = [];
  if (module === 'companies') parts.push(refName(r.status), typeof r.city === 'string' ? r.city : null);
  if (module === 'contacts') parts.push(typeof r.jobTitle === 'string' ? r.jobTitle : null, refName(r.company));
  if (module === 'follow_ups' || module === 'tasks') parts.push(typeof r.dueAt === 'string' ? formatDate(r.dueAt) : null, refName(r.company));
  const s = parts.filter(Boolean).join(' · ');
  return s || undefined;
}

export function Chips({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const th = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: th.text }]}>{label}</Text>
      <View role="radiogroup" aria-label={label} style={styles.chips}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Pressable
              key={o.value}
              role="radio"
              aria-checked={on}
              onPress={() => onChange(on ? '' : o.value)}
              style={[styles.chip, { borderColor: on ? th.primary : th.border, backgroundColor: on ? th.primary : th.card }]}
            >
              <Text style={{ fontSize: 14, color: on ? th.onPrimary : th.text }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PresetChip({ label, onPress }: { label: string; onPress: () => void }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, { borderColor: th.border, backgroundColor: th.card }]}>
      <Text style={{ fontSize: 14, color: th.text }}>{label}</Text>
    </Pressable>
  );
}

/** Finds a lead by name for a form. */
function CompanyPicker({ label, value, name, onChange }: { label: string; value: string; name: string | null; onChange: (id: string, name: string | null) => void }) {
  const c = useController();
  const th = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MobileRecord[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      c.api
        .get<MobileRecordPage>(`${BASE}/companies?q=${encodeURIComponent(q.trim())}`)
        .then((p) => live && setFound(p.items.slice(0, 6)))
        .catch((e: unknown) => {
          if (live) c.report(e);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [c, q]);
  if (value)
    return (
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: th.text }]}>{label}</Text>
        <View style={[styles.picked, { borderColor: th.border, backgroundColor: th.card }]}>
          <Body style={{ flex: 1 }}>{name ?? t('Selected')}</Body>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Change {field}', { field: label })} onPress={() => onChange('', null)}>
            <Ionicons aria-hidden name="close-circle" size={22} color={th.muted} />
          </Pressable>
        </View>
      </View>
    );
  return (
    <View style={{ gap: 6 }}>
      <Field label={label} value={q} onChangeText={setQ} placeholder={t('Type a lead name')} autoCapitalize="none" />
      {found.map((r) => (
        <Row key={r.id} icon="business-outline" label={String(r.name ?? '')} detail={subtitle('companies', r)} onPress={() => onChange(r.id, String(r.name ?? ''))} />
      ))}
    </View>
  );
}

function ContactPicker({ label, companyId, value, onChange }: { label: string; companyId: string; value: string; onChange: (v: string) => void }) {
  const contacts = useApi<MobileRecordPage>(companyId ? `${BASE}/contacts?companyId=${companyId}` : null);
  if (!companyId) return null;
  const items = contacts.data?.items ?? [];
  if (!items.length) return null;
  return <Chips label={label} value={value} onChange={onChange} options={items.map((r) => ({ value: r.id, label: recordTitle('contacts', r) }))} />;
}

function FieldInput({ f, value, onChange, error, options, refNames, setRefName, companyId }: {
  f: FieldSpec;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  options: MobileRecordOptions | null;
  refNames: Record<string, string | null>;
  setRefName: (key: string, name: string | null) => void;
  companyId: string;
}) {
  const label = tMaybe(f.label) + (f.required ? ' *' : '');
  switch (f.kind) {
    case 'companyStatus':
      return <Chips label={label} value={value} onChange={onChange} options={(options?.companyStatuses ?? []).map((s) => ({ value: s.id, label: s.name }))} />;
    case 'person':
      return <Chips label={label} value={value} onChange={onChange} options={(options?.people ?? []).map((p) => ({ value: p.id, label: p.name }))} />;
    case 'followUpType':
      return <Chips label={label} value={value} onChange={onChange} options={(options?.followUpTypes ?? []).map((x) => ({ value: x.key, label: x.label }))} />;
    case 'priority':
      return <Chips label={label} value={value} onChange={onChange} options={PRIORITIES.map((p) => ({ value: p, label: tMaybe(PRIORITY_LABEL[p]!) }))} />;
    case 'choice':
      return <Chips label={label} value={value} onChange={onChange} options={(f.choices ?? []).map((x) => ({ value: x, label: x }))} />;
    case 'boolean':
      return <Chips label={label} value={value} onChange={onChange} options={[{ value: 'true', label: t('Yes') }]} />;
    case 'company':
      return <CompanyPicker label={label} value={value} name={refNames[f.key] ?? null} onChange={(id, name) => {
            onChange(id);
            setRefName(f.key, name);
          }} />;
    case 'contact':
      return <ContactPicker label={label} companyId={companyId} value={value} onChange={onChange} />;
    case 'datetime':
      return (
        <View style={{ gap: 6 }}>
          <Field label={label} value={value} onChangeText={onChange} placeholder="2026-12-01 14:30" hint={t('Date and time, such as 2026-12-01 14:30')} error={error} autoCapitalize="none" />
          <View style={styles.chips}>
            {datePresets(new Date()).map((p) => (
              <PresetChip key={p.label} label={tMaybe(p.label)} onPress={() => onChange(p.value)} />
            ))}
          </View>
        </View>
      );
    default:
      return (
        <Field
          label={label}
          value={value}
          onChangeText={onChange}
          error={error}
          multiline={f.kind === 'multiline'}
          autoCapitalize={f.kind === 'email' || f.kind === 'url' ? 'none' : undefined}
          keyboardType={f.kind === 'email' ? 'email-address' : f.kind === 'phone' ? 'phone-pad' : f.kind === 'url' ? 'url' : f.kind === 'number' ? 'decimal-pad' : 'default'}
          placeholder={f.kind === 'date' ? '2026-12-01' : f.key === 'country' ? 'GB' : undefined}
          hint={f.key === 'country' ? t('Two-letter country code, such as GB') : undefined}
          maxLength={f.kind === 'multiline' ? 5000 : 200}
        />
      );
  }
}

const BUCKETS = ['today', 'upcoming', 'overdue', 'completed'] as const;
const BUCKET_LABEL: Record<(typeof BUCKETS)[number], string> = { today: 'Today', upcoming: 'Upcoming', overdue: 'Overdue', completed: 'Completed' };

/** The module's list: search, the follow-up buckets or open/done tasks, pull to refresh, and more on request. */
export function RecordList({ module }: { module: MobileLiveRecordModule }) {
  const { m } = useModule(module);
  const c = useController();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]>('today');
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const [items, setItems] = useState<MobileRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);

  const query = useCallback(
    (p: number) => {
      const params = new URLSearchParams({ page: String(p) });
      if (search) params.set('q', search);
      if (module === 'follow_ups') {
        params.set('bucket', bucket);
        params.set('tz', tz());
      }
      if (module === 'tasks') params.set('status', status);
      return `${BASE}/${module}?${params.toString()}`;
    },
    [module, search, bucket, status],
  );

  const load = useCallback(
    async (p: number) => {
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await c.api.get<MobileRecordPage>(query(p));
        if (mine !== seq.current) return;
        setItems((prev) => (p === 1 ? res.items : [...prev, ...res.items]));
        setPage(res.page);
        setHasMore(res.hasMore);
      } catch (e) {
        if (mine === seq.current && !c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [c, query],
  );

  // Fresh each time the screen shows, so an edit or a new record is there on the way back.
  useFocusEffect(
    useCallback(() => {
      void load(1);
    }, [load]),
  );

  if (!m) return <Redirect href="/" />;
  const def = MOBILE_MODULE_BY_KEY[module];
  return (
    <Screen refreshing={loading && page === 1 && items.length > 0} onRefresh={() => void load(1)}>
      <Field label={t('Search {module}', { module: tMaybe(def.label).toLowerCase() })} value={q} onChangeText={setQ} autoCapitalize="none" returnKeyType="search" />
      {module === 'follow_ups' ? <Chips label={t('Show')} value={bucket} onChange={(v) => v && setBucket(v as typeof bucket)} options={BUCKETS.map((b) => ({ value: b, label: tMaybe(BUCKET_LABEL[b]) }))} /> : null}
      {module === 'tasks' ? (
        <Chips label={t('Show')} value={status} onChange={(v) => v && setStatus(v as typeof status)} options={[{ value: 'OPEN', label: t('Open') }, { value: 'DONE', label: t('Done') }]} />
      ) : null}
      {m.create ? <Button label={t('Add {thing}', { thing: tMaybe(SINGULAR[module]) })} onPress={() => router.push(`/${module}/form`)} /> : null}
      {error ? <ErrorNote message={error} onRetry={() => void load(1)} /> : null}
      {items.length ? (
        <Card>
          {items.map((r, i) => (
            <Row key={r.id} label={recordTitle(module, r)} detail={subtitle(module, r)} onPress={() => router.push(`/${module}/${r.id}`)} last={i === items.length - 1} />
          ))}
        </Card>
      ) : loading ? (
        <Loading />
      ) : !error ? (
        <Body muted>{search ? t('Nothing matches your search.') : t('Nothing here yet.')}</Body>
      ) : null}
      {hasMore ? <Button kind="secondary" label={t('Show more')} busy={loading} onPress={() => void load(page + 1)} /> : null}
    </Screen>
  );
}

const SINGULAR: Record<MobileLiveRecordModule, string> = { companies: 'Lead', contacts: 'Contact', follow_ups: 'Follow-up', tasks: 'Task' };

/** One record: its fields for this person, phone actions, and what they may do with it. */
export function RecordDetail({ module }: { module: MobileLiveRecordModule }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, m } = useModule(module);
  const c = useController();
  const th = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const options = useOptions();
  const [record, setRecord] = useState<MobileRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [askManager, setAskManager] = useState<ApprovalNeeded | null>(null);
  const [completing, setCompleting] = useState(false);
  const [outcome, setOutcome] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setRecord(await c.api.get<MobileRecord>(`${BASE}/${module}/${id}?tz=${encodeURIComponent(tz())}`));
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    }
  }, [c, module, id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (record) navigation.setOptions({ title: recordTitle(module, record) });
  }, [navigation, module, record]);

  const fields = useMemo(() => visibleFields(s.config, module, options.data?.customFields[module]), [s.config, module, options.data]);
  if (!m) return <Redirect href="/" />;
  if (error && !record) return <Screen><ErrorNote message={error} onRetry={() => void load()} /></Screen>;
  if (!record) return <Screen><Loading /></Screen>;

  const act = async (kind: string, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const patch = (body: Record<string, unknown>) => act('status', async () => setRecord(await c.api.patch<MobileRecord>(`${BASE}/${module}/${id}`, body)));
  const remove = () =>
    act('delete', async () => {
      const path = `${BASE}/${module}/${id}`;
      try {
        await c.api.deleteConfirmed(path, password);
      } catch (e) {
        // An Executive Workspace asks its manager first (ADR 0098): nothing is deleted, the request goes instead.
        const need = approvalNeededOf(e, 'DELETE', path);
        if (!need) throw e;
        setConfirmDelete(false);
        setPassword('');
        setAskManager(need);
        return;
      }
      router.back();
    });

  const rules = s.config.fields[module] ?? {};
  const canStatus = m.edit && !!rules.status?.edit;
  const canEdit = m.edit && formFields(fields, 'edit').length > 0;
  const actions = new Set(s.config.phoneActions);
  const phone = typeof record.primaryPhone === 'string' ? record.primaryPhone : typeof record.phone === 'string' ? record.phone : null;
  const email = typeof record.primaryEmail === 'string' ? record.primaryEmail : typeof record.email === 'string' ? record.email : null;
  const address = typeof record.address === 'string' ? record.address : null;
  const quick = [
    phone && actions.has('call') ? { icon: 'call-outline' as const, label: t('Call'), url: `tel:${phone.replace(/[^\d+]/g, '')}` } : null,
    phone && actions.has('whatsapp') ? { icon: 'logo-whatsapp' as const, label: 'WhatsApp', url: `https://wa.me/${phone.replace(/[^\d]/g, '')}` } : null,
    email && actions.has('email') ? { icon: 'mail-outline' as const, label: t('Email'), url: `mailto:${email}` } : null,
    address && actions.has('directions') ? { icon: 'navigate-outline' as const, label: t('Directions'), url: `https://maps.google.com/?q=${encodeURIComponent(address)}` } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  const shown = fields.map((f) => ({ f, text: display(f, valueOf(record, f.key)) })).filter((x) => x.text !== null);
  const open = record.status === 'OPEN';

  return (
    <Screen>
      {quick.length ? (
        <View style={styles.chips}>
          {quick.map((a) => (
            <Pressable key={a.label} accessibilityRole="link" onPress={() => void Linking.openURL(a.url)} style={[styles.quick, { borderColor: th.border, backgroundColor: th.card }]}>
              <Ionicons aria-hidden name={a.icon} size={18} color={th.primary} />
              <Text style={{ color: th.text, fontSize: 14 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Card>
        {shown.map(({ f, text }, i) => (
          <View key={f.key} style={[styles.detailRow, i < shown.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.border }]}>
            <Text style={[styles.detailLabel, { color: th.muted }]}>{tMaybe(f.label)}</Text>
            <Body>{text}</Body>
          </View>
        ))}
        {!shown.length ? <Body muted>{t('Nothing to show for your level.')}</Body> : null}
      </Card>
      {error ? <ErrorNote message={error} /> : null}

      {(module === 'follow_ups' || module === 'tasks') && canStatus && open ? (
        completing && module === 'follow_ups' ? (
          <Card>
            {rules.outcome?.edit ? <Field label={t('Outcome')} value={outcome} onChangeText={setOutcome} multiline maxLength={500} /> : null}
            <Button label={t('Mark done')} busy={busy === 'status'} onPress={() => void patch({ status: 'DONE', ...(outcome.trim() && rules.outcome?.edit ? { outcome: outcome.trim() } : {}) }).then(() => setCompleting(false))} />
            <Button kind="secondary" label={t('Back')} onPress={() => setCompleting(false)} />
          </Card>
        ) : (
          <Button label={t('Mark done')} busy={busy === 'status'} onPress={() => (module === 'follow_ups' ? setCompleting(true) : void patch({ status: 'DONE' }))} />
        )
      ) : null}
      {module === 'tasks' && canStatus && record.status === 'DONE' ? <Button kind="secondary" label={t('Reopen')} busy={busy === 'status'} onPress={() => void patch({ status: 'OPEN' })} /> : null}
      {module === 'follow_ups' && canStatus && open && !completing ? <Button kind="secondary" label={t('Cancel follow-up')} busy={busy === 'cancel'} onPress={() => void patch({ status: 'CANCELED' })} /> : null}
      {canEdit && (module === 'companies' || module === 'contacts' || open) ? <Button kind="secondary" label={t('Edit')} onPress={() => router.push(`/${module}/form?id=${record.id}`)} /> : null}

      {module === 'companies' ? <CompanyRelated company={record} /> : null}

      {askManager ? <AskManagerCard need={askManager} onDone={() => setAskManager(null)} /> : null}
      {m.delete && module !== 'follow_ups' && !askManager ? (
        confirmDelete ? (
          <Card>
            <Body>{t('Delete this record? This cannot be undone on the phone.')}</Body>
            <Field label={t('Your password')} hint={t('Deleting needs your password.')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
            <Button kind="danger" label={t('Yes, delete')} busy={busy === 'delete'} disabled={!password} onPress={() => void remove()} />
            <Button
              kind="secondary"
              label={t('Keep it')}
              onPress={() => {
                setConfirmDelete(false);
                setPassword('');
              }}
            />
          </Card>
        ) : (
          <Button kind="danger" label={t('Delete')} onPress={() => setConfirmDelete(true)} />
        )
      ) : null}
    </Screen>
  );
}

/** On a lead's page: its contacts, and quick ways to add a contact or plan a follow-up for it. */
function CompanyRelated({ company }: { company: MobileRecord }) {
  const s = useSignedIn();
  const router = useRouter();
  const contactsOn = s.config.modules.find((x) => x.key === 'contacts');
  const followOn = s.config.modules.find((x) => x.key === 'follow_ups');
  const contacts = useApi<MobileRecordPage>(contactsOn ? `${BASE}/contacts?companyId=${company.id}` : null);
  const prefill = `companyId=${company.id}&companyName=${encodeURIComponent(String(company.name ?? ''))}`;
  if (!contactsOn && !followOn) return null;
  return (
    <>
      {contactsOn ? (
        <>
          <SectionLabel>{t('Contacts')}</SectionLabel>
          {contacts.data?.items.length ? (
            <Card>
              {contacts.data.items.map((r, i, all) => (
                <Row key={r.id} icon="person-outline" label={recordTitle('contacts', r)} detail={subtitle('contacts', r)} onPress={() => router.push(`/contacts/${r.id}`)} last={i === all.length - 1} />
              ))}
            </Card>
          ) : contacts.loading ? (
            <Loading />
          ) : (
            <Body muted>{t('No contacts yet.')}</Body>
          )}
          {contactsOn.create ? <Button kind="secondary" label={t('Add {thing}', { thing: t('Contact') })} onPress={() => router.push(`/contacts/form?${prefill}`)} /> : null}
        </>
      ) : null}
      {followOn?.create ? <Button kind="secondary" label={t('Plan a follow-up')} onPress={() => router.push(`/follow_ups/form?${prefill}`)} /> : null}
    </>
  );
}

/** Adds a record, or edits one (`?id=`), with only the fields this person may set or change. */
export function RecordForm({ module }: { module: MobileLiveRecordModule }) {
  const params = useLocalSearchParams<{ id?: string; companyId?: string; companyName?: string }>();
  const editing = typeof params.id === 'string' && params.id.length > 0;
  const { s, m } = useModule(module);
  const c = useController();
  const router = useRouter();
  const navigation = useNavigation();
  const options = useOptions();
  const current = useApi<MobileRecord>(editing ? `${BASE}/${module}/${params.id}` : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string> | null>(null);
  const [refNames, setRefNames] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [askManager, setAskManager] = useState<ApprovalNeeded | null>(null);

  const all = useMemo(() => visibleFields(s.config, module, options.data?.customFields[module]), [s.config, module, options.data]);
  const fields = useMemo(() => formFields(all, editing ? 'edit' : 'create'), [all, editing]);

  useEffect(() => {
    navigation.setOptions({ title: editing ? t('Edit {thing}', { thing: tMaybe(SINGULAR[module]) }) : t('Add {thing}', { thing: tMaybe(SINGULAR[module]) }) });
  }, [navigation, editing, module]);

  // Start from the stored record, or from the lead this was opened from.
  useEffect(() => {
    if (editing) {
      const r = current.data;
      if (!r) return;
      const v = Object.fromEntries(all.map((f) => [f.key, toFormValue(valueOf(r, f.key), f.kind)]));
      setValues(v);
      setOriginal(v);
      setRefNames(Object.fromEntries(all.filter((f) => f.kind === 'company').map((f) => [f.key, refName(valueOf(r, f.key))])));
    } else if (typeof params.companyId === 'string' && params.companyId) {
      setValues((v) => ({ company: params.companyId!, ...v }));
      setRefNames((n) => ({ company: params.companyName ?? null, ...n }));
    }
  }, [editing, current.data, all, params.companyId, params.companyName]);

  if (!m || (editing ? !m.edit : !m.create)) return <Redirect href="/" />;
  if (editing && current.error && !current.data) return <Screen><ErrorNote message={current.error} onRetry={current.reload} /></Screen>;
  if ((editing && !original) || (!options.data && options.loading)) return <Screen><Loading /></Screen>;

  const set = (key: string) => (v: string) => {
    setValues((prev) => ({ ...prev, [key]: v, ...(key === 'company' && module === 'follow_ups' ? { contact: '' } : {}) }));
    setFieldErrors((e) => ({ ...e, [key]: '' }));
  };
  const missing = editing ? [] : missingRequired(module, fields, values);

  const save = async () => {
    setError(null);
    setFieldErrors({});
    let body: Record<string, unknown>;
    try {
      body = buildBody(fields, values, editing ? original : null);
    } catch (e) {
      if (e instanceof FormError) setFieldErrors({ [e.field]: tMaybe(e.message) });
      return;
    }
    if (!Object.keys(body).length) {
      router.back();
      return;
    }
    setBusy(true);
    try {
      const saved = editing ? await c.api.patch<MobileRecord>(`${BASE}/${module}/${params.id}`, body) : await c.api.post<MobileRecord>(`${BASE}/${module}`, body);
      if (editing) router.back();
      else router.replace(`/${module}/${saved.id}`);
    } catch (e) {
      if (c.report(e)) return;
      // When the Super Workspace asks executives to get edits approved (ADR 0098), the change goes to the manager.
      const need = editing ? approvalNeededOf(e, 'PATCH', `${BASE}/${module}/${params.id}`, body) : null;
      if (need) return setAskManager(need);
      if (e instanceof ApiError && e.details.length) setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path.replace(/^customFields\./, 'cf.'), d.message])));
      setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {fields.map((f) => (
        <View key={f.key} style={{ gap: 4 }}>
          <FieldInput f={f} value={values[f.key] ?? ''} onChange={set(f.key)} error={fieldErrors[f.key] || undefined} options={options.data} refNames={refNames} setRefName={(k, n) => setRefNames((x) => ({ ...x, [k]: n }))} companyId={values.company ?? ''} />
          {fieldErrors[f.key] && f.kind !== 'text' && f.kind !== 'multiline' && f.kind !== 'datetime' && f.kind !== 'email' && f.kind !== 'phone' && f.kind !== 'url' && f.kind !== 'number' && f.kind !== 'date' ? <ErrorText message={fieldErrors[f.key]!} /> : null}
        </View>
      ))}
      {!fields.length ? <Body muted>{t('Your workspace does not let you change any fields here.')}</Body> : null}
      {missing.length ? <Body muted>{t('Fill in the fields marked *.')}</Body> : null}
      {error ? <ErrorNote message={error} /> : null}
      {askManager ? <AskManagerCard need={askManager} onDone={() => setAskManager(null)} /> : null}
      {!askManager ? <Button label={editing ? t('Save changes') : t('Save')} busy={busy} disabled={missing.length > 0 || !fields.length} onPress={() => void save()} /> : null}
    </Screen>
  );
}

function ErrorText({ message }: { message: string }) {
  const th = useTheme();
  return <Text style={{ color: th.danger, fontSize: 13 }}>{message}</Text>;
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12 },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, minHeight: 40 },
  detailRow: { paddingVertical: 8, gap: 2 },
  detailLabel: { fontSize: 13, fontWeight: '600' },
});
