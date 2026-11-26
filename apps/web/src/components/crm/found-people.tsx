'use client';

import { type CompanyRow, type FoundPerson, PERSON_SOURCE_LABELS } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Linkedin, Mail, UserPlus } from 'lucide-react';
import * as React from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { emptyEmployee, employeePayload, type EmployeeValue, splitName } from './lead-fields';

/** A found person as an employee for the lead form, with where and when they were found kept in the remarks. */
export function employeeFromPerson(p: FoundPerson, now = new Date()): EmployeeValue {
  const where = p.url ?? PERSON_SOURCE_LABELS[p.source];
  return {
    ...emptyEmployee(),
    ...splitName(p.name),
    jobTitle: p.title ?? '',
    linkedinUrl: p.linkedinUrl ?? '',
    emails: [{ value: p.email ?? '', primary: true }],
    remarks: `Found by auto-fill on ${where} (${now.toISOString().slice(0, 10)}).`,
  };
}

/**
 * People a company publishes (ADR 0079), each with a tick box, what the source shows (designation, email, LinkedIn)
 * and the source. Nobody is added until the person picks them and presses the button.
 */
export function FoundPeople({ people, onAdd, busy = false, skipNames = [] }: { people: FoundPerson[]; onAdd: (chosen: FoundPerson[]) => void; busy?: boolean; skipNames?: string[] }) {
  const t = useT();
  const known = new Set(skipNames.map((n) => n.trim().toLowerCase()));
  const fresh = people.filter((p) => !known.has(p.name.trim().toLowerCase()));
  const [chosen, setChosen] = React.useState<Set<number>>(() => new Set(fresh.map((_, i) => i)));
  React.useEffect(() => setChosen(new Set(fresh.map((_, i) => i))), [people.length, fresh.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!people.length) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t('People found ({count})', { count: fresh.length })}</legend>
      {fresh.length < people.length && <p className="text-xs text-muted-foreground">{t('People already added are not shown again.')}</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {fresh.map((p, i) => (
          <li key={`${p.name}-${i}`}>
            <label className="flex h-full cursor-pointer items-start gap-3 rounded-lg border border-border p-2.5 hover:border-primary/50 hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[hsl(var(--primary))]"
                checked={chosen.has(i)}
                onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{p.name}</span>
                {p.title && <span className="block text-xs text-muted-foreground">{p.title}</span>}
                {p.email && (
                  <span className="mt-0.5 flex items-center gap-1 break-all text-xs">
                    <Mail aria-hidden className="size-3 shrink-0" /> {p.email}
                  </span>
                )}
                {p.linkedinUrl && (
                  <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex min-h-6 items-center gap-1 text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Linkedin aria-hidden className="size-3" /> {t('LinkedIn profile')}
                  </a>
                )}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {t.maybe(PERSON_SOURCE_LABELS[p.source])} <ExternalLink aria-hidden className="size-3" />
                    </a>
                  ) : (
                    t.maybe(PERSON_SOURCE_LABELS[p.source])
                  )}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button type="button" size="sm" variant="outline" disabled={!chosen.size || busy} onClick={() => onAdd(fresh.filter((_, i) => chosen.has(i)))}>
          <UserPlus aria-hidden /> {t('Add {count} as employees', { count: chosen.size })}
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * "Find people" on a saved company (ADR 0079): reads the company's own site and the other public sources for the
 * people it lists, and adds the ones picked as employees. Nothing is stored until the button is pressed.
 */
export function FindPeopleDialog({ company, open, onOpenChange, knownNames }: { company: CompanyRow; open: boolean; onOpenChange: (o: boolean) => void; knownNames: string[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [people, setPeople] = React.useState<FoundPerson[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [added, setAdded] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setPeople(null);
    setError(null);
    setAdded(null);
    api<{ people: FoundPerson[]; error: string | null }>(`/companies/${company.id}/find-people`, { method: 'POST' })
      .then((r) => {
        if (!live) return;
        setPeople(r.people);
        setError(r.error ? t.maybe(r.error) : null);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [open, company.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (chosen: FoundPerson[]) => {
    setSaving(true);
    setError(null);
    let done = 0;
    try {
      for (const p of chosen) {
        const e = { ...employeeFromPerson(p), country: company.country ?? '' };
        await api('/contacts', { method: 'POST', json: { ...employeePayload(e), companyId: company.id, ownerId: company.ownerPerson?.id ?? null } });
        done++;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
      setAdded(done);
      await Promise.all([qc.invalidateQueries({ queryKey: ['company-employees'] }), qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['company-dashboard'] }), qc.invalidateQueries({ queryKey: ['companies'] })]);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Find people at {company}', { company: company.name })}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('People the company lists on its website and other public sources, with their designation, email and LinkedIn when shown. Tick the ones to add as employees.')}
        </DialogDescription>
        {!people && !error && (
          <div className="space-y-2" aria-busy="true">
            <p className="text-sm text-muted-foreground">{t('Reading the website…')}</p>
            <Skeleton className="h-32" />
          </div>
        )}
        {added !== null && (
          <p role="status" className="mb-2 text-sm text-success">
            {t('Added {count} people as employees.', { count: added })}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-sm text-critical">
            {error}
          </p>
        )}
        {people && people.length > 0 && <FoundPeople people={people} onAdd={(c) => void add(c)} busy={saving} skipNames={knownNames} />}
      </DialogContent>
    </Dialog>
  );
}
