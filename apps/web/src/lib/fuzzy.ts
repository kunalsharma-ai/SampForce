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
  // Subsequence: reward letters that start words and runs of consecutive letters.
  let score = 0;
  let pos = -1;
  let run = 0;
  for (const ch of w) {
    const next = t.indexOf(ch, pos + 1);
    if (next === -1) return null;
    run = next === pos + 1 ? run + 1 : 0;
    score += 1 + run + (next === 0 || /[\s\-/&]/.test(t[next - 1]!) ? 3 : 0);
    pos = next;
  }
  return Math.min(score, 50);
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
