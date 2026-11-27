import { createHash } from 'node:crypto';
import { BLANK, type GeneratableType, type QuestionDifficulty, normaliseAnswer } from '@dealflow/types';

/*
 * Drafting assessment questions from learning material without AI (ADR 0097).
 *
 * The engine only ever uses sentences that are in the material: it finds the key terms (repeated names and phrases,
 * acronyms, figures, defined words), scores the sentences that state facts about them, and turns those into fill-in
 * the blanks, multiple choice, true or false, matching and multiple-select questions. Wrong choices come from other
 * terms of the same kind in the same material, so a question never asks about something the material does not say.
 * Every question keeps the sentence it came from, for the manager to check, and nothing is published until a manager
 * approves it. The same text and variant always give the same questions; another variant picks other sentences.
 */

export interface SourceText {
  lessonId: string;
  title: string;
  text: string;
}

export interface DraftQuestion {
  type: GeneratableType;
  text: string;
  instructions: string | null;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: string[][];
  pairs: { id: string; left: string; right: string }[];
  explanation: string;
  difficulty: QuestionDifficulty;
  marks: number;
  lessonId: string;
  sourceExcerpt: string;
}

export interface DraftSummary {
  keyPoints: string[];
  objectives: string[];
  words: number;
}

// ─── Text analysis ───

const STOP = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could did do does doing don't down during each else even ever every few for from further get gets got had has have having he her here hers herself him himself his how however i if in into is isn't it it's its itself just like make makes many may me might more most much must my myself need never no nor not now of off often on once one only or other our ours ourselves out over own per rather really said same say says see she should since so some still such than that that's the their theirs them themselves then there these they this those through thus to too under until up upon us use used uses using very via was wasn't way we well were what when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves first second third next last new also always usually often can't won't let let's lets etc e.g i.e vs`.split(/\s+/),
);
const PRONOUN_START = /^(this|that|these|those|it|they|he|she|we|you|i|such|here|there|which|both|another|other|also|so|but|and|or|then)\b/i;
const CUE = /\b(important|key|essential|always|never|must|should|best|main|critical|recommended|required|rule|step|goal|purpose|means|defined|refers to|is called|known as)\b/i;
/** "X is a/the …", "X means …", "X stands for …": a sentence that defines X. Superlatives ("is the most …") are facts, not definitions. */
const DEFINITION = /^(.{2,60}?)\s+(?:(?:is|are)\s+(?!the (?:most|best|first|only|least|largest|biggest|main)\b)(?:an?|the)|means|refers to|is defined as|is known as|stands for|describes)\s+(.{8,220})$/i;
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ABBREV = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|inc|ltd|no|fig|approx|dept|est)\.$/i;

type TermKind = 'number' | 'acronym' | 'name' | 'phrase' | 'word';

interface Term {
  text: string;
  key: string;
  kind: TermKind;
  count: number;
  score: number;
}

interface Sentence {
  text: string;
  lessonId: string;
  heading: string | null;
  index: number;
  score: number;
  terms: Term[];
}

interface ListBlock {
  lead: string;
  items: string[];
  lessonId: string;
}

interface Analysis {
  sentences: Sentence[];
  terms: Term[];
  lists: ListBlock[];
  definitions: { term: string; meaning: string; sentence: Sentence }[];
  words: number;
  headings: string[];
}

function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let cur = '';
  const parts = paragraph.split(/(?<=[.!?])\s+(?=["'(\p{Lu}\d])/u);
  for (const p of parts) {
    cur = cur ? `${cur} ${p}` : p;
    if (ABBREV.test(cur) || /\b\p{Lu}\.$/u.test(cur)) continue;
    out.push(cur.trim());
    cur = '';
  }
  if (cur) out.push(cur.trim());
  return out;
}

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);
const tokenise = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’&.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? []).map((w) => w.replace(/[’]/g, "'"));
const isStop = (w: string) => STOP.has(w.toLowerCase());

function kindOf(term: string): TermKind {
  if (/^\d[\d.,]*\s*(%|percent|per cent)?(\s+\p{L}+)?$/u.test(term) || /^[$€£₹]\s?\d/.test(term)) return 'number';
  if (/^[A-Z][A-Z0-9&]{1,6}s?$/.test(term)) return 'acronym';
  if (/\s/.test(term) && term.split(' ').every((w) => /^\p{Lu}/u.test(w) || isStop(w))) return 'name';
  if (/\s/.test(term)) return 'phrase';
  return 'word';
}

export function analyse(sources: SourceText[]): Analysis {
  const sentences: Sentence[] = [];
  const lists: ListBlock[] = [];
  const headings: string[] = [];
  let words = 0;
  let index = 0;
  for (const src of sources) {
    let heading: string | null = null;
    let prevLine = '';
    let list: string[] = [];
    let lead = '';
    const flush = () => {
      if (list.length >= 3) lists.push({ lead: lead || heading || src.title, items: list.slice(0, 12), lessonId: src.lessonId });
      list = [];
      lead = '';
    };
    for (const raw of src.text.split('\n')) {
      const line = raw.trim();
      if (!line) {
        flush();
        continue;
      }
      words += wordsOf(line).length;
      if (line.startsWith('# ')) {
        flush();
        heading = line.slice(2).trim();
        if (heading && !/^slide \d+$/i.test(heading)) headings.push(heading);
        prevLine = '';
        continue;
      }
      const bullet = /^(?:[-•*–]|\d{1,2}[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        if (!list.length) {
          // The sentence that introduces the list ("It uses four kinds of questions:"), unless it only points back.
          const intro = /:$/.test(prevLine) ? (splitSentences(prevLine.replace(/:$/, '')).pop() ?? '') : '';
          lead = intro && !PRONOUN_START.test(intro) && wordsOf(intro).length <= 14 ? intro : (heading ?? intro);
        }
        const item = bullet[1]!.replace(/[.;,]$/, '').trim();
        if (wordsOf(item).length <= 14) list.push(item);
        // A long bullet is a statement in its own right.
        if (wordsOf(item).length >= 6) for (const s of splitSentences(item.endsWith('.') ? item : `${item}.`)) sentences.push({ text: s, lessonId: src.lessonId, heading, index: index++, score: 0, terms: [] });
        prevLine = line;
        continue;
      }
      flush();
      for (const s of splitSentences(line)) sentences.push({ text: s, lessonId: src.lessonId, heading, index: index++, score: 0, terms: [] });
      prevLine = line;
    }
    flush();
  }

  // Candidate terms and how often they appear.
  const counts = new Map<string, { text: string; count: number; kind: TermKind; inHeading: boolean }>();
  const bump = (text: string, inHeading = false) => {
    const t = text.trim().replace(/[.,;:]+$/, '');
    if (t.length < 2 || t.length > 60) return;
    const key = normaliseAnswer(t);
    if (!key || isStop(key) || /^\d$/.test(key)) return;
    const e = counts.get(key) ?? { text: t, count: 0, kind: kindOf(t), inHeading: false };
    e.count++;
    e.inHeading ||= inHeading;
    counts.set(key, e);
  };
  const headingText = headings.join(' ').toLowerCase();
  for (const s of sentences) {
    const toks = tokenise(s.text);
    // Figures with their unit: "30 minutes", "15%", "$500".
    for (const m of s.text.matchAll(/(?:[$€£₹]\s?)?\b\d[\d,.]*(?:\s?%|\s(?:percent|per cent|minutes?|hours?|days?|weeks?|months?|years?|seconds?|steps?|calls?|times|questions?|people|customers|leads|deals|stages?|points?)\b)?/gi)) {
      if (m[0].replace(/\D/g, '').length && !/^(19|20)\d\d$/.test(m[0].trim())) bump(m[0]);
    }
    // Acronyms.
    for (const t of toks) if (/^[A-Z][A-Z0-9&]{1,6}s?$/.test(t) && !/^(I|A|OK|AM|PM)$/.test(t)) bump(t);
    // Capitalised names of two or more words.
    for (const m of s.text.matchAll(/\b\p{Lu}[\p{L}'-]+(?:\s+(?:of|and|for|the|to|&)?\s*\p{Lu}[\p{L}'-]+)+/gu)) bump(m[0]);
    // Words and pairs of words that are not filler.
    const content = toks.map((t) => t.toLowerCase());
    for (let i = 0; i < content.length; i++) {
      const w = content[i]!;
      if (isStop(w) || w.length < 4 || /^\d/.test(w)) continue;
      bump(toks[i]!.toLowerCase() === toks[i] ? toks[i]! : toks[i]!.toLowerCase(), headingText.includes(w));
      const next = content[i + 1];
      if (next && !isStop(next) && next.length >= 3 && !/^\d/.test(next)) bump(`${w} ${next}`, headingText.includes(`${w} ${next}`));
    }
  }
  // Defined terms.
  const definitions: Analysis['definitions'] = [];
  for (const s of sentences) {
    const m = DEFINITION.exec(s.text.replace(/[.!]$/, ''));
    if (!m) continue;
    const term = m[1]!.replace(/^(the|a|an)\s+/i, '').trim();
    const meaning = m[2]!.trim();
    if (wordsOf(term).length > 5 || PRONOUN_START.test(term) || isStop(term) || wordsOf(meaning).length < 3) continue;
    bump(term);
    bump(term);
    definitions.push({ term, meaning, sentence: s });
  }

  const total = Math.max(1, words);
  const terms: Term[] = [...counts.entries()]
    .map(([key, e]) => {
      const lengthBonus = e.kind === 'phrase' || e.kind === 'name' ? 1.6 : e.kind === 'acronym' ? 1.5 : e.kind === 'number' ? 1.2 : 1;
      const repeated = e.kind === 'number' ? 1 : Math.min(e.count, 6);
      return { text: e.text, key, kind: e.kind, count: e.count, score: (repeated * lengthBonus * (e.inHeading ? 1.5 : 1) * 1000) / total };
    })
    // A word must come back at least twice to count as a key term; names, acronyms and figures once is enough.
    .filter((t) => (t.kind === 'word' || t.kind === 'phrase' ? t.count >= 2 : true))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  // A pair of words that always appears together makes its single words redundant.
  const top = terms.slice(0, 80);
  const byKey = new Map(top.map((t) => [t.key, t]));

  for (const s of sentences) {
    const lower = normaliseAnswer(s.text);
    s.terms = top.filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t.key)}($|[^\\p{L}\\p{N}])`, 'u').test(lower));
    const n = wordsOf(s.text).length;
    let score = s.terms.reduce((sum, t) => sum + t.score, 0);
    if (n < 6 || n > 45) score *= 0.2;
    if (PRONOUN_START.test(s.text)) score *= 0.35;
    if (/\?$/.test(s.text) || /["“”]/.test(s.text)) score *= 0.4;
    if (!/[.!]$/.test(s.text)) score *= 0.6;
    if (CUE.test(s.text)) score *= 1.4;
    if (DEFINITION.test(s.text)) score *= 1.5;
    if (/\d/.test(s.text)) score *= 1.15;
    s.score = score;
  }
  void byKey;
  return { sentences, terms: top, lists, definitions, words, headings };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Random but repeatable ───

function rng(seed: string): () => number {
  let h = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
}

function shuffle<T>(list: T[], r: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ─── Building questions ───

/** Finds `term` in `sentence` as a whole word, keeping the sentence's own spelling. */
function locate(sentence: string, term: Term): { start: number; end: number; found: string } | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRe(term.text)})($|[^\\p{L}\\p{N}])`, 'iu');
  const m = re.exec(sentence);
  if (!m) return null;
  const start = m.index + m[1]!.length;
  return { start, end: start + m[2]!.length, found: m[2]! };
}

function accepted(found: string, term: Term): string[] {
  const out = new Set([found]);
  if (term.kind === 'number') {
    const digits = /\d[\d,.]*/.exec(found)?.[0];
    if (digits) out.add(digits.replace(/,/g, ''));
    const n = Number(digits?.replace(/,/g, ''));
    if (Number.isInteger(n) && n >= 0 && n < NUMBERS.length) out.add(found.replace(/\d+/, NUMBERS[n]!));
  } else {
    if (/s$/i.test(found) && found.length > 4) out.add(found.replace(/s$/i, ''));
    else out.add(`${found}s`);
  }
  return [...out];
}

/** Wrong choices of the same kind as the right one, from the same material. */
function distractors(right: Term, pool: Term[], count: number, r: () => number, avoid: string): string[] {
  const avoidKey = normaliseAnswer(avoid);
  const ok = (t: Term) => t.key !== right.key && !avoidKey.includes(t.key) && !t.key.includes(right.key) && !right.key.includes(t.key);
  if (right.kind === 'number') {
    const own = pool.filter((t) => t.kind === 'number' && ok(t)).map((t) => t.text);
    const digits = /\d[\d,.]*/.exec(right.text)?.[0] ?? '';
    const n = Number(digits.replace(/,/g, ''));
    const made: string[] = [];
    if (Number.isFinite(n) && n > 0) {
      const steps = Number.isInteger(n) ? [n * 2, Math.max(1, Math.round(n / 2)), n + (n >= 10 ? 10 : 2), Math.max(1, n - (n >= 10 ? 10 : 1)), n * 3] : [n * 2, n / 2, n + 1];
      for (const v of steps) {
        const s = right.text.replace(digits, String(Math.round(v * 100) / 100));
        if (normaliseAnswer(s) !== right.key) made.push(s);
      }
    }
    // Figures that appear in the material first, then nearby values, so every choice looks like the right one.
    return unique([...shuffle(own, r), ...made].filter((s) => normaliseAnswer(s) !== right.key)).slice(0, count);
  }
  // The same kind first (a name for a name, a word for a word), then other terms of similar length.
  const same = pool.filter((t) => ok(t) && t.kind === right.kind);
  const similar = pool.filter((t) => ok(t) && t.kind !== 'number' && t.kind !== right.kind && right.kind !== 'acronym' && Math.abs(wordsOf(t.text).length - wordsOf(right.text).length) <= 1);
  const list = [...shuffle(same, r), ...shuffle(similar, r)].map((t) => matchCase(t.text, right.text));
  return unique(list).slice(0, count);
}

function matchCase(text: string, like: string): string {
  if (/^\p{Lu}/u.test(like) && /^\p{Ll}/u.test(text)) return text.charAt(0).toUpperCase() + text.slice(1);
  if (/^\p{Ll}/u.test(like) && /^\p{Lu}\p{Ll}/u.test(text) && !/\s\p{Lu}/u.test(text)) return text.charAt(0).toLowerCase() + text.slice(1);
  return text;
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normaliseAnswer(s);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const trimSentence = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Puts `word` in place of start..end and makes a preceding "a"/"an" agree with it. */
function replaceAt(sentence: string, start: number, end: number, word: string): string {
  let before = sentence.slice(0, start);
  const art = /(^|\s)(a|an|A|An)\s$/.exec(before);
  if (art) {
    const an = /^[aeiouAEIOU]/.test(word) && !/^(uni|use|one|eu)/i.test(word);
    const fixed = an ? (art[2]!.startsWith('A') ? 'An' : 'an') : art[2]!.startsWith('A') ? 'A' : 'a';
    before = `${before.slice(0, before.length - art[2]!.length - 1)}${fixed} `;
  }
  return trimSentence(`${before}${word}${sentence.slice(end)}`);
}
const optionIds = ['a', 'b', 'c', 'd', 'e', 'f'];

function difficultyOf(type: GeneratableType, s?: Sentence): QuestionDifficulty {
  if (type === 'TRUE_FALSE') return 'EASY';
  if (type === 'MATCHING' || type === 'MULTI') return 'HARD';
  return s && wordsOf(s.text).length > 25 ? 'HARD' : 'MEDIUM';
}

export interface GenerateOptions {
  types: readonly GeneratableType[];
  count: number;
  variant: number;
  difficulty?: QuestionDifficulty;
  /** Sentences of questions that already exist (not used again). */
  existing?: string[];
}

export function generateQuestions(sources: SourceText[], opts: GenerateOptions): { questions: DraftQuestion[]; shortBy: number } {
  const a = analyse(sources);
  const seed = createHash('sha256').update(sources.map((s) => s.text).join('\n')).digest('hex');
  const r = rng(`${seed}:${opts.variant}`);
  const used = new Set((opts.existing ?? []).map(normaliseAnswer));
  const termUses = new Map<string, number>();
  const out: DraftQuestion[] = [];

  // Best sentences first; a variant rotates which of the good ones come first.
  const ranked = a.sentences.filter((s) => s.terms.length && s.score > 0).sort((x, y) => y.score - x.score);
  const pool = ranked.slice(0, Math.max(12, Math.ceil(opts.count * 3)));
  const rotation = pool.length ? (opts.variant * 7) % pool.length : 0;
  const sentences = [...pool.slice(rotation), ...pool.slice(0, rotation), ...ranked.slice(pool.length)];

  const takeSentence = (pred: (s: Sentence) => boolean): Sentence | null => {
    const s = sentences.find((x) => !used.has(normaliseAnswer(x.text)) && pred(x));
    if (s) used.add(normaliseAnswer(s.text));
    return s ?? null;
  };
  const pickTerm = (s: Sentence): Term | null => {
    const candidates = s.terms
      .filter((t) => (termUses.get(t.key) ?? 0) < 2)
      .filter((t) => {
        const at = locate(s.text, t);
        // Not the very first words of the sentence when something better exists, and never the whole sentence.
        return at && at.found.length < s.text.length * 0.6;
      })
      .sort((x, y) => (y.kind === 'number' ? 0.5 : 0) + y.score - ((x.kind === 'number' ? 0.5 : 0) + x.score));
    const t = candidates[0] ?? null;
    if (t) termUses.set(t.key, (termUses.get(t.key) ?? 0) + 1);
    return t;
  };

  const makers: Record<GeneratableType, () => DraftQuestion | null> = {
    FILL_BLANK: () => {
      const s = takeSentence((x) => x.terms.length > 0);
      if (!s) return null;
      const t = pickTerm(s);
      if (!t) return null;
      const at = locate(s.text, t)!;
      const text = trimSentence(`${s.text.slice(0, at.start)}${BLANK}${s.text.slice(at.end)}`);
      return base('FILL_BLANK', s, { text, instructions: 'Type the missing word or words.', blanks: [accepted(at.found, t)], explanation: `The material says: “${s.text}”` });
    },
    MCQ: () => {
      // A defined term gives the clearest question: what it means.
      const def = a.definitions.find((d) => !used.has(normaliseAnswer(d.sentence.text)) && (termUses.get(normaliseAnswer(d.term)) ?? 0) < 2);
      if (def && a.definitions.length >= 3 && r() < 0.6) {
        const wrong = shuffle(a.definitions.filter((d) => d !== def && normaliseAnswer(d.term) !== normaliseAnswer(def.term)), r).slice(0, 3).map((d) => capital(d.meaning));
        if (wrong.length >= 2) {
          used.add(normaliseAnswer(def.sentence.text));
          termUses.set(normaliseAnswer(def.term), (termUses.get(normaliseAnswer(def.term)) ?? 0) + 1);
          return choice('MCQ', def.sentence, `What does “${def.term}” mean, according to the material?`, capital(def.meaning), wrong, r, `The material says: “${def.sentence.text}”`);
        }
      }
      const s = takeSentence((x) => x.terms.length > 0);
      if (!s) return null;
      const t = pickTerm(s);
      if (!t) return null;
      const at = locate(s.text, t)!;
      const wrong = distractors(t, a.terms, 3, r, s.text);
      if (wrong.length < 2) return null;
      const stem = trimSentence(`${s.text.slice(0, at.start)}${BLANK}${s.text.slice(at.end)}`);
      return choice('MCQ', s, `Which answer completes the statement?\n${stem}`, at.found, wrong, r, `The material says: “${s.text}”`);
    },
    TRUE_FALSE: () => {
      const s = takeSentence((x) => x.terms.length > 0 && wordsOf(x.text).length <= 35);
      if (!s) return null;
      const makeFalse = r() < 0.5;
      if (!makeFalse) return base('TRUE_FALSE', s, { text: s.text, instructions: 'Decide whether the statement is true or false.', correctBoolean: true, explanation: `True. The material says: “${s.text}”` });
      const t = pickTerm(s);
      if (!t) return base('TRUE_FALSE', s, { text: s.text, instructions: 'Decide whether the statement is true or false.', correctBoolean: true, explanation: `True. The material says: “${s.text}”` });
      const at = locate(s.text, t)!;
      const swap = distractors(t, a.terms, 1, r, s.text)[0];
      if (!swap) return base('TRUE_FALSE', s, { text: s.text, instructions: 'Decide whether the statement is true or false.', correctBoolean: true, explanation: `True. The material says: “${s.text}”` });
      const changed = replaceAt(s.text, at.start, at.end, matchCase(swap, at.found));
      return base('TRUE_FALSE', s, { text: changed, instructions: 'Decide whether the statement is true or false.', correctBoolean: false, explanation: `False. The material says: “${s.text}”` });
    },
    MATCHING: () => {
      const pairs = a.definitions.filter((d) => !used.has(`match:${normaliseAnswer(d.term)}`));
      const distinct = unique(pairs.map((d) => d.term)).map((term) => pairs.find((d) => d.term === term)!);
      const rows = distinct.length >= 3 ? distinct : [];
      // Tables read as "Header: value; Header: value." give pairs too.
      const tablePairs = rows.length ? [] : tableFacts(a);
      const chosen = (rows.length ? shuffle(rows, r).slice(0, 5).map((d) => ({ left: d.term, right: shorten(d.meaning), s: d.sentence })) : shuffle(tablePairs, r).slice(0, 5));
      if (chosen.length < 3) return null;
      for (const c of chosen) used.add(`match:${normaliseAnswer(c.left)}`);
      const s = chosen[0]!.s;
      return base('MATCHING', s, {
        text: rows.length ? 'Match each term with its meaning.' : 'Match each item with its value from the material.',
        instructions: 'Choose the right match for each item.',
        pairs: chosen.map((c, i) => ({ id: `p${i + 1}`, left: c.left, right: c.right })),
        explanation: chosen.map((c) => `${c.left}: ${c.right}`).join('; '),
        sourceExcerpt: chosen.map((c) => c.s.text).join(' '),
        marks: chosen.length,
      });
    },
    MULTI: () => {
      const list = a.lists.find((l) => !used.has(`list:${normaliseAnswer(l.lead)}:${l.items[0]}`) && l.items.length >= 3);
      if (!list) return null;
      const right = shuffle(list.items, r).slice(0, Math.min(3, list.items.length));
      const others = unique([...a.lists.filter((l) => l !== list).flatMap((l) => l.items), ...a.terms.filter((t) => (t.kind === 'phrase' || t.kind === 'name') && !/\b(and|or)\b/i.test(t.text)).map((t) => capital(t.text))]).filter((x) => !list.items.some((i) => normaliseAnswer(i) === normaliseAnswer(x) || normaliseAnswer(i).includes(normaliseAnswer(x))));
      const wrong = shuffle(others, r).slice(0, 2);
      if (wrong.length < 2) return null;
      used.add(`list:${normaliseAnswer(list.lead)}:${list.items[0]}`);
      const all = shuffle([...right.map((t) => ({ t, ok: true })), ...wrong.map((t) => ({ t, ok: false }))], r);
      const options = all.map((o, i) => ({ id: optionIds[i]!, text: o.t }));
      const lead = list.lead.replace(/[:.]$/, '').trim();
      const s: Sentence = { text: `${lead}: ${list.items.join('; ')}.`, lessonId: list.lessonId, heading: lead, index: 0, score: 0, terms: [] };
      return base('MULTI', s, {
        text: `Which of these does the material list under “${lead}”? Choose all that apply.`,
        instructions: 'Choose every right answer.',
        options,
        correctOptionIds: all.map((o, i) => (o.ok ? optionIds[i]! : null)).filter((x): x is string => !!x),
        explanation: `The material lists: ${list.items.join('; ')}.`,
        marks: 2,
      });
    },
  };

  function base(type: GeneratableType, s: Sentence, q: Partial<DraftQuestion> & { text: string; explanation: string }): DraftQuestion {
    return {
      type,
      instructions: null,
      options: [],
      correctOptionIds: [],
      correctBoolean: null,
      blanks: [],
      pairs: [],
      difficulty: opts.difficulty ?? difficultyOf(type, s),
      marks: 1,
      lessonId: s.lessonId,
      sourceExcerpt: s.text,
      ...q,
    };
  }

  function choice(type: 'MCQ', s: Sentence, text: string, right: string, wrong: string[], rand: () => number, explanation: string): DraftQuestion {
    const all = shuffle([{ t: right, ok: true }, ...wrong.map((t) => ({ t, ok: false }))], rand);
    const options = all.map((o, i) => ({ id: optionIds[i]!, text: o.t }));
    return base(type, s, { text, instructions: 'Choose one answer.', options, correctOptionIds: [optionIds[all.findIndex((o) => o.ok)]!], explanation });
  }

  // Round-robin over the types asked for, so the mix stays even; a type that runs out of material steps aside.
  const types = [...opts.types];
  const failures = new Map<GeneratableType, number>();
  const alive = () => types.filter((t) => (failures.get(t) ?? 0) < 3);
  let i = 0;
  while (out.length < opts.count && alive().length) {
    const list = alive();
    const type = list[i++ % list.length]!;
    const q = makers[type]();
    if (q && !out.some((o) => normaliseAnswer(o.text) === normaliseAnswer(q.text))) {
      out.push(q);
      failures.set(type, 0);
    } else failures.set(type, (failures.get(type) ?? 0) + 1);
  }
  return { questions: out, shortBy: Math.max(0, opts.count - out.length) };
}

function capital(s: string): string {
  const t = s.trim().replace(/[.;]$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function shorten(s: string): string {
  const w = wordsOf(s.replace(/[.;]$/, ''));
  return w.length <= 14 ? capital(w.join(' ')) : `${capital(w.slice(0, 13).join(' '))}…`;
}

/** "Header: value; Header: value." rows (how spreadsheets are read) as item/value pairs on the row's first column. */
function tableFacts(a: Analysis): { left: string; right: string; s: Sentence }[] {
  const out: { left: string; right: string; s: Sentence }[] = [];
  for (const s of a.sentences) {
    const cells = s.text.replace(/\.$/, '').split('; ').map((c) => /^([^:]{1,40}):\s*(.{1,60})$/.exec(c)).filter((m): m is RegExpExecArray => !!m);
    if (cells.length < 2) continue;
    out.push({ left: cells[0]![2]!, right: `${cells[1]![1]}: ${cells[1]![2]}`, s });
  }
  const seenRight = new Set<string>();
  return out.filter((p) => {
    const k = normaliseAnswer(p.right);
    if (seenRight.has(k)) return false;
    seenRight.add(k);
    return true;
  });
}

/** Key learning points (the best sentences, in reading order) and objectives (from headings and defined terms). */
export function summarise(sources: SourceText[]): DraftSummary {
  const a = analyse(sources);
  const best = [...a.sentences].filter((s) => s.score > 0 && !PRONOUN_START.test(s.text) && wordsOf(s.text).length <= 35).sort((x, y) => y.score - x.score).slice(0, 6).sort((x, y) => x.index - y.index);
  const keyPoints = unique(best.map((s) => s.text));
  const objectives: string[] = [];
  for (const h of a.headings.slice(0, 12)) {
    if (objectives.length >= 4) break;
    if (wordsOf(h).length > 8 || /^(introduction|summary|conclusion|overview|contents|agenda|questions|thank you)/i.test(h)) continue;
    const lowered = /^(The|A|An)\s/.test(h) || (/^\p{Lu}\p{Ll}/u.test(h) && !/\s\p{Lu}/u.test(h)) ? h.charAt(0).toLowerCase() + h.slice(1) : h;
    objectives.push(`Understand ${lowered}`);
  }
  for (const d of a.definitions) {
    if (objectives.length >= 5) break;
    objectives.push(`Explain what ${d.term} means`);
  }
  return { keyPoints, objectives: unique(objectives), words: a.words };
}
