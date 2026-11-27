import { z } from 'zod';

/**
 * A person's own profile (ADR 0087): their photo (ADR 0072), a headline, a favourite quote, a short bio, contact
 * details, a few "ask me about" tags, a cover colour and their current mood. One profile per person, shown in every
 * organisation they belong to, to the people in that organisation.
 */

/** The cover behind the photo on the profile and on the profile card. Each is a gradient the web app draws. */
export const PROFILE_COVERS = ['aurora', 'sunset', 'ocean', 'forest', 'ember', 'galaxy', 'candy', 'midnight'] as const;
export type ProfileCover = (typeof PROFILE_COVERS)[number];

/** The mood choices offered first; any other emoji and words can be set too. */
export const MOOD_PRESETS = [
  { emoji: '🎯', text: 'Focused' },
  { emoji: '🚀', text: 'Crushing my targets' },
  { emoji: '🤝', text: 'In meetings' },
  { emoji: '🧠', text: 'Deep work, back soon' },
  { emoji: '☕', text: 'Coffee break' },
  { emoji: '🎉', text: 'Celebrating a win' },
  { emoji: '🌱', text: 'Learning something new' },
  { emoji: '✈️', text: 'Travelling' },
  { emoji: '🏖️', text: 'On holiday' },
  { emoji: '🤒', text: 'Out sick' },
] as const;

/** A mood clears itself at its end time; it can last up to 30 days. */
export const MOOD_MAX_DAYS = 30;
export const PROFILE_TAGS_MAX = 8;

export interface PersonMood {
  emoji: string;
  text: string | null;
  setAt: string;
  /** When it clears itself; null keeps it until it is changed. */
  expiresAt: string | null;
}

/** A date of birth: the year is left out when the person keeps it to themselves. */
export interface PersonBirthday {
  day: number;
  month: number;
  year: number | null;
}

/** GET /me/profile: everything the person can edit about themselves. */
export interface MyProfile {
  userId: string;
  name: string;
  /** The sign-in email: shown, but changed only through the account's own sign-in flow. */
  email: string;
  phone: string | null;
  photoUrl: string | null;
  headline: string | null;
  quote: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  cover: ProfileCover;
  tags: string[];
  mood: PersonMood | null;
  birthday: PersonBirthday | null;
  /** Teammates see the year (and so the age) only when this is on; off by default. */
  birthYearVisible: boolean;
  /** The birthday shows to teammates and is celebrated on their dashboards; on by default. */
  celebrateBirthday: boolean;
  /** How much of the profile is filled in, 0 to 100, for the "complete your profile" meter. */
  completeness: number;
}

/** GET /people/:id/profile: a teammate's profile, for people in the same organisation. */
export interface PersonProfile extends Omit<MyProfile, 'userId' | 'completeness' | 'birthYearVisible' | 'celebrateBirthday'> {
  id: string;
  self: boolean;
  /** Their role, designation and department in the reader's workspace. */
  role: string | null;
  designation: string | null;
  department: string | null;
}

/** Someone whose birthday is today, for the celebration on the dashboards. */
export interface BirthdayPerson {
  id: string;
  name: string;
  photoUrl: string | null;
  /** The age they turn today, only when they share their birth year. */
  age: number | null;
  /** The reader's own birthday. */
  self: boolean;
}

/** GET /people/birthdays (and GET /operator/birthdays in the Console): today's birthdays for the reader's date. */
export interface TodayBirthdays {
  /** The reader's local date (YYYY-MM-DD) the list is for. */
  date: string;
  people: BirthdayPerson[];
}

/** /people/birthdays?date=YYYY-MM-DD, the reader's own local date. */
export const birthdaysQuery = z
  .object({ date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Send the date as YYYY-MM-DD.') })
  .strict();

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (month: number, year: number | null) => [31, year === null || isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;

/** Whether a birthday falls on a date; 29 February is celebrated on 28 February in other years. */
export function birthdayOn(b: { day: number; month: number }, date: string): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  if (b.month === m && b.day === d) return true;
  return b.month === 2 && b.day === 29 && m === 2 && d === 28 && !isLeap(y);
}

/** The age someone turns on their birthday in the year of `date`. */
export function ageOn(year: number, date: string): number {
  return Number(date.slice(0, 4)) - year;
}

/** PUT /me/profile `birthday`: a real date; the year is optional, and must make the person at least 13. */
export const birthdaySchema = z
  .object({
    day: z.number().int().min(1).max(31),
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(1900).nullable().optional(),
  })
  .strict()
  .refine((b) => b.day <= daysIn(b.month, b.year ?? null), 'Enter a date that exists')
  .refine((b) => !b.year || b.year <= new Date().getUTCFullYear() - 13, 'Enter your real year of birth, or leave it out')
  .transform((b) => ({ day: b.day, month: b.month, year: b.year ?? null }));

/** GET /people/cards: the photo, mood and headline of everyone in the workspace, for avatars across the app. */
export interface PersonCard {
  id: string;
  name: string;
  photoUrl: string | null;
  headline: string | null;
  mood: { emoji: string; text: string | null } | null;
}

const phonePattern = /^\+?[0-9 ()-]{6,24}$/;
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

/** A LinkedIn profile or company page; "linkedin.com/in/name" without https:// is accepted and completed. */
export const linkedinUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(u.hostname) && u.pathname.length > 1;
    } catch {
      return false;
    }
  }, 'Enter a LinkedIn address, such as linkedin.com/in/your-name')
  .transform((v) => v || null);

/** PUT /me/profile. Fields left out stay as they are; empty text clears a field. */
export const myProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z
      .string()
      .trim()
      .refine((v) => !v || phonePattern.test(v), 'Enter a phone number with digits only, and an optional + at the start')
      .transform((v) => v || null)
      .nullable()
      .optional(),
    headline: nullableText(80),
    quote: nullableText(160),
    bio: nullableText(600),
    linkedinUrl: linkedinUrlSchema.nullable().optional(),
    cover: z.enum(PROFILE_COVERS).optional(),
    tags: z
      .array(z.string().trim().min(1).max(24))
      .max(PROFILE_TAGS_MAX)
      .transform((tags) => [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()])
      .optional(),
    birthday: birthdaySchema.nullable().optional(),
    birthYearVisible: z.boolean().optional(),
    celebrateBirthday: z.boolean().optional(),
  })
  .strict();
export type MyProfileInput = z.infer<typeof myProfileSchema>;

/** One emoji (with its skin tone, flags and joined forms), nothing else. */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > 16) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
  return segments.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}

/** PUT /me/mood. */
export const moodSchema = z
  .object({
    emoji: z.string().trim().refine(isSingleEmoji, 'Pick one emoji for your mood'),
    text: nullableText(60),
    /** When it clears itself (the web app works out "end of today" in the person's own time zone). */
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type MoodInput = z.infer<typeof moodSchema>;

/** How much of a profile is filled in: photo, headline, quote, bio, phone, LinkedIn, tags and mood count equally. */
export function profileCompleteness(p: Pick<MyProfile, 'photoUrl' | 'headline' | 'quote' | 'bio' | 'phone' | 'linkedinUrl' | 'tags' | 'mood'>): number {
  const parts = [p.photoUrl, p.headline, p.quote, p.bio, p.phone, p.linkedinUrl, p.tags.length ? 'tags' : null, p.mood];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}
