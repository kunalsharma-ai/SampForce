import { describe, expect, it } from 'vitest';
import { countryOptions, currencyOptions, formatAmountInput, parseAmount, phoneProblem, splitPhone, timeZoneOptions, toE164 } from './locale-data';
import { fileProblem, formatBytes } from './upload-zone';

describe('form library helpers', () => {
  it('reads amounts in the reader’s number format', () => {
    expect(parseAmount('24,000.50', 'en-US')).toBe(24000.5);
    expect(parseAmount('1.234,5', 'de-DE')).toBe(1234.5);
    expect(parseAmount('12 345,6', 'fr-FR')).toBe(12345.6);
    expect(parseAmount('', 'en-US')).toBeNull();
    expect(parseAmount('twelve', 'en-US')).toBeNull();
    expect(formatAmountInput('24000', 'USD', 'en-US')).toBe('24,000');
    expect(formatAmountInput('24000.5', 'USD', 'en-US')).toBe('24,000.50');
    expect(formatAmountInput('1500', 'JPY', 'en-US')).toBe('1,500');
    expect(formatAmountInput('abc', 'USD', 'en-US')).toBe('abc');
  });

  it('stores valid phone numbers as E.164 and explains invalid ones', () => {
    expect(toE164('020 7946 0958', 'GB')).toBe('+442079460958');
    expect(toE164('98765 43210', 'IN')).toBe('+919876543210');
    expect(toE164('123', 'GB')).toBeNull();
    expect(phoneProblem('+442079460958')).toBeNull();
    expect(phoneProblem('')).toBeNull();
    expect(phoneProblem('+44 123')).toBe('This is not a valid +44 number. Check the digits.');
    expect(phoneProblem('+44 20 7946 095')).toMatch(/not a valid (United Kingdom|\+44) number/);
    expect(phoneProblem('12345')).toMatch(/country code/);
    expect(splitPhone('+442079460958', 'US')).toEqual({ country: 'GB', national: '020 7946 0958' });
    expect(splitPhone('', 'DE')).toEqual({ country: 'DE', national: '' });
  });

  it('lists countries, currencies and time zones by code', () => {
    const countries = countryOptions('en');
    expect(countries.length).toBeGreaterThan(200);
    expect(countries.find((c) => c.value === 'DE')?.label).toBe('Germany');
    expect(currencyOptions().some((c) => c.value === 'EUR')).toBe(true);
    expect(timeZoneOptions().some((z) => /^Asia\/(Kolkata|Calcutta)$/.test(z.value) && z.hint === 'UTC+5:30')).toBe(true);
  });

  it('checks uploads by type and size', () => {
    expect(fileProblem({ name: 'leads.csv', type: 'text/csv', size: 10 }, ['.csv', 'text/csv'], 100)).toBeNull();
    expect(fileProblem({ name: 'LEADS.CSV', type: '', size: 10 }, ['.csv'], 100)).toBeNull();
    expect(fileProblem({ name: 'logo.gif', type: 'image/gif', size: 10 }, ['image/png', 'image/jpeg'], 100)).toBe('logo.gif is not a supported file. Use PNG, JPEG.');
    expect(fileProblem({ name: 'logo.png', type: 'image/png', size: 300_000 }, ['image/*'], 250_000)).toBe('logo.png is 293 KB. The limit is 244 KB.');
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: 0 }, ['image/*'], 10)).toBe('a.png is empty.');
    expect(formatBytes(2_000_000)).toBe('1.9 MB');
  });
});
