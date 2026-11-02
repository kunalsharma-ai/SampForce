import { LANGUAGES, type LanguageCode } from '@dealflow/types';

/**
 * The line added to every model call's system prompt when the person works in another language (ADR 0052): what the
 * model writes for them follows their language, while names, numbers, merge fields and structured values are kept.
 * Calls made outside a request (queued runs, workers) stay in English, since several people may read the result.
 */
export function languageInstruction(language: LanguageCode): string | null {
  if (language === 'en') return null;
  const name = LANGUAGES.find((l) => l.code === language)!.english;
  return [
    `Language: the person using DealFlow works in ${name}.`,
    `Write everything meant for them to read (answers, summaries, reasons, explanations, suggested tasks) in ${name}.`,
    `Write new drafts in ${name} too, unless the request or the text being worked on is clearly in another language; then keep that language.`,
    'Keep names, company names, numbers, dates, merge fields such as {{first_name}}, JSON keys and listed option values exactly as given.',
  ].join(' ');
}

/** The system prompt with the language line appended; unchanged for English. */
export function inLanguagePrompt(system: string, language: LanguageCode): string {
  const line = languageInstruction(language);
  return line ? `${system}\n\n${line}` : system;
}
