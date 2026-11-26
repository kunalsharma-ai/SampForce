'use client';

import {
  connectAdvice,
  type ConnectAdvice,
  type ContactTimes,
  type ContactTimesResponse,
  DEFAULT_CONTACT_TIMES,
  normalizeWorkingHours,
  type Place,
  type PublicHoliday,
  resolveZone,
  type ResolvedZone,
  standardHours,
  wallClock,
  type WorkingHours,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

/** Client time and the best time to connect (ADR 0088). */

const KEY = ['me', 'contact-times'] as const;

export function useContactTimes() {
  return useQuery({ queryKey: KEY, queryFn: () => api<ContactTimesResponse>('/me/contact-times'), staleTime: 5 * 60_000 });
}

export function useSaveContactTimes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContactTimes | null) => (body ? api<ContactTimesResponse>('/me/contact-times', { method: 'PUT', json: body }) : api<ContactTimesResponse>('/me/contact-times', { method: 'DELETE' })),
    onSuccess: (res) => qc.setQueryData(KEY, res),
  });
}

/** Ticks on the minute (and every few seconds just after load), so the clocks stay right without a busy timer. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

export interface HolidayList {
  covered: boolean;
  holidays: PublicHoliday[];
}

/** Public holidays for the next three weeks on the client's calendar. */
export function useHolidays(country: string | null | undefined, state: string | null | undefined, zone: string | null) {
  const today = zone ? wallClock(zone, new Date()) : null;
  const from = today ? `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}` : '';
  return useQuery({
    enabled: !!country && !!zone,
    queryKey: ['geo', 'holidays', country, state ?? '', from],
    queryFn: () => api<HolidayList>(`/geo/countries/${country}/holidays?${new URLSearchParams({ from, days: '21', ...(state ? { state } : {}) })}`),
    staleTime: 60 * 60_000,
  });
}

export interface ClientTime {
  zone: ResolvedZone;
  hours: WorkingHours;
  /** Whether the hours are saved on the record (the company's website or the user) or the country's usual day. */
  hoursFrom: 'record' | 'company' | 'standard';
  advice: ConnectAdvice | null;
  me: ContactTimes;
  holidaysCovered: boolean | null;
  /** Public holidays in the next three weeks on their calendar. */
  holidays: PublicHoliday[];
}

/**
 * Everything the card and the "good time?" check need, for one place: the zone from the address, the office hours
 * (the record's own, else the company's, else the usual day), public holidays and my own hours.
 */
export function useClientTime(place: Place, ownHours: unknown, companyHours?: unknown): ClientTime {
  const now = useNow();
  const mine = useContactTimes();
  const zone = resolveZone(place);
  const holidays = useHolidays(place.country, place.state, zone.zone);
  const own = normalizeWorkingHours(ownHours);
  const fromCompany = normalizeWorkingHours(companyHours);
  const hours = own ?? fromCompany ?? standardHours(place.country);
  const me = mine.data?.contactTimes ?? DEFAULT_CONTACT_TIMES;
  const advice = zone.zone ? connectAdvice({ clientZone: zone.zone, hours, holidays: holidays.data?.holidays ?? [], me, now }) : null;
  return { zone, hours, hoursFrom: own ? 'record' : fromCompany ? 'company' : 'standard', advice, me, holidaysCovered: holidays.data ? holidays.data.covered : null, holidays: holidays.data?.holidays ?? [] };
}
