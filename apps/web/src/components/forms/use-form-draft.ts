'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'df-draft:';
const MAX_AGE = 7 * 24 * 3600 * 1000;

interface Stored<T> {
  v: T;
  at: number;
}

export function readDraft<T>(key: string, now = Date.now()): Stored<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored<T>;
    if (typeof d?.at !== 'number' || now - d.at > MAX_AGE) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, v: T | null, now = Date.now()) {
  try {
    if (v === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify({ v, at: now } satisfies Stored<T>));
  } catch {
    /* storage unavailable or full: drafts are a convenience */
  }
}

/**
 * Draft recovery for a form: keeps the values on this device as people type (after a short pause), offers a draft
 * left from an earlier visit, and forgets it once the form is saved. Drafts older than a week are dropped.
 * `isEmpty` decides which values are not worth keeping (an untouched form).
 */
export function useFormDraft<T>(key: string | null, values: T, isEmpty: (v: T) => boolean) {
  const [offer, setOffer] = useState<Stored<T> | null>(null);
  const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On open, look for an earlier draft; saving starts only after the person decides or starts typing.
  useEffect(() => {
    armed.current = false;
    setOffer(key ? readDraft<T>(key) : null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    if (!armed.current) {
      armed.current = true;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (isEmpty(values)) return;
      writeDraft(key, values);
      setOffer(null);
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, key]);

  const discard = useCallback(() => {
    if (key) writeDraft(key, null);
    setOffer(null);
  }, [key]);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (key) writeDraft(key, null);
    setOffer(null);
  }, [key]);
  const take = useCallback(() => {
    const v = offer?.v ?? null;
    setOffer(null);
    return v;
  }, [offer]);

  return { offer: offer ? { savedAt: new Date(offer.at) } : null, take, discard, clear };
}
