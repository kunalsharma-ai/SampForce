'use client';

import * as React from 'react';

/**
 * Clicking a phone number anywhere in Calls puts it in the dialer (ADR 0101 follow-up). The number goes in as it is
 * written, so the country code, spaces, hyphens and brackets stay as people expect to see them; only what a dialer
 * cannot dial is taken out.
 */

/** Where a clicked number came from, so the call stays on the company and contact it belongs to. */
export type DialLink = {
  companyId: string | null;
  contactId: string | null;
  /** EMPLOYEE or COMPANY when it is that record's current number; OTHER for a number as it was on an older call. */
  source: 'EMPLOYEE' | 'COMPANY' | 'OTHER';
  /** Who the number is for, shown under the dialer ("For Priya Nair · Acme Panels"). */
  label?: string | null;
};

export type DialRequest = { number: string; link: DialLink | null; seq: number };

const MAX = 40;

/**
 * The number as the dialer should show it, or null when there is nothing to dial.
 *
 * - `tel:`, `callto:` and `sip:` links lose the scheme and anything after `;` or `?` (`;ext=`, `?call`).
 * - Letters, dots and slashes go, and so does a written extension (`ext. 23`, `x23`), which no dialer link takes.
 * - `+` is kept only at the start; `00` stays as written; `*` and `#` stay for service codes.
 * - Spaces, hyphens and brackets stay, tidied to single spaces.
 * - At least 3 and at most 20 digits. Written out longer than the dialer field takes, it becomes the digits alone.
 */
export function dialableNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // Not encoded: keep it as it is.
  }
  s = s.replace(/^(?:tel|callto|sip|sips):\/{0,2}/i, '');
  s = s.split(/[;?@]/)[0]!;
  s = s.replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, '');
  const plus = /^\s*\+/.test(s);
  s = s.replace(/[^\d*#()\-\s]/g, ' ');
  s = s.replace(/\(\s*\)/g, ' ').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-)\s]+|[-(\s]+$/g, '');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 20) return null;
  const out = `${plus ? '+' : ''}${s}`;
  // Too long to show as written: the digits alone, never cut short.
  return out.length <= MAX ? out : `${plus ? '+' : ''}${digits}`;
}

type DialContextValue = { fill: (raw: string, link?: DialLink | null) => boolean };

export const DialContext = React.createContext<DialContextValue | null>(null);

/** Put a number in the dialer from anywhere inside the Calls page; null outside it. */
export function useDialNumber(): DialContextValue | null {
  return React.useContext(DialContext);
}
