import { describe, expect, it } from 'vitest';
import { dialableNumber } from './dial-number';

describe('a clicked number for the dialer', () => {
  it('keeps the number as written, with its country code and spacing', () => {
    expect(dialableNumber('+91 98200 12345')).toBe('+91 98200 12345');
    expect(dialableNumber('+44 (0)20 7946-0018')).toBe('+44 (0)20 7946-0018');
    expect(dialableNumber('(212) 555-0142')).toBe('(212) 555-0142');
    expect(dialableNumber('0044 20 7946 0018')).toBe('0044 20 7946 0018');
    expect(dialableNumber('  022   4000\t1000 ')).toBe('022 4000 1000');
    expect(dialableNumber('+1 - 415 - 555 - 0100')).toBe('+1-415-555-0100');
  });

  it('takes the number out of phone links', () => {
    expect(dialableNumber('tel:+919820012345')).toBe('+919820012345');
    expect(dialableNumber('tel:+1-415-555-0100;ext=22')).toBe('+1-415-555-0100');
    expect(dialableNumber('callto:%2B44%2020%207946%200018')).toBe('+44 20 7946 0018');
    expect(dialableNumber('sip:+4420794600@sip.example.com')).toBe('+4420794600');
  });

  it('drops what a dialer cannot dial', () => {
    expect(dialableNumber('+1 415.555.0100 ext. 23')).toBe('+1 415 555 0100');
    expect(dialableNumber('+1 415 555 0100 x23')).toBe('+1 415 555 0100');
    expect(dialableNumber('Tel: +91 22 4000 1000')).toBe('+91 22 4000 1000');
    expect(dialableNumber('98 +20 12345')).toBe('98 20 12345');
    expect(dialableNumber('*123#')).toBe('*123#');
  });

  it('refuses empty and impossible numbers', () => {
    for (const bad of [null, undefined, '', '   ', 'No number', '—', '12', '+', '1234567890123456789012']) expect(dialableNumber(bad)).toBeNull();
  });

  it('keeps long numbers within the dialer field', () => {
    expect(dialableNumber('+1 ( 415 ) - ( 555 ) - ( 0100 ) - ( 0100 ) - ( 0100 )')).toBe('+1415555010001000100');
  });
});
