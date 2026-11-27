import { z } from 'zod';

/*
 * Today's special day on the home dashboards (Kunal, 2026-11-27): beside the live clock, the banner says when today is
 * a public holiday in the person's country, a well-known day celebrated around the world, or an event the Super
 * Workspace added for the company (a founding day, an annual party, an office closure).
 */

export type SpecialDayKind = 'HOLIDAY' | 'OBSERVANCE' | 'COMPANY';

export interface SpecialDay {
  kind: SpecialDayKind;
  /** In the reader's language where the source has it. */
  name: string;
  emoji: string;
  /** A company event's own note ("Office closes at 3 pm"). */
  note: string | null;
}

export interface TodaySpecialDays {
  /** The person's local date the list is for (YYYY-MM-DD). */
  date: string;
  /** The country whose public holidays were checked (ISO 3166-1 alpha-2), or null when none could be told. */
  country: string | null;
  days: SpecialDay[];
}

export const ymdSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use a date like 2026-12-25.');

export const specialDaysQuery = z.object({
  date: ymdSchema,
  /** The person's own time zone (IANA), which tells their country. */
  zone: z.string().trim().max(64).optional(),
});

export const COMPANY_EVENTS_MAX = 100;

export const companyEventSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    emoji: z.string().trim().max(16).default('🎉'),
    date: ymdSchema,
    /** Comes back on the same day every year (a founding day), or only on this date. */
    yearly: z.boolean().default(false),
    note: z.string().trim().max(160).nullable().default(null),
  })
  .strict();
export type CompanyEventInput = z.input<typeof companyEventSchema>;
export type CompanyEvent = z.output<typeof companyEventSchema> & { id: string };

export const companyEventsSchema = z.object({ events: z.array(companyEventSchema.extend({ id: z.string().max(64).optional() })).max(COMPANY_EVENTS_MAX) }).strict();
export type CompanyEventsInput = z.input<typeof companyEventsSchema>;

export interface CompanyEventsSettings {
  events: CompanyEvent[];
  canEdit: boolean;
}

/** Whether a company event falls on `date` (YYYY-MM-DD): the same date, or the same day and month for a yearly one. */
export function companyEventOn(e: Pick<CompanyEvent, 'date' | 'yearly'>, date: string): boolean {
  return e.yearly ? e.date.slice(5) === date.slice(5) && e.date <= date : e.date === date;
}

/** Names in English, Spanish, French, German and Arabic, the five SampForce languages. */
type Names = readonly [string, string, string, string, string];
const LANG_ORDER = ['en', 'es', 'fr', 'de', 'ar'] as const;

/** Well-known days marked around the world (fixed dates, MM-DD), for every country. */
export const WORLD_DAYS: readonly { md: string; emoji: string; names: Names }[] = [
  { md: '01-01', emoji: '🎆', names: ['New Year’s Day', 'Año Nuevo', 'Jour de l’An', 'Neujahr', 'رأس السنة الميلادية'] },
  { md: '02-14', emoji: '💝', names: ['Valentine’s Day', 'Día de San Valentín', 'Saint-Valentin', 'Valentinstag', 'عيد الحب'] },
  { md: '03-08', emoji: '💜', names: ['International Women’s Day', 'Día Internacional de la Mujer', 'Journée internationale des femmes', 'Internationaler Frauentag', 'اليوم الدولي للمرأة'] },
  { md: '03-20', emoji: '😊', names: ['International Day of Happiness', 'Día Internacional de la Felicidad', 'Journée internationale du bonheur', 'Weltglückstag', 'اليوم الدولي للسعادة'] },
  { md: '04-07', emoji: '🩺', names: ['World Health Day', 'Día Mundial de la Salud', 'Journée mondiale de la santé', 'Weltgesundheitstag', 'يوم الصحة العالمي'] },
  { md: '04-22', emoji: '🌍', names: ['Earth Day', 'Día de la Tierra', 'Jour de la Terre', 'Tag der Erde', 'يوم الأرض'] },
  { md: '05-01', emoji: '🛠️', names: ['International Workers’ Day', 'Día Internacional de los Trabajadores', 'Fête du Travail', 'Tag der Arbeit', 'عيد العمال'] },
  { md: '06-05', emoji: '🌱', names: ['World Environment Day', 'Día Mundial del Medio Ambiente', 'Journée mondiale de l’environnement', 'Weltumwelttag', 'اليوم العالمي للبيئة'] },
  { md: '06-21', emoji: '🧘', names: ['International Day of Yoga', 'Día Internacional del Yoga', 'Journée internationale du yoga', 'Internationaler Yogatag', 'اليوم الدولي لليوغا'] },
  { md: '08-12', emoji: '🌟', names: ['International Youth Day', 'Día Internacional de la Juventud', 'Journée internationale de la jeunesse', 'Internationaler Tag der Jugend', 'اليوم الدولي للشباب'] },
  { md: '09-21', emoji: '🕊️', names: ['International Day of Peace', 'Día Internacional de la Paz', 'Journée internationale de la paix', 'Internationaler Friedenstag', 'اليوم الدولي للسلام'] },
  { md: '10-01', emoji: '☕', names: ['International Coffee Day', 'Día Internacional del Café', 'Journée internationale du café', 'Internationaler Tag des Kaffees', 'اليوم العالمي للقهوة'] },
  { md: '10-05', emoji: '🍎', names: ['World Teachers’ Day', 'Día Mundial de los Docentes', 'Journée mondiale des enseignants', 'Weltlehrertag', 'اليوم العالمي للمعلمين'] },
  { md: '10-31', emoji: '🎃', names: ['Halloween', 'Halloween', 'Halloween', 'Halloween', 'الهالوين'] },
  { md: '11-13', emoji: '💛', names: ['World Kindness Day', 'Día Mundial de la Bondad', 'Journée mondiale de la gentillesse', 'Welttag der Freundlichkeit', 'اليوم العالمي للطف'] },
  { md: '11-19', emoji: '🤝', names: ['International Men’s Day', 'Día Internacional del Hombre', 'Journée internationale des hommes', 'Internationaler Männertag', 'اليوم العالمي للرجل'] },
  { md: '12-25', emoji: '🎄', names: ['Christmas Day', 'Navidad', 'Noël', 'Weihnachten', 'عيد الميلاد'] },
  { md: '12-31', emoji: '🥂', names: ['New Year’s Eve', 'Nochevieja', 'Saint-Sylvestre', 'Silvester', 'ليلة رأس السنة'] },
];

/** The world days on `date`, named in `language`. */
export function worldDaysOn(date: string, language: string): SpecialDay[] {
  const i = Math.max(0, LANG_ORDER.indexOf(language as (typeof LANG_ORDER)[number]));
  return WORLD_DAYS.filter((d) => d.md === date.slice(5)).map((d) => ({ kind: 'OBSERVANCE', name: d.names[i]!, emoji: d.emoji, note: null }));
}

const HOLIDAY_EMOJI: readonly [RegExp, string][] = [
  [/christmas|navidad|noël|weihnacht|natal/i, '🎄'],
  [/new year|año nuevo|nouvel an|neujahr|jour de l.an/i, '🎆'],
  [/diwali|deepavali/i, '🪔'],
  [/holi\b/i, '🎨'],
  [/eid|ramadan|ramzan|bakrid|muharram|islamic new year|mawlid|milad/i, '🌙'],
  [/easter|pascua|pâques|ostern|good friday/i, '🐣'],
  [/thanksgiving/i, '🦃'],
  [/independence|republic|national|liberation|freedom|constitution|unity/i, '🎉'],
  [/labou?r|workers|trabajo|travail|arbeit/i, '🛠️'],
  [/mother/i, '💐'],
  [/father/i, '👔'],
  [/valentine/i, '💝'],
  [/halloween/i, '🎃'],
  [/hanukkah|chanukah/i, '🕎'],
  [/lunar new year|chinese new year|spring festival/i, '🧧'],
  [/gandhi/i, '🕊️'],
  [/janmashtami|krishna/i, '🦚'],
  [/ganesh/i, '🐘'],
  [/dussehra|dasara|navratri|durga/i, '🏹'],
  [/pongal|sankranti|lohri|onam|baisakhi|vaisakhi/i, '🌾'],
  [/buddha|vesak/i, '🪷'],
  [/guru nanak|gurpurab/i, '🙏'],
];

/** An emoji that suits a holiday's name, or a party popper. */
export function holidayEmoji(name: string): string {
  return HOLIDAY_EMOJI.find(([re]) => re.test(name))?.[1] ?? '🎉';
}

/** The person's local calendar date (YYYY-MM-DD) for `d`. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
