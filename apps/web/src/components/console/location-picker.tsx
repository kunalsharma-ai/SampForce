'use client';

import { Input } from '@dealflow/ui';
import type { ConsoleCityRow, GeoRegion } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CountrySelect } from '@/components/forms/inputs';
import { Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { selectClass } from '@/app/operator/console-ui';

export interface LocationValue {
  countryCode: string;
  regionCode: string;
  city: string;
}

export function useConsoleRegions(country: string | null | undefined) {
  return useQuery({
    enabled: !!country,
    queryKey: ['operator', 'locations', country, 'regions'],
    queryFn: () => api<GeoRegion[]>(`/operator/locations/${country}/regions`),
    staleTime: 3_600_000,
  });
}

export function useConsoleCities(country: string | null | undefined, region: string | null | undefined, q: string, limit = 30) {
  return useQuery({
    enabled: !!country,
    queryKey: ['operator', 'locations', country, 'cities', region ?? '', q, limit],
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (region) p.set('region', region);
      if (q) p.set('q', q);
      return api<ConsoleCityRow[]>(`/operator/locations/${country}/cities?${p}`);
    },
    placeholderData: (prev) => prev,
  });
}

/**
 * Country, then state or province, then city (ADR 0074, C4). States come from the shipped list; cities are suggested
 * as you type, with the Console's own additions and renames, and any place can still be typed by hand.
 */
export function LocationPicker({ idPrefix, value, onChange }: { idPrefix: string; value: LocationValue; onChange: (v: LocationValue) => void }) {
  const regions = useConsoleRegions(value.countryCode || null);
  const [q, setQ] = useState(value.city);
  useEffect(() => {
    const t = setTimeout(() => setQ(value.city.trim()), 250);
    return () => clearTimeout(t);
  }, [value.city]);
  const cities = useConsoleCities(value.countryCode || null, value.regionCode || null, q);
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id={id('country')} label="Country">
        <CountrySelect id={id('country')} value={value.countryCode} onChange={(code) => onChange({ countryCode: code, regionCode: '', city: '' })} />
      </Field>
      <Field id={id('region')} label="State / province">
        <select
          id={id('region')}
          className={selectClass}
          value={value.regionCode}
          disabled={!value.countryCode || !regions.data?.length}
          onChange={(e) => onChange({ ...value, regionCode: e.target.value, city: '' })}
        >
          <option value="">{regions.data?.length === 0 ? 'None listed' : 'Choose…'}</option>
          {regions.data?.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={id('city')} label="City">
        <Input id={id('city')} list={`${id('city')}-list`} autoComplete="off" disabled={!value.countryCode} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
      </Field>
      <datalist id={`${id('city')}-list`}>
        {cities.data?.map((c) => (
          <option key={`${c.region}-${c.name}`} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
