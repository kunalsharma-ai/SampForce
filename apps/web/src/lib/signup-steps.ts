import { registerSchema, type RegisterInput } from '@dealflow/types';

/**
 * The website's sign-up, one question at a time (ADR 0078). Each step checks its own field with the same rules the
 * API uses, so a step only moves on when the server would accept that answer.
 */
export const SIGNUP_STEPS = [
  { field: 'name', title: 'What should we call you?', label: 'Your name', autoComplete: 'name', type: 'text' },
  { field: 'email', title: 'Where do you work?', label: 'Work email', autoComplete: 'email', type: 'email' },
  { field: 'password', title: 'Choose a password', label: 'Password', autoComplete: 'new-password', type: 'password' },
  { field: 'organizationName', title: 'Name your workspace', label: 'Organization name', autoComplete: 'organization', type: 'text' },
] as const satisfies readonly { field: keyof RegisterInput; title: string; label: string; autoComplete: string; type: string }[];

export type SignupField = (typeof SIGNUP_STEPS)[number]['field'];

/** The first problem with one answer, or null when the step may move on. */
export function checkSignupStep(field: SignupField, value: string): string | null {
  const result = registerSchema.shape[field].safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Check this answer');
}

/** The step a server error belongs to, so the visitor is taken back to fix it. */
export function stepOfField(path: string): number {
  const i = SIGNUP_STEPS.findIndex((s) => s.field === path);
  return i < 0 ? 0 : i;
}

/** What the password already does, for the live checklist under the field. */
export function passwordChecks(password: string) {
  return {
    length: password.length >= 10,
    letter: /[A-Za-z]/.test(password),
    number: /[0-9]/.test(password),
    /** A bonus, not a rule: long passphrases are the strongest. */
    long: password.length >= 16,
  };
}

/** 0 to 4 bars for the strength meter. */
export function passwordStrength(password: string): number {
  const c = passwordChecks(password);
  if (!password) return 0;
  const rules = Number(c.length) + Number(c.letter) + Number(c.number);
  return rules < 3 ? Math.min(rules, 2) : c.long ? 4 : 3;
}
