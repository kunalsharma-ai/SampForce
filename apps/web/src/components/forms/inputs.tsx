'use client';

import { cn } from '@dealflow/ui';
import type { CountryCode } from 'libphonenumber-js';
import { Minus, Plus } from 'lucide-react';
import * as React from 'react';
import { fmtLocale } from '@/lib/i18n/locale';
import { Combobox, type ComboOption } from './combobox';
import {
  countryOptions,
  currencyOptions,
  currencySymbol,
  defaultCountry,
  dialCode,
  formatAmountInput,
  formatAsYouType,
  parseAmount,
  splitPhone,
  timeZoneOptions,
  toE164,
} from './locale-data';

interface AriaProps {
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const inputClass =
  'h-control w-full bg-surface py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const shellClass =
  'flex w-full items-stretch overflow-hidden rounded-md border border-input bg-surface focus-within:ring-2 focus-within:ring-ring has-[[aria-invalid=true]]:border-critical';

/** Searchable country picker; stores the ISO 3166-1 alpha-2 code. */
export function CountrySelect(props: AriaProps & { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const options = React.useMemo(() => countryOptions(fmtLocale()), []);
  return <Combobox {...props} options={options} placeholder="Search countries" />;
}

/** Searchable ISO 4217 currency picker. */
export function CurrencySelect(props: AriaProps & { value: string; onChange: (code: string) => void; disabled?: boolean; placeholder?: string }) {
  const options = React.useMemo(() => currencyOptions(), []);
  return <Combobox placeholder="Search currencies" {...props} options={options} />;
}

/** Searchable IANA time zone picker with the current UTC offset beside each zone. */
export function TimeZoneSelect(props: AriaProps & { value: string; onChange: (zone: string) => void; disabled?: boolean }) {
  const options = React.useMemo<ComboOption[]>(() => timeZoneOptions(), []);
  return <Combobox {...props} options={options} placeholder="Search time zones" />;
}

/**
 * Phone number with a country code picker. Formats as you type in that country's style and stores E.164
 * ("+442079460958") once the number is valid; an incomplete number is kept as typed so validation can explain it.
 */
export function PhoneInput({
  value,
  onChange,
  disabled,
  defaultCountryCode,
  ...aria
}: AriaProps & { value: string; onChange: (v: string) => void; disabled?: boolean; defaultCountryCode?: CountryCode }) {
  const fallback = React.useMemo(() => defaultCountryCode ?? defaultCountry(), [defaultCountryCode]);
  const [state, setState] = React.useState(() => splitPhone(value, fallback));
  const emitted = React.useRef(value);
  React.useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setState(splitPhone(value, fallback));
    }
  }, [value, fallback]);
  const options = React.useMemo(() => countryOptions(), []);
  const emit = (country: CountryCode, national: string) => {
    setState({ country, national });
    const v = !national.trim() ? '' : (toE164(national, country) ?? (national.trim().startsWith('+') ? national.trim() : `${dialCode(country)} ${national.trim()}`));
    emitted.current = v;
    onChange(v);
  };
  return (
    <div className={shellClass}>
      <select
        aria-label="Calling code"
        disabled={disabled}
        value={state.country}
        onChange={(e) => emit(e.target.value as CountryCode, state.national)}
        className="w-24 shrink-0 border-e border-input bg-muted/40 px-2 text-sm focus-visible:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} {dialCode(o.value as CountryCode)}
          </option>
        ))}
      </select>
      <input
        {...aria}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        value={state.national}
        onChange={(e) => emit(state.country, e.target.value)}
        onBlur={() => state.national && setState((s) => ({ ...s, national: formatAsYouType(s.national, s.country) }))}
        className={cn(inputClass, 'px-3')}
      />
    </div>
  );
}

/**
 * Money amount with the currency symbol in front. Shows grouped digits ("24,000") when not being edited and the
 * plain number while typing; emits a plain number string ("24000.5"), or the text as typed when it is not a number.
 */
export function CurrencyInput({
  value,
  onChange,
  currency,
  disabled,
  ...aria
}: AriaProps & { value: string; onChange: (v: string) => void; currency: string; disabled?: boolean }) {
  const [focused, setFocused] = React.useState(false);
  const locale = fmtLocale();
  const symbol = currencySymbol(currency, locale);
  return (
    <div className={shellClass}>
      <span className="flex shrink-0 items-center border-e border-input bg-muted/40 px-2.5 text-sm text-muted-foreground" aria-hidden>
        {symbol}
      </span>
      <input
        {...aria}
        inputMode="decimal"
        disabled={disabled}
        value={focused ? value : formatAmountInput(value, currency, locale)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const n = parseAmount(e.target.value, locale);
          onChange(n === null || /[.,]$/.test(e.target.value) ? e.target.value : String(n));
        }}
        className={cn(inputClass, 'px-3 text-end tabular-nums')}
      />
      <span className="flex shrink-0 items-center pe-2.5 text-xs text-muted-foreground">{currency}</span>
    </div>
  );
}

/** Number field with − and + buttons, clamped to min and max; arrow keys step too. Emits a string ("" when empty). */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  label,
  disabled,
  ...aria
}: AriaProps & {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Used for the buttons: "Decrease {label}". */
  label: string;
  disabled?: boolean;
}) {
  const n = value === '' ? null : Number(value);
  const clamp = (x: number) => Math.min(max, Math.max(min, Math.round(x / step) * step));
  const bump = (dir: 1 | -1) => {
    const valid = n !== null && Number.isFinite(n);
    // From empty, + starts one step above the minimum and − starts at the minimum.
    onChange(String(clamp(valid ? n + dir * step : dir === 1 ? min + step : min)));
  };
  const btn = 'grid w-9 shrink-0 place-items-center text-muted-foreground hover:bg-muted disabled:opacity-40';
  return (
    <div className={shellClass}>
      <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} disabled={disabled || (n !== null && n <= min)} onClick={() => bump(-1)} className={cn(btn, 'border-e border-input')}>
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        {...aria}
        role="spinbutton"
        inputMode="decimal"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={n !== null && Number.isFinite(n) ? n : undefined}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
        onBlur={() => n !== null && Number.isFinite(n) && n !== clamp(n) && onChange(String(clamp(n)))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
        className={cn(inputClass, 'min-w-0 px-2 text-center tabular-nums')}
      />
      {suffix && (
        <span className="flex shrink-0 items-center pe-1 text-sm text-muted-foreground" aria-hidden>
          {suffix}
        </span>
      )}
      <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} disabled={disabled || (n !== null && n >= max)} onClick={() => bump(1)} className={cn(btn, 'border-s border-input')}>
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
