import type { CertificateTemplate } from './learning';

/*
 * The design of a learning certificate (ADR 0103), as a list of shapes, text and images on an A4 landscape page
 * (841.89 x 595.28 points). The server draws the list into the PDF; the app draws the same list as SVG, so what people
 * see on screen is the certificate they download. Everything branded comes in: the organisation's name, tagline, logo
 * and colours from My Organization, so every organisation gets its own certificate rather than one generic design.
 */

export const CERT_W = 841.89;
export const CERT_H = 595.28;

export type CertFont = 'serif' | 'serifBold' | 'serifItalic' | 'serifBoldItalic' | 'sans' | 'sansSemi' | 'sansBold';

export type CertElement =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number; opacity?: number; radius?: number }
  | { kind: 'gradient'; x: number; y: number; w: number; h: number; from: string; to: string; opacity?: number; vertical?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; lw: number; opacity?: number; dash?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; lw?: number; opacity?: number; dash?: number }
  | { kind: 'poly'; points: [number, number][]; fill?: string; stroke?: string; lw?: number; opacity?: number }
  | { kind: 'path'; d: string; stroke?: string; fill?: string; lw?: number; opacity?: number }
  | {
      kind: 'text';
      text: string;
      /** The anchor: the middle of the text for center, its start for left, its end for right. */
      x: number;
      /** The baseline. */
      y: number;
      font: CertFont;
      size: number;
      color: string;
      align: 'center' | 'left' | 'right';
      /** Letter spacing in points. */
      spacing?: number;
      opacity?: number;
      /** The text never runs wider than this (the PDF shrinks it further if the real glyphs need it). */
      maxWidth: number;
    }
  | { kind: 'image'; image: 'logo' | 'qr'; x: number; y: number; w: number; h: number; opacity?: number };

export interface CertDesignInput {
  template: CertificateTemplate;
  primary: string;
  secondary: string;
  organisation: string;
  tagline: string | null;
  hasLogo: boolean;
  /** Width / height of the logo, to place it without stretching. */
  logoRatio: number | null;
  recipientName: string;
  moduleTitle: string;
  category: string | null;
  score: number;
  completedAt: string;
  issuedAt: string;
  number: string;
  code: string;
  signatoryName: string | null;
  signatoryTitle: string | null;
  verifyUrl: string;
  revoked: boolean;
}

// ── Colour ──

export function normaliseHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** a moved towards b by t (0..1). */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** The colour itself when it reads well on the background; otherwise moved towards black or white until it does. */
export function certReadableOn(color: string, background: string, min = 4.5): string {
  if (contrast(color, background) >= min) return color;
  const towards = luminance(background) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.1; t <= 1; t += 0.1) {
    const c = mixHex(color, towards, t);
    if (contrast(c, background) >= min) return c;
  }
  return towards;
}

/** A second brand colour when the organisation gave only one: a deeper shade of the first. */
export function secondaryFor(primary: string): string {
  return luminance(primary) > 0.5 ? mixHex(primary, '#000000', 0.45) : mixHex(primary, '#ffffff', 0.35);
}

export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return pick.map((w) => [...w][0]!.toUpperCase()).join('').slice(0, 2) || '·';
}

// ── Text measuring (an estimate shared by both drawings) ──

const WIDE: Record<CertFont, number> = { serif: 0.53, serifBold: 0.56, serifItalic: 0.51, serifBoldItalic: 0.55, sans: 0.56, sansSemi: 0.58, sansBold: 0.59 };

export function estimateWidth(text: string, font: CertFont, size: number, spacing = 0): number {
  const chars = [...text].length;
  const upper = text === text.toUpperCase() && /\p{Lu}/u.test(text);
  return chars * size * (WIDE[font] + (upper ? 0.1 : 0)) + spacing * chars;
}

/** The largest size from max down to min at which the text fits the width. */
export function fitSize(text: string, font: CertFont, max: number, min: number, width: number, spacing = 0): number {
  for (let s = max; s > min; s -= 0.5) if (estimateWidth(text, font, s, spacing) <= width) return s;
  return min;
}

/** Splits text into at most `lines` lines that fit the width at this size; the last line ends with … if it must. */
export function wrapText(text: string, font: CertFont, size: number, width: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (estimateWidth(next, font, size) <= width || !cur) cur = next;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  let last = `${kept[lines - 1]} ${out.slice(lines).join(' ')}`;
  while (last.length > 1 && estimateWidth(`${last}…`, font, size) > width) last = last.slice(0, -1).trimEnd();
  kept[lines - 1] = `${last}…`;
  return kept;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ── Decorations ──

/** A wavy security line (guilloché) between two points, as SVG path data. */
function wave(x1: number, y1: number, x2: number, y2: number, amp: number, period: number, phase: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const steps = Math.max(2, Math.round(len / 3));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (len * i) / steps;
    const o = amp * Math.sin(((d + phase) / period) * Math.PI * 2);
    pts.push(`${(x1 + ux * d - uy * o).toFixed(2)} ${(y1 + uy * d + ux * o).toFixed(2)}`);
  }
  return `M ${pts.join(' L ')}`;
}

function starburst(cx: number, cy: number, outer: number, inner: number, points: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

const diamond = (cx: number, cy: number, r: number): [number, number][] => [
  [cx, cy - r],
  [cx + r, cy],
  [cx, cy + r],
  [cx - r, cy],
];

interface Palette {
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  /** The brand colour made readable as text on the background. */
  accentText: string;
  second: string;
  foil: string;
}

function paletteFor(t: CertificateTemplate, primary: string, secondary: string): Palette {
  if (t === 'EXECUTIVE') {
    const bg = mixHex(mixHex(primary, '#0b1020', 0.82), '#000000', 0.15);
    return { bg, ink: '#f8fafc', muted: '#cbd5e1', accent: primary, accentText: certReadableOn(mixHex(primary, '#ffffff', 0.25), bg), second: secondary, foil: '#d6b25e' };
  }
  const bg = t === 'CLASSIC' ? '#fffdf7' : '#ffffff';
  return { bg, ink: '#16181d', muted: '#5b6170', accent: primary, accentText: certReadableOn(primary, bg), second: secondary, foil: '#b88a2e' };
}

function frame(t: CertificateTemplate, p: Palette): CertElement[] {
  const W = CERT_W;
  const H = CERT_H;
  const e: CertElement[] = [{ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bg }];
  if (t === 'CLASSIC') {
    // A brand-coloured outer band, a guilloché border like security paper, a fine foil rule and corner diamonds.
    e.push({ kind: 'rect', x: 14, y: 14, w: W - 28, h: H - 28, fill: p.accent });
    e.push({ kind: 'gradient', x: 14, y: 14, w: W - 28, h: H - 28, from: p.accent, to: p.second, opacity: 0.55 });
    e.push({ kind: 'rect', x: 22, y: 22, w: W - 44, h: H - 44, fill: p.bg });
    for (const [phase, op] of [
      [0, 0.55],
      [5, 0.35],
      [10, 0.22],
    ] as const) {
      const c = 33;
      e.push({ kind: 'path', d: wave(c, c, W - c, c, 3.2, 14, phase), stroke: p.accent, lw: 0.45, opacity: op });
      e.push({ kind: 'path', d: wave(c, H - c, W - c, H - c, 3.2, 14, phase), stroke: p.accent, lw: 0.45, opacity: op });
      e.push({ kind: 'path', d: wave(c, c, c, H - c, 3.2, 14, phase), stroke: p.accent, lw: 0.45, opacity: op });
      e.push({ kind: 'path', d: wave(W - c, c, W - c, H - c, 3.2, 14, phase), stroke: p.accent, lw: 0.45, opacity: op });
    }
    e.push({ kind: 'rect', x: 44, y: 44, w: W - 88, h: H - 88, stroke: p.foil, lw: 0.9 });
    e.push({ kind: 'rect', x: 48, y: 48, w: W - 96, h: H - 96, stroke: p.foil, lw: 0.35, opacity: 0.8 });
    for (const [x, y] of [
      [44, 44],
      [W - 44, 44],
      [44, H - 44],
      [W - 44, H - 44],
    ] as const) {
      e.push({ kind: 'poly', points: diamond(x, y, 7), fill: p.foil });
      e.push({ kind: 'poly', points: diamond(x, y, 3.2), fill: p.bg });
    }
  } else if (t === 'MODERN') {
    // Layered brand-coloured shapes in two corners, a dotted grid and a fine rounded border.
    e.push({ kind: 'poly', points: [[0, 0], [300, 0], [0, 210]], fill: p.accent, opacity: 0.12 });
    e.push({ kind: 'poly', points: [[0, 0], [210, 0], [0, 150]], fill: p.second, opacity: 0.9 });
    e.push({ kind: 'poly', points: [[0, 0], [140, 0], [0, 96]], fill: p.accent });
    e.push({ kind: 'poly', points: [[W, H], [W - 260, H], [W, H - 178]], fill: p.second, opacity: 0.12 });
    e.push({ kind: 'poly', points: [[W, H], [W - 170, H], [W, H - 116]], fill: p.accent, opacity: 0.92 });
    e.push({ kind: 'poly', points: [[W, H], [W - 100, H], [W, H - 68]], fill: p.second });
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) e.push({ kind: 'circle', cx: W - 150 + i * 16, cy: 46 + j * 16, r: 1.6, fill: p.accent, opacity: 0.28 });
    e.push({ kind: 'rect', x: 26, y: 26, w: W - 52, h: H - 52, stroke: p.accent, lw: 0.8, opacity: 0.35, radius: 14 });
  } else {
    // Deep brand-tinted background, fine diagonal lines, a double foil frame and corner brackets.
    for (let x = -H; x < W; x += 18) e.push({ kind: 'line', x1: x, y1: H, x2: x + H, y2: 0, stroke: '#ffffff', lw: 0.4, opacity: 0.035 });
    e.push({ kind: 'gradient', x: 0, y: 0, w: W, h: 10, from: p.foil, to: mixHex(p.foil, '#ffffff', 0.35) });
    e.push({ kind: 'gradient', x: 0, y: H - 10, w: W, h: 10, from: mixHex(p.foil, '#ffffff', 0.35), to: p.foil });
    e.push({ kind: 'rect', x: 26, y: 26, w: W - 52, h: H - 52, stroke: p.foil, lw: 1.1 });
    e.push({ kind: 'rect', x: 33, y: 33, w: W - 66, h: H - 66, stroke: p.foil, lw: 0.4, opacity: 0.7 });
    const L = 34;
    for (const [x, y, sx, sy] of [
      [40, 40, 1, 1],
      [W - 40, 40, -1, 1],
      [40, H - 40, 1, -1],
      [W - 40, H - 40, -1, -1],
    ] as const) {
      e.push({ kind: 'path', d: `M ${x} ${y + sy * L} L ${x} ${y} L ${x + sx * L} ${y}`, stroke: p.foil, lw: 2 });
      e.push({ kind: 'poly', points: diamond(x + sx * 8, y + sy * 8, 3), fill: p.foil });
    }
  }
  return e;
}

/** Everything on the certificate, in drawing order. */
export function certificateDesign(c: CertDesignInput): CertElement[] {
  const W = CERT_W;
  const H = CERT_H;
  const cx = W / 2;
  const p = paletteFor(c.template, c.primary, c.secondary);
  const e = frame(c.template, p);
  const watermarkOpacity = c.template === 'EXECUTIVE' ? 0.06 : 0.04;

  // Watermark: the logo (or the organisation's initials) large and faint in the middle.
  if (c.hasLogo) {
    const box = 300;
    const r = c.logoRatio ?? 1;
    const w = r >= 1 ? box : box * r;
    const h = r >= 1 ? box / r : box;
    e.push({ kind: 'image', image: 'logo', x: cx - w / 2, y: H / 2 + 20 - h / 2, w, h, opacity: watermarkOpacity });
  } else {
    e.push({ kind: 'text', text: initialsOf(c.organisation), x: cx, y: H / 2 + 110, font: 'serifBold', size: 260, color: p.accent, align: 'center', opacity: watermarkOpacity, maxWidth: 600 });
  }

  // Header: logo (or a monogram), organisation name and tagline.
  if (c.hasLogo) {
    const r = c.logoRatio ?? 3;
    const bw = 210;
    const bh = 54;
    const w = Math.min(bw, bh * r);
    const h = w / r;
    e.push({ kind: 'image', image: 'logo', x: cx - w / 2, y: 60 + (bh - h) / 2, w, h });
  } else {
    e.push({ kind: 'circle', cx, cy: 87, r: 25, fill: p.accent });
    e.push({ kind: 'circle', cx, cy: 87, r: 21, stroke: '#ffffff', lw: 0.8, opacity: 0.7 });
    e.push({ kind: 'text', text: initialsOf(c.organisation), x: cx, y: 94, font: 'serifBold', size: 19, color: '#ffffff', align: 'center', maxWidth: 40 });
  }
  const org = c.organisation.toUpperCase();
  e.push({ kind: 'text', text: org, x: cx, y: 131, font: 'sansSemi', size: fitSize(org, 'sansSemi', 10.5, 7, 520, 2.6), color: p.accentText, align: 'center', spacing: 2.6, maxWidth: 520 });
  if (c.tagline) e.push({ kind: 'text', text: c.tagline, x: cx, y: 146, font: 'serifItalic', size: fitSize(c.tagline, 'serifItalic', 10, 7.5, 460), color: p.muted, align: 'center', maxWidth: 460 });

  // Title.
  e.push({ kind: 'text', text: 'CERTIFICATE', x: cx, y: 200, font: 'serifBold', size: 44, color: p.ink, align: 'center', spacing: 7, maxWidth: 560 });
  e.push({ kind: 'line', x1: cx - 150, y1: 219, x2: cx - 82, y2: 219, stroke: p.foil, lw: 0.9 });
  e.push({ kind: 'line', x1: cx + 82, y1: 219, x2: cx + 150, y2: 219, stroke: p.foil, lw: 0.9 });
  e.push({ kind: 'poly', points: diamond(cx - 152, 219, 2.4), fill: p.foil });
  e.push({ kind: 'poly', points: diamond(cx + 152, 219, 2.4), fill: p.foil });
  e.push({ kind: 'text', text: 'OF COMPLETION', x: cx, y: 223, font: 'sansSemi', size: 10.5, color: p.accentText, align: 'center', spacing: 4.2, maxWidth: 160 });

  // The person.
  e.push({ kind: 'text', text: 'This certificate is proudly presented to', x: cx, y: 258, font: 'serifItalic', size: 13, color: p.muted, align: 'center', maxWidth: 520 });
  const nameSize = fitSize(c.recipientName, 'serifBoldItalic', 40, 22, 620);
  e.push({ kind: 'text', text: c.recipientName, x: cx, y: 302, font: 'serifBoldItalic', size: nameSize, color: c.template === 'EXECUTIVE' ? '#ffffff' : p.ink, align: 'center', maxWidth: 620 });
  e.push({ kind: 'gradient', x: cx - 190, y: 315, w: 380, h: 1.4, from: p.accent, to: p.second });
  e.push({ kind: 'poly', points: diamond(cx, 315.7, 4), fill: p.foil });

  // The module.
  e.push({ kind: 'text', text: 'for successfully completing the learning module', x: cx, y: 340, font: 'sans', size: 10.5, color: p.muted, align: 'center', maxWidth: 520 });
  const titleSize = fitSize(c.moduleTitle, 'serifBold', 22, 16, 600);
  const titleLines = wrapText(c.moduleTitle, 'serifBold', titleSize, 600, 2);
  titleLines.forEach((line, i) => e.push({ kind: 'text', text: line, x: cx, y: 368 + i * (titleSize + 5), font: 'serifBold', size: titleSize, color: p.accentText, align: 'center', maxWidth: 600 }));
  const afterTitle = 368 + (titleLines.length - 1) * (titleSize + 5);

  // Details: date, score, category (or the ID).
  const dy = Math.max(402, afterTitle + 30);
  const cols: [string, string][] = [
    ['DATE OF COMPLETION', dateText(c.completedAt)],
    ['FINAL SCORE', `${Math.round(c.score * 10) / 10}%`],
    c.category ? ['CATEGORY', c.category] : ['CERTIFICATE ID', c.number],
  ];
  cols.forEach(([label, value], i) => {
    const x = cx + (i - 1) * 165;
    e.push({ kind: 'text', text: label, x, y: dy, font: 'sansSemi', size: 7, color: p.muted, align: 'center', spacing: 1.6, maxWidth: 150 });
    e.push({ kind: 'text', text: value, x, y: dy + 18, font: 'serif', size: fitSize(value, 'serif', 13, 9, 150), color: p.ink, align: 'center', maxWidth: 150 });
  });
  for (const x of [cx - 82, cx + 82]) e.push({ kind: 'line', x1: x, y1: dy - 9, x2: x, y2: dy + 22, stroke: p.foil, lw: 0.6, opacity: 0.7 });

  // Signature, in the middle at the bottom.
  const sy = 502;
  if (c.signatoryName) e.push({ kind: 'text', text: c.signatoryName, x: cx, y: sy - 8, font: 'serifItalic', size: fitSize(c.signatoryName, 'serifItalic', 19, 12, 220), color: p.ink, align: 'center', opacity: 0.85, maxWidth: 220 });
  e.push({ kind: 'line', x1: cx - 115, y1: sy, x2: cx + 115, y2: sy, stroke: p.muted, lw: 0.7 });
  const signer = c.signatoryName ?? c.organisation;
  e.push({ kind: 'text', text: signer, x: cx, y: sy + 14, font: 'sansSemi', size: fitSize(signer, 'sansSemi', 9.5, 7, 230), color: p.ink, align: 'center', maxWidth: 230 });
  e.push({ kind: 'text', text: c.signatoryName ? (c.signatoryTitle ?? 'Authorised signatory') : 'Issuing organisation', x: cx, y: sy + 26, font: 'sans', size: 8, color: p.muted, align: 'center', maxWidth: 230 });
  e.push({ kind: 'text', text: `Issued ${dateText(c.issuedAt)}`, x: cx, y: sy + 37, font: 'sans', size: 7, color: p.muted, align: 'center', maxWidth: 230 });

  // Seal on the right: a foil starburst around a brand-coloured medallion with the score.
  const sx = W - 132;
  const scy = 462;
  const sealFill = c.template === 'MODERN' ? p.second : p.foil;
  e.push({ kind: 'circle', cx: sx, cy: scy, r: 56, fill: p.bg });
  e.push({ kind: 'poly', points: [[sx - 26, scy + 30], [sx - 40, scy + 66], [sx - 26, scy + 58], [sx - 18, scy + 70], [sx - 8, scy + 38]], fill: p.second, stroke: p.bg, lw: 1 });
  e.push({ kind: 'poly', points: [[sx + 26, scy + 30], [sx + 40, scy + 66], [sx + 26, scy + 58], [sx + 18, scy + 70], [sx + 8, scy + 38]], fill: p.accent, stroke: p.bg, lw: 1 });
  e.push({ kind: 'poly', points: starburst(sx, scy, 50, 44, 30), fill: sealFill });
  e.push({ kind: 'circle', cx: sx, cy: scy, r: 40, fill: p.accent });
  e.push({ kind: 'circle', cx: sx, cy: scy, r: 35.5, stroke: '#ffffff', lw: 0.9, opacity: 0.85 });
  e.push({ kind: 'circle', cx: sx, cy: scy, r: 31.5, stroke: '#ffffff', lw: 0.5, opacity: 0.6, dash: 1.5 });
  e.push({ kind: 'text', text: 'CERTIFIED', x: sx, y: scy - 13, font: 'sansBold', size: 6, color: '#ffffff', align: 'center', spacing: 1.6, maxWidth: 60 });
  e.push({ kind: 'text', text: `${Math.round(c.score * 10) / 10}%`, x: sx, y: scy + 7, font: 'serifBold', size: Math.round(c.score * 10) % 10 ? 15 : 18, color: '#ffffff', align: 'center', maxWidth: 60 });
  e.push({ kind: 'text', text: c.revoked ? 'REVOKED' : 'PASSED', x: sx, y: scy + 19, font: 'sansBold', size: 5.8, color: '#ffffff', align: 'center', spacing: 1.4, maxWidth: 60 });

  // QR code and certificate ID on the left.
  const qx = 86;
  const qy = 424;
  const qs = 66;
  e.push({ kind: 'rect', x: qx - 4, y: qy - 4, w: qs + 8, h: qs + 8, fill: '#ffffff', radius: 4 });
  e.push({ kind: 'image', image: 'qr', x: qx, y: qy, w: qs, h: qs });
  const tx = qx + qs / 2;
  e.push({ kind: 'text', text: `ID ${c.number}`, x: tx, y: qy + qs + 16, font: 'sansSemi', size: 7.5, color: p.ink, align: 'center', maxWidth: 150 });
  e.push({ kind: 'text', text: `Verification code ${c.code}`, x: tx, y: qy + qs + 26, font: 'sans', size: 6.5, color: p.muted, align: 'center', maxWidth: 150 });
  e.push({ kind: 'text', text: 'Scan to verify', x: tx, y: qy + qs + 35, font: 'sans', size: 6.5, color: p.muted, align: 'center', maxWidth: 150 });

  if (c.revoked) e.push({ kind: 'text', text: 'REVOKED', x: cx, y: H / 2 + 30, font: 'sansBold', size: 96, color: '#dc2626', align: 'center', opacity: 0.22, spacing: 8, maxWidth: 700 });
  return e;
}
