import { AsYouType, type CountryCode, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { ComboOption } from './combobox';

/**
 * Country, currency, time zone and phone helpers for the form library. Names come from the browser's Intl data, so
 * they follow the reader's language; codes stay ISO (countries, currencies) or IANA (time zones), which is what the
 * API stores.
 */

const display = (type: 'region' | 'currency', locale?: string) => {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type });
  } catch {
    return null;
  }
};

export function countryName(code: string, locale?: string): string {
  return display('region', locale)?.of(code) ?? code;
}

let countryCache: { locale: string | undefined; options: ComboOption[] } | null = null;
/** Every country libphonenumber knows (ISO 3166-1 alpha-2), sorted by name in the reader's language. */
export function countryOptions(locale?: string): ComboOption[] {
  if (countryCache && countryCache.locale === locale) return countryCache.options;
  const options = getCountries()
    .map((c) => ({ value: c, label: countryName(c, locale), keywords: c, hint: c }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  countryCache = { locale, options };
  return options;
}

let currencyCache: ComboOption[] | null = null;
export function currencyOptions(): ComboOption[] {
  if (currencyCache) return currencyCache;
  const names = display('currency');
  const codes: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : ['USD', 'EUR', 'GBP', 'INR', 'JPY'];
  currencyCache = codes.map((c) => ({ value: c, label: `${c} · ${names?.of(c) ?? c}`, keywords: names?.of(c) ?? '' }));
  return currencyCache;
}

let zoneCache: ComboOption[] | null = null;
export function timeZoneOptions(): ComboOption[] {
  if (zoneCache) return zoneCache;
  const zones: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];
  zoneCache = zones.map((z) => ({ value: z, label: z.replace(/_/g, ' '), keywords: z, hint: utcOffset(z) }));
  return zoneCache;
}

function utcOffset(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return part?.value.replace('GMT', 'UTC') ?? '';
  } catch {
    return '';
  }
}

/** The symbol a currency is written with in this locale ("$", "€", "₹"), or the code when there is none. */
export function currencySymbol(currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Grouped amount without the symbol ("24,000.5" → "24,000.50" in en-US). Returns the input when it is not a number. */
export function formatAmountInput(raw: string, currency: string, locale?: string): string {
  const n = parseAmount(raw, locale);
  if (n === null) return raw;
  try {
    const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return new Intl.NumberFormat(locale, { minimumFractionDigits: n % 1 === 0 ? 0 : digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return String(n);
  }
}

/** Reads an amount typed with the locale's group and decimal separators ("1.234,5" in de-DE). Null when not a number. */
export function parseAmount(raw: string, locale?: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === 'group')?.value ?? ',';
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const normal = s.split(group).join('').replace(/\s/g, '').split(decimal).join('.');
  if (!/^-?\d*\.?\d+$/.test(normal) && !/^-?\d+\.?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export interface PhoneValue {
  country: CountryCode;
  national: string;
}

export const dialCode = (c: CountryCode) => `+${getCountryCallingCode(c)}`;

/** Splits a stored phone ("+442079460958") into a country and the national part for editing. */
export function splitPhone(stored: string, fallback: CountryCode): PhoneValue {
  const p = stored ? parsePhoneNumberFromString(stored, fallback) : undefined;
  if (p?.country) return { country: p.country, national: p.formatNational() };
  return { country: fallback, national: stored };
}

/** Formats as the person types, in the national style of the chosen country. */
export function formatAsYouType(national: string, country: CountryCode): string {
  return new AsYouType(country).input(national);
}

/** The value to store: E.164 when the number is valid for the country, otherwise null. */
export function toE164(national: string, country: CountryCode): string | null {
  if (!national.trim()) return null;
  const p = parsePhoneNumberFromString(national, country);
  return p?.isValid() ? p.number : null;
}

/** A plain-language problem with a phone number, or null when it is fine (or empty). */
export function phoneProblem(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const p = parsePhoneNumberFromString(stored);
  if (!p) return 'Enter a phone number with its country code.';
  if (!p.isValid()) return `This is not a valid ${p.country ? countryName(p.country) : `+${p.countryCallingCode}`} number. Check the digits.`;
  return null;
}

export function defaultCountry(): CountryCode {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && (getCountries() as string[]).includes(region)) return region as CountryCode;
  } catch {
    /* fall through */
  }
  return 'US';
}
