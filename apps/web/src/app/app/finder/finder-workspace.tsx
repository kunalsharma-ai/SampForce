'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@dealflow/ui';
import {
  DOMAIN_SOURCE_LABELS,
  type ExtensionCaptureResult,
  FINDER_STATUS_LABELS,
  type FinderEmail,
  type FinderEmailStatus,
  type FinderHistoryRow,
  type FinderResult,
  type FinderUsage,
  type SequenceRow,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const TONE: Record<FinderEmailStatus, 'success' | 'primary' | 'accent' | 'warning'> = { found: 'success', provider: 'primary', pattern: 'accent', guess: 'warning' };

export function FinderWorkspace() {
  const qc = useQueryClient();
  const canSave = useCan('leads:write');
  const canEnroll = useCan('sequences:write');
  const [company, setCompany] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const usage = useQuery({ queryKey: ['finder', 'usage'], queryFn: () => api<FinderUsage>('/finder/usage') });
  const history = useQuery({ queryKey: ['finder', 'history'], queryFn: () => api<FinderHistoryRow[]>('/finder/lookups') });
  const opened = useQuery({ enabled: !!openId, queryKey: ['finder', 'lookup', openId], queryFn: () => api<FinderResult>(`/finder/lookups/${openId}`) });
  const search = useMutation({
    mutationFn: () => api<FinderResult>('/finder/search', { method: 'POST', json: { company, ...(first.trim() && last.trim() ? { firstName: first.trim(), lastName: last.trim() } : {}) } }),
    onSuccess: (r) => {
      qc.setQueryData(['finder', 'lookup', r.id], r);
      setOpenId(r.id);
      void qc.invalidateQueries({ queryKey: ['finder', 'usage'] });
      void qc.invalidateQueries({ queryKey: ['finder', 'history'] });
    },
  });
  const u = usage.data;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardContent className="space-y-3 p-4">
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                search.mutate();
              }}
            >
              <div className="space-y-1">
                <label htmlFor="finder-company" className="text-sm font-medium">
                  Company name or website
                </label>
                <Input id="finder-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Kestrel Analytics or kestrel-analytics.com" required minLength={2} />
              </div>
              <div className="space-y-1">
                <label htmlFor="finder-first" className="text-sm font-medium">
                  First name <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input id="finder-first" value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1">
                <label htmlFor="finder-last" className="text-sm font-medium">
                  Last name <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input id="finder-last" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
              </div>
              <Button type="submit" disabled={search.isPending || company.trim().length < 2 || !!u && u.used >= u.limit}>
                <Search aria-hidden /> {search.isPending ? 'Searching…' : 'Find emails'}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              {u ? `${u.used} of ${u.limit} lookups used in the last 24 hours. ` : ''}
              {u?.provider ? 'Your data provider (Hunter.io) is connected and adds addresses it knows about.' : 'Using DealFlow’s own finder. An administrator can add a Hunter.io key to search wider.'}
            </p>
            <ErrorText error={search.error} />
          </CardContent>
        </Card>
        {search.isPending && <p className="text-sm text-muted-foreground" role="status">Reading the company’s website…</p>}
        {opened.data && <ResultView key={opened.data.id} result={opened.data} canSave={canSave} canEnroll={canEnroll} />}
      </div>

      <aside aria-labelledby="finder-history" className="space-y-2">
        <h2 id="finder-history" className="text-sm font-semibold">
          Your recent lookups
        </h2>
        {history.data?.length ? (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {history.data.map((h) => (
              <li key={h.id}>
                <button type="button" className="w-full px-3 py-2 text-start hover:bg-muted aria-[current=true]:bg-muted" aria-current={h.id === openId} onClick={() => setOpenId(h.id)}>
                  <span className="block font-medium">
                    {h.person ? `${h.person}, ` : ''}
                    {h.companyName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {h.domain ?? 'no website found'} · {h.found} found · {relativeTime(h.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No lookups yet.</p>
        )}
      </aside>
    </div>
  );
}

function ResultView({ result: r, canSave, canEnroll }: { result: FinderResult; canSave: boolean; canEnroll: boolean }) {
  const qc = useQueryClient();
  const rows = [...r.person, ...r.emails.filter((e) => !r.person.some((p) => p.email === e.email))];
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(rows.filter((e) => !e.match && !e.suppressed && e.status !== 'guess' && e.name).map((e) => e.email)));
  const [sequenceId, setSequenceId] = useState('');
  const sequences = useQuery({ enabled: canEnroll, queryKey: ['sequences', 'list'], queryFn: () => api<SequenceRow[]>('/sequences') });
  const active = (sequences.data ?? []).filter((s) => s.status === 'ACTIVE');
  const save = useMutation({
    mutationFn: () =>
      api<ExtensionCaptureResult>(`/finder/lookups/${r.id}/save`, {
        method: 'POST',
        json: { people: rows.filter((e) => chosen.has(e.email)).map((e) => ({ email: e.email, ...(e.name ? { fullName: e.name } : {}), ...(e.position ? { jobTitle: e.position } : {}) })), ...(sequenceId ? { sequenceId } : {}) },
      }),
    onSuccess: () => {
      setChosen(new Set());
      void qc.invalidateQueries({ queryKey: ['finder', 'lookup', r.id] });
    },
  });
  const toggle = (email: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  const created = save.data?.results.filter((x) => x.outcome === 'created').length ?? 0;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {r.companyName}
          {r.company && (
            <Link href={`/app/companies/${r.company.id}`} className="text-sm font-normal text-primary hover:underline">
              In DealFlow
            </Link>
          )}
        </CardTitle>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-muted-foreground">Website: </dt>
            <dd className="inline">{r.domain ? `${r.domain} (from ${DOMAIN_SOURCE_LABELS[r.domainSource!]})` : 'not found'}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Receives email: </dt>
            <dd className="inline">{r.mailServer === null ? 'not checked' : r.mailServer ? 'yes, it has a mail server' : 'no mail server found'}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Address pattern: </dt>
            <dd className="inline">{r.pattern ? `${r.pattern.replace(/[{}]/g, '')}@${r.domain} (from ${r.patternBasis} published address${r.patternBasis === 1 ? '' : 'es'})` : 'not enough to tell'}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Pages read: </dt>
            <dd className="inline">{r.pagesRead}</dd>
          </div>
        </dl>
        {r.notes.map((n) => (
          <p key={n} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {n}
          </p>
        ))}
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No addresses at this company yet. Try their website directly, or add a person’s name to get likely addresses.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="Addresses found">
            {rows.map((e) => (
              <Row key={e.email} e={e} person={r.person.includes(e)} checked={chosen.has(e.email)} onToggle={() => toggle(e.email)} disabled={!canSave || !!e.match} />
            ))}
          </ul>
        )}
        {canSave && rows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            {canEnroll && active.length > 0 && (
              <div className="min-w-56 space-y-1">
                <label htmlFor="finder-seq" className="text-sm font-medium">
                  Also enrol in a sequence
                </label>
                <select id="finder-seq" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>
                  <option value="">Do not enrol</option>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Button onClick={() => save.mutate()} disabled={!chosen.size || save.isPending}>
              {chosen.size ? `Save ${chosen.size} as lead${chosen.size === 1 ? '' : 's'}${sequenceId ? ' and enrol' : ''}` : 'Choose people to save'}
            </Button>
            {save.data && (
              <p role="status" className="text-sm">
                Saved {created} new lead{created === 1 ? '' : 's'}.{save.data.enrollment ? ` Enrolled ${save.data.enrollment.enrolled}.` : ''}
              </p>
            )}
          </div>
        )}
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  );
}

function Row({ e, person, checked, onToggle, disabled }: { e: FinderEmail; person: boolean; checked: boolean; onToggle: () => void; disabled: boolean }) {
  const id = `finder-${e.email}`;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
      <input id={id} type="checkbox" className="mt-1 size-4" checked={checked} onChange={onToggle} disabled={disabled} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-all">{e.email}</span>
          <Badge tone={TONE[e.status]}>
            {FINDER_STATUS_LABELS[e.status]}
            {e.confidence !== null ? ` · ${e.confidence}%` : ''}
          </Badge>
          {person && <Badge>The person you asked about</Badge>}
          {e.suppressed && <Badge tone="critical">Do not email</Badge>}
        </label>
        <p className="text-xs text-muted-foreground">
          {[e.name, e.position].filter(Boolean).join(' · ') || 'Shared mailbox or no name on the page'}
          {e.sourceUrl && (
            <>
              {' · '}
              <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Where it was published <ExternalLink className="size-3" aria-hidden />
              </a>
            </>
          )}
        </p>
      </div>
      {e.match && (
        <Link href={`/app/${e.match.entity === 'contact' ? 'contacts' : 'leads'}/${e.match.id}`} className="text-xs text-primary hover:underline">
          Already a {e.match.entity}: {e.match.label}
        </Link>
      )}
    </li>
  );
}
