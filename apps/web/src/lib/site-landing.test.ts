import { describe, expect, it } from 'vitest';
import { starCount } from '@/components/site/aurora-canvas';
import { advanceDeals } from '@/components/site/landing-sections';
import { faceFromHash } from '@/components/site/site-context';
import { readSiteMode } from '@/components/site/site-theme';
import { PHRASES } from '@/lib/i18n/phrases';
import { fold, SITE_FAQS, searchSiteFaqs } from '@/lib/site-faq';
import { checkSignupStep, passwordChecks, passwordStrength, SIGNUP_STEPS, stepOfField } from '@/lib/signup-steps';

describe('website light and dark modes', () => {
  it('keeps the visitor’s choice, else follows the device', () => {
    expect(readSiteMode('light', true)).toBe('light');
    expect(readSiteMode('dark', false)).toBe('dark');
    expect(readSiteMode(null, true)).toBe('dark');
    expect(readSiteMode('nonsense', false)).toBe('light');
  });
});

describe('the sign-in and sign-up portal', () => {
  it('opens from its own links only', () => {
    expect(faceFromHash('#sign-in')).toBe('sign-in');
    expect(faceFromHash('#start')).toBe('start');
    expect(faceFromHash('#features')).toBeNull();
    expect(faceFromHash('')).toBeNull();
  });

  it('checks each sign-up step with the API’s own rules', () => {
    expect(checkSignupStep('name', '  ')).toBe('Enter your name');
    expect(checkSignupStep('name', 'Asha')).toBeNull();
    expect(checkSignupStep('email', 'asha@')).not.toBeNull();
    expect(checkSignupStep('email', 'Asha@Example.com')).toBeNull();
    expect(checkSignupStep('password', 'short1')).toBe('Use at least 10 characters');
    expect(checkSignupStep('password', 'longenoughpassword')).toBe('Include at least one number');
    expect(checkSignupStep('password', 'a-long-password-1')).toBeNull();
    expect(checkSignupStep('organizationName', 'A')).toBe('Enter your organization name');
  });

  it('takes the visitor back to the step a server error belongs to', () => {
    expect(SIGNUP_STEPS.map((s) => s.field)).toEqual(['name', 'email', 'password', 'organizationName']);
    expect(stepOfField('email')).toBe(1);
    expect(stepOfField('organizationName')).toBe(3);
    expect(stepOfField('something-else')).toBe(0);
  });

  it('rates passwords the way the rules do', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('abcdefghij')).toBe(2);
    expect(passwordStrength('abcdefghi1')).toBe(3);
    expect(passwordStrength('a-much-longer-passphrase-7')).toBe(4);
    expect(passwordChecks('abcdefghi1')).toEqual({ length: true, letter: true, number: true, long: false });
  });

  it('has a translation for every step', () => {
    for (const s of SIGNUP_STEPS) {
      expect(PHRASES, s.title).toHaveProperty([s.title]);
      expect(PHRASES, s.label).toHaveProperty([s.label]);
    }
  });
});

describe('website Help & Support', () => {
  it('finds answers by any word, best match first, ignoring accents', () => {
    expect(searchSiteFaqs('')).toHaveLength(SITE_FAQS.length);
    expect(searchSiteFaqs('password')[0]!.id).toBe('forgot-password');
    expect(searchSiteFaqs('okta').map((f) => f.id)).toEqual(['sso']);
    expect(searchSiteFaqs('recovery code').map((f) => f.id)).toContain('two-step');
    expect(searchSiteFaqs('zebra crossing')).toEqual([]);
    expect(fold('Réinitialiser')).toBe('reinitialiser');
  });

  it('searches the reader’s language too', () => {
    const french = (s: string) => (PHRASES as Record<string, readonly string[]>)[s]?.[1] ?? s;
    expect(searchSiteFaqs('oublié', french)[0]!.id).toBe('forgot-password');
  });

  it('translates every question, answer and button', () => {
    for (const f of SITE_FAQS) {
      for (const text of [f.question, f.answer, ...(f.action ? [f.action.label] : [])]) expect(PHRASES, text).toHaveProperty([text]);
    }
  });
});

describe('the home page illustrations', () => {
  it('moves one sample deal a stage at a time and starts won deals again', () => {
    const deals = [
      { id: 'a', name: 'A', value: 1, stage: 0 },
      { id: 'b', name: 'B', value: 1, stage: 3 },
    ];
    expect(advanceDeals(deals, 0).map((d) => d.stage)).toEqual([1, 3]);
    expect(advanceDeals(deals, 1).map((d) => d.stage)).toEqual([0, 0]);
  });

  it('scales the starfield to the screen within limits', () => {
    expect(starCount(375, 700)).toBe(24);
    expect(starCount(1440, 900)).toBe(81);
    expect(starCount(5000, 3000)).toBe(110);
  });
});
