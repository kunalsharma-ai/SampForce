/**
 * One help sentence in every language, side by side so a reviewer reads it once in each: English, Spanish, French,
 * German, Arabic. Help text is written for the person using the screen, not for developers.
 */
export type HelpText = readonly [en: string, es: string, fr: string, de: string, ar: string];

/**
 * What an "i" button explains about a page, section or setting: what it is for, how to use it, and where or when it
 * is useful. `title` is the English name shown on the screen; it is translated through the page phrase tables, so the
 * popover uses the same wording as the heading next to it.
 */
export interface HelpTopic {
  title: string;
  what: HelpText;
  how: HelpText;
  where: HelpText;
}

export type HelpTable = Readonly<Record<string, HelpTopic>>;
