'use client';

import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { type ConsoleCityRow, geoCountry } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConsoleCities, useConsoleRegions } from '@/components/console/location-picker';
import { CountrySelect } from '@/components/forms/inputs';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { selectClass } from '../console-ui';
import { can, useOperator } from '../operator-shell';

type Editing = { mode: 'add' } | { mode: 'rename'; city: ConsoleCityRow } | null;

/**
 * Countries, states and cities (ADR 0074, C4). The shipped list comes from GeoNames; operators add a city it is
 * missing or correct a name, and every change can be undone. Changes show in every city picker at once.
 */
export default function ConsoleLocationsPage() {
  const me = useOperator();
  const qc = useQueryClient();
  const [country, setCountry] = useState('IN');
  const [region, setRegion] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const canEdit = !!me.data && can(me.data, 'settings.manage');
  const regions = useConsoleRegions(country);
  const cities = useConsoleCities(country, region || null, q, 100);
  const changes = useQuery({
    enabled: canEdit && !!country,
    queryKey: ['operator', 'locations', country, 'changes'],
    queryFn: () => api<ConsoleCityRow[]>(`/operator/locations/${country}/changes`),
  });
  const refresh = (rows: ConsoleCityRow[]) => {
    qc.setQueryData(['operator', 'locations', country, 'changes'], rows);
    void qc.invalidateQueries({ queryKey: ['operator', 'locations', country, 'cities'] });
  };
  const undo = useMutation({
    mutationFn: (id: string) => api<ConsoleCityRow[]>(`/operator/locations/cities/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  if (!me.data) return <Skeleton className="h-64" />;
  const regionName = (code: string | null) => (code ? (regions.data?.find((r) => r.code === code)?.name ?? code) : null);

  return (
    <>
      <PageHeader
        title="Locations"
        description="Countries, states and cities offered when a client's location is set. Add a city that is missing or correct a name; every change can be undone."
        actions={
          canEdit ? (
            <Button onClick={() => setEditing({ mode: 'add' })}>
              <Plus className="size-4" aria-hidden /> Add a city
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field id="loc-country" label="Country">
          <CountrySelect
            id="loc-country"
            value={country}
            onChange={(code) => {
              setCountry(code);
              setRegion('');
            }}
          />
        </Field>
        <Field id="loc-region" label="State / province">
          <select id="loc-region" className={selectClass} value={region} disabled={!regions.data?.length} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Every state</option>
            {regions.data?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="loc-search" label="Search cities">
          <Input id="loc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Start typing a city" autoComplete="off" />
        </Field>
      </div>
      <ErrorText error={cities.error ?? undo.error} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-x-auto lg:col-span-2">
          <table className="w-full text-sm" data-console-cities="">
            <caption className="sr-only">Cities</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">City</th>
                <th scope="col" className="p-3 text-start font-medium">State / province</th>
                <th scope="col" className="p-3 text-start font-medium">Change</th>
                {canEdit && (
                  <th scope="col" className="p-3 text-end font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {cities.data?.map((c) => (
                <tr key={`${c.region}-${c.name}`} className="border-t border-border" data-city={c.name}>
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-muted-foreground">{regionName(c.region) ?? '—'}</td>
                  <td className="p-3">
                    {c.edit?.kind === 'added' && <Badge tone="success">Added</Badge>}
                    {c.edit?.kind === 'renamed' && (
                      <span className="inline-flex items-center gap-2">
                        <Badge tone="primary">Renamed</Badge>
                        <span className="text-xs text-muted-foreground">was {c.edit.originalName}</span>
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="p-3 text-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: 'rename', city: c })} aria-label={`Rename ${c.name}`}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {cities.isPending && <Skeleton className="m-3 h-24" />}
          {cities.data?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No city matches.{canEdit && ' If it is missing from the list, add it.'}
            </p>
          )}
          {cities.data?.length === 100 && <p className="border-t border-border p-3 text-xs text-muted-foreground">Showing the first 100. Search or choose a state to narrow the list.</p>}
        </Card>
        {canEdit && (
          <Card className="p-5" aria-labelledby="changes-h">
            <h2 id="changes-h" className="font-medium">
              Changes in {geoCountry(country)?.name ?? country}
            </h2>
            {changes.data?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No cities added or renamed yet.</p>}
            <ul className="mt-3 space-y-3" data-location-changes="">
              {changes.data?.map((c) => (
                <li key={c.edit!.id} className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-medium">
                      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                      {c.edit!.kind === 'added' ? c.name : `${c.edit!.originalName} → ${c.name}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {c.edit!.kind === 'added' ? 'Added' : 'Renamed'}
                      {regionName(c.region) && ` in ${regionName(c.region)}`}
                      {c.edit!.by && ` by ${c.edit!.by}`} · {formatDate(c.edit!.at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(c.edit!.id)}
                    aria-label={c.edit!.kind === 'added' ? `Remove ${c.name}` : `Undo the rename of ${c.edit!.originalName}`}
                  >
                    <Undo2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {editing && (
        <CityDialog
          country={country}
          region={editing.mode === 'rename' ? (editing.city.region ?? '') : region}
          city={editing.mode === 'rename' ? editing.city : null}
          onDone={(rows) => {
            if (rows) refresh(rows);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function CityDialog({ country, region: initialRegion, city, onDone }: { country: string; region: string; city: ConsoleCityRow | null; onDone: (rows: ConsoleCityRow[] | null) => void }) {
  const regions = useConsoleRegions(country);
  const [region, setRegion] = useState(initialRegion);
  const [name, setName] = useState(city?.name ?? '');
  const save = useMutation({
    mutationFn: () =>
      city
        ? api<ConsoleCityRow[]>('/operator/locations/cities/rename', { method: 'POST', json: { countryCode: country, regionCode: city.region ?? '', originalName: city.name, name } })
        : api<ConsoleCityRow[]>('/operator/locations/cities', { method: 'POST', json: { countryCode: country, regionCode: region, name } }),
    onSuccess: onDone,
  });
  const countryName = geoCountry(country)?.name ?? country;
  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{city ? `Rename ${city.name}` : 'Add a city'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {city ? 'The new name shows in every city picker. Clients that already use the old name keep it until they are edited.' : `Adds a city to ${countryName} that the list is missing.`}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!city && (
            <Field id="city-region" label="State / province">
              <select id="city-region" className={selectClass} value={region} disabled={!regions.data?.length} onChange={(e) => setRegion(e.target.value)}>
                <option value="">{regions.data?.length === 0 ? 'None listed' : 'Choose…'}</option>
                {regions.data?.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="city-name" label={city ? 'New name' : 'City'}>
            <Input id="city-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
          </Field>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || save.isPending || (!city && !!regions.data?.length && !region)}>
              {city ? 'Rename' : 'Add city'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
