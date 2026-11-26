import { expect, type Page } from '@playwright/test';

/*
 * Layout checks for the redesign (R1 onward): no text drawn over other text, no text cut off without an ellipsis,
 * and no sideways scrolling. Kunal asked for screens "without glitches, overlapping text and design errors" in
 * light and dark themes, so every redesigned screen runs these at desktop, tablet and phone widths.
 */

interface Problem {
  kind: 'overlap' | 'clipped' | 'page-wider-than-window';
  a: string;
  b?: string;
}

/** Fails when two pieces of visible text overlap, or text is clipped without an ellipsis, inside `scope`. */
export async function expectCleanLayout(page: Page, scope = 'body') {
  const problems = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return [{ kind: 'overlap', a: `no ${selector}` }] as Problem[];
    const out: Problem[] = [];
    const describe = (el: Element) => {
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${text}"`;
    };
    const visible = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      // Screen-reader-only text is a 1px box.
      return r.width > 2 && r.height > 2;
    };
    type Box = { el: Element; r: DOMRect };
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      // A text range reports its full width even where an ancestor clips it (an ellipsis), so cut it to what shows.
      let clip = new DOMRect(-1e6, -1e6, 2e6, 2e6);
      for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const c = e.getBoundingClientRect();
          const left = Math.max(clip.left, c.left);
          const top = Math.max(clip.top, c.top);
          clip = new DOMRect(left, top, Math.max(0, Math.min(clip.right, c.right) - left), Math.max(0, Math.min(clip.bottom, c.bottom) - top));
        }
      }
      for (const raw of Array.from(range.getClientRects())) {
        const left = Math.max(raw.left, clip.left);
        const top = Math.max(raw.top, clip.top);
        const r = new DOMRect(left, top, Math.min(raw.right, clip.right) - left, Math.min(raw.bottom, clip.bottom) - top);
        if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight) boxes.push({ el, r });
      }
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.el === b.el) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 1 || h <= 1) continue;
        const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
        if ((w * h) / smaller > 0.2) out.push({ kind: 'overlap', a: describe(a.el), b: describe(b.el) });
      }
    // Text cut off: an element whose content is wider than its box, hidden by overflow, without an ellipsis.
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!visible(el) || !(el instanceof HTMLElement) || !el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
      if (cs.textOverflow === 'ellipsis' || el.scrollWidth <= el.clientWidth + 1) continue;
      // Only elements that hold text themselves (not a card that hides a decoration's overflow).
      if (!Array.from(el.childNodes).some((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim())) continue;
      out.push({ kind: 'clipped', a: describe(el) });
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'page-wider-than-window', a: `${document.documentElement.scrollWidth} > ${innerWidth}` });
    return out;
  }, scope);
  expect(problems, JSON.stringify(problems, null, 1)).toEqual([]);
}

/** The sizes every redesigned screen is checked at. */
export const LAYOUT_SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/** Switches the signed-in person's mode (light or dark) for the whole app, saved to their account. */
export async function setMode(page: Page, mode: 'light' | 'dark') {
  const headers = { origin: 'http://localhost:3000' };
  const got = await page.request.get('/api/v1/me/preferences', { headers });
  expect(got.ok(), await got.text()).toBe(true);
  const body = (await got.json()) as { appearance?: Record<string, unknown> } & Record<string, unknown>;
  const appearance = (body.appearance ?? body) as Record<string, unknown>;
  const res = await page.request.put('/api/v1/me/preferences/appearance', { data: { ...appearance, mode }, headers });
  expect(res.ok(), await res.text()).toBe(true);
}
