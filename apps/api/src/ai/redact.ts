/**
 * Replaces email addresses, phone numbers and card-like numbers with placeholders before text leaves
 * for the AI provider, and puts the originals back into the model's answer. The same value always maps
 * to the same placeholder within one redactor, so the model can still refer to it.
 */
const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // 13-19 digits with optional spaces or dashes: card-like numbers. The lookarounds keep ids and dates intact.
  { kind: 'CARD', re: /(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])/g },
  { kind: 'PHONE', re: /(?<![\w-])(?:\+\d{1,3}[ .-]?)?\(?\d{2,4}\)?[ .-]\d{3,4}[ .-]\d{3,4}(?![\w-])/g },
];

export class Redactor {
  private readonly toPlaceholder = new Map<string, string>();
  private readonly toValue = new Map<string, string>();

  redact(text: string): string {
    let out = text;
    for (const { kind, re } of PATTERNS) {
      out = out.replace(re, (match) => {
        if (/^\[[A-Z]+_\d+\]$/.test(match)) return match;
        let ph = this.toPlaceholder.get(match);
        if (!ph) {
          ph = `[${kind}_${this.toPlaceholder.size + 1}]`;
          this.toPlaceholder.set(match, ph);
          this.toValue.set(ph, match);
        }
        return ph;
      });
    }
    return out;
  }

  /** Card-like numbers are never restored: nothing in SampForce should echo them back. */
  restore(text: string): string {
    return text.replace(/\[(EMAIL|PHONE|CARD)_\d+\]/g, (ph) => (ph.startsWith('[CARD_') ? '[number removed]' : (this.toValue.get(ph) ?? ph)));
  }

  /** Redacts every string inside a JSON-like value. */
  redactDeep<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.redactDeep(v)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.redactDeep(v)])) as T;
    }
    return value;
  }

  restoreDeep<T>(value: T): T {
    if (typeof value === 'string') return this.restore(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.restoreDeep(v)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.restoreDeep(v)])) as T;
    }
    return value;
  }

  get count(): number {
    return this.toPlaceholder.size;
  }
}

/** Marks text from outside the workspace (emails, notes from customers) as data, not instructions. */
export function untrusted(source: string, text: string): string {
  const clean = text.replace(/<\/?untrusted_data[^>]*>/gi, '');
  return `<untrusted_data source="${source}">\n${clean}\n</untrusted_data>`;
}
