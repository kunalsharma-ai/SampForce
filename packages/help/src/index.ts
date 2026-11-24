/**
 * SampForce in-app help (ADR 0056, ADR 0073): the "i" button topics, the Help Center's categories, FAQs and feature
 * guide, and the rules that show each reader only help for what they can use. Shared by the web app, the API
 * (GET /help for the mobile app) and anything else that explains SampForce, so the words are written once.
 */
export * from './types';
export * from './topics';
export * from './categories';
export * from './faqs';
export * from './access';
export * from './roles';
export * from './product';

import { allGuides } from './access';
import { CONSOLE_FAQS, HELP_FAQS } from './faqs';
import { PRODUCT_BRIEFS } from './product';

/** When the built-in answers and guides were last revised; shown as "Last updated" on them (ADR 0073). */
export const HELP_CONTENT_UPDATED = '2026-11-23';

/** Every built-in key a Console article may edit or hide: faq:<id>, guide:<page id> and feature:<brief id>. */
export function builtinHelpKeys(): Set<string> {
  return new Set([...HELP_FAQS.map((f) => `faq:${f.id}`), ...CONSOLE_FAQS.map((f) => `faq:${f.id}`), ...allGuides().map((g) => `guide:${g.id}`), ...PRODUCT_BRIEFS.map((b) => `feature:${b.id}`)]);
}
