/**
 * Small fuzzy matcher for the command palette. Every query word must appear in the text, either as a substring or as
 * an in-order subsequence of letters ("qbs" finds "Quick Bid Studio"). Higher scores are better; null means no match.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const t = text.toLowerCase();
  let total = 0;
  for (const w of words) {
    const s = wordScore(t, w);
    if (s === null) return null;
    total += s;
  }
  return total;
}

function wordScore(t: string, w: string): number | null {
  const at = t.indexOf(w);
  if (at === 0) return 100 + w.length;
  if (at > 0) return (/[\s\-/&]/.test(t[at - 1]!) ? 80 : 60) + w.length;
  // Initials: "qbs" for "Quick Bid Studio", "qp" for "Quotes & Proposals".
  const initials = t.split(/[\s\-/&]+/).filter(Boolean).map((x) => x[0]).join('');
  if (w.length >= 2 && isSubsequence(w, initials)) return 70 + w.length;
  // Subsequence: reward letters that start words and runs of consecutive letters. The letters must sit close
  // together (a span of at most four times the word), so long texts do not match every query by accident.
  let best: number | null = null;
  for (let start = t.indexOf(w[0]!); start !== -1; start = t.indexOf(w[0]!, start + 1)) {
    let score = 0;
    let pos = start - 1;
    let run = 0;
    let ok = true;
    for (const ch of w) {
      const next = t.indexOf(ch, pos + 1);
      if (next === -1 || next - start >= w.length * 4) {
        ok = false;
        break;
      }
      run = next === pos + 1 ? run + 1 : 0;
      score += 1 + run + (next === 0 || /[\s\-/&]/.test(t[next - 1]!) ? 3 : 0);
      pos = next;
    }
    if (ok) best = Math.max(best ?? 0, Math.min(score, 50));
  }
  return best;
}

function isSubsequence(w: string, t: string): boolean {
  let pos = 0;
  for (const ch of w) {
    pos = t.indexOf(ch, pos) + 1;
    if (pos === 0) return false;
  }
  return true;
}

/** Filters and sorts items by how well `text(item)` matches the query; keeps the original order for ties. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(text(item), query) }))
    .filter((r): r is { item: T; i: number; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.item);
}
