import { z } from 'zod';

/**
 * Designed emails (ADR 0050). A design is an ordered list of blocks plus a few theme colours. One renderer turns it
 * into the HTML that is sent and the plain-text part beside it, so the designer's preview, the template preview and a
 * sequence send all produce the same email. Every piece of text is escaped; links must be http(s) or mailto, checked
 * again after merge fields are filled in.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const color = z.string().trim().regex(HEX, 'Use a colour such as #2563eb');
/** A link typed in the designer: an http(s) or mailto address, or merge fields that fill one in (`{{var.booking_link}}`). */
const LINK = /^(?:(?:https?:\/\/|mailto:)[^\s"'<>]+|\{\{[^{}]+\}\}[^\s"'<>]*)$/i;
const link = z
  .string()
  .trim()
  .max(1000)
  .regex(LINK, 'Use a full link starting with https://, or a merge field');
const optionalLink = z.union([link, z.literal('')]).default('');
/** Images must already be hosted somewhere public over https; email clients block everything else. */
const imageSrc = z
  .string()
  .trim()
  .max(1000)
  .regex(/^https:\/\/[^\s"'<>]+$/i, 'Use an image link starting with https://');
const text = (max: number) => z.string().max(max).default('');
const align = z.enum(['left', 'center', 'right']).default('left');

export const SOCIAL_NETWORKS = {
  linkedin: 'LinkedIn',
  x: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  website: 'Website',
} as const;
export type SocialNetwork = keyof typeof SOCIAL_NETWORKS;

export const emailBlockSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('header'),
    title: text(120),
    logoUrl: z.union([imageSrc, z.literal('')]).default(''),
    align: align,
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('heading'),
    text: text(200),
    level: z.union([z.literal(1), z.literal(2)]).default(2),
    align,
  }),
  z.object({ id: z.string().min(1).max(40), type: z.literal('text'), text: text(5000), align }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('image'),
    src: imageSrc,
    alt: text(200),
    href: optionalLink,
    width: z.number().int().min(20).max(100).default(100),
    align: z.enum(['left', 'center', 'right']).default('center'),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('button'),
    label: z.string().trim().min(1, 'Enter the button text').max(80),
    url: link,
    align: z.enum(['left', 'center', 'right']).default('center'),
  }),
  z.object({ id: z.string().min(1).max(40), type: z.literal('divider') }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('social'),
    links: z
      .array(
        z.object({
          network: z.enum(Object.keys(SOCIAL_NETWORKS) as [SocialNetwork, ...SocialNetwork[]]),
          url: link,
        }),
      )
      .max(6)
      .default([]),
    align: z.enum(['left', 'center', 'right']).default('center'),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('signature'),
    name: text(120),
    title: text(120),
    phone: text(60),
    email: text(200),
    website: optionalLink,
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('product'),
    name: text(120),
    description: text(1000),
    price: text(60),
    imageUrl: z.union([imageSrc, z.literal('')]).default(''),
    url: optionalLink,
    buttonLabel: text(60),
  }),
  z.object({
    id: z.string().min(1).max(40),
    type: z.literal('pricing'),
    title: text(120),
    rows: z
      .array(z.object({ label: text(120), price: text(60), note: text(200) }))
      .max(12)
      .default([]),
    footnote: text(500),
  }),
  z.object({ id: z.string().min(1).max(40), type: z.literal('footer'), text: text(1000) }),
]);
export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type EmailBlockType = EmailBlock['type'];

export const emailThemeSchema = z.object({
  background: color.default('#f4f5f7'),
  surface: color.default('#ffffff'),
  text: color.default('#1f2937'),
  accent: color.default('#2563eb'),
  font: z.enum(['sans', 'serif']).default('sans'),
});
export type EmailTheme = z.infer<typeof emailThemeSchema>;

export const emailDesignSchema = z
  .object({
    version: z.literal(1).default(1),
    theme: emailThemeSchema.default({}),
    blocks: z
      .array(emailBlockSchema)
      .min(1, 'Add at least one block')
      .max(60, 'An email can have up to 60 blocks'),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.blocks.forEach((b, i) => {
      if (seen.has(b.id))
        ctx.addIssue({
          code: 'custom',
          path: ['blocks', i, 'id'],
          message: 'Each block needs its own id',
        });
      seen.add(b.id);
    });
  });
export type EmailDesign = z.infer<typeof emailDesignSchema>;

export const EMAIL_BLOCK_LABELS: Record<EmailBlockType, string> = {
  header: 'Header',
  heading: 'Heading',
  text: 'Text',
  image: 'Image',
  button: 'Button',
  divider: 'Divider',
  social: 'Social links',
  signature: 'Signature',
  product: 'Product',
  pricing: 'Pricing table',
  footer: 'Footer',
};
export const EMAIL_BLOCK_TYPES = Object.keys(EMAIL_BLOCK_LABELS) as EmailBlockType[];

/** A new block of a type, with starter content that shows what it is for. `id` must be unique in the design. */
/**
 * A new block with starter text. `say` writes that text in the author's language (the web passes its translator);
 * merge fields such as {{sender_name}} are kept as they are.
 */
export function newEmailBlock(type: EmailBlockType, id: string, say: (english: string) => string = (english) => english): EmailBlock {
  switch (type) {
    case 'header':
      return { id, type, title: '{{sender_name}}', logoUrl: '', align: 'left' };
    case 'heading':
      return { id, type, text: say('A heading'), level: 2, align: 'left' };
    case 'text':
      return {
        id,
        type,
        text: `${say('Hi {{first_name|there}},')}\n\n${say('Write your message here.')}`,
        align: 'left',
      };
    case 'image':
      return { id, type, src: '', alt: '', href: '', width: 100, align: 'center' };
    case 'button':
      return { id, type, label: say('Book a call'), url: '', align: 'center' };
    case 'divider':
      return { id, type };
    case 'social':
      return { id, type, links: [], align: 'center' };
    case 'signature':
      return {
        id,
        type,
        name: '{{sender_name}}',
        title: '',
        phone: '',
        email: '{{sender_email}}',
        website: '',
      };
    case 'product':
      return {
        id,
        type,
        name: say('Product name'),
        description: '',
        price: '',
        imageUrl: '',
        url: '',
        buttonLabel: say('Learn more'),
      };
    case 'pricing':
      return {
        id,
        type,
        title: say('Pricing'),
        rows: [{ label: say('Starter'), price: '', note: '' }],
        footnote: '',
      };
    case 'footer':
      return { id, type, text: say('You are receiving this because you spoke with {{sender_name}}.') };
  }
}

/** A design to start from: a greeting, a message, a button and a signature. */
export function starterEmailDesign(id: (n: number) => string = (n) => `b${n}`, say?: (english: string) => string): EmailDesign {
  return {
    version: 1,
    theme: emailThemeSchema.parse({}),
    blocks: [
      newEmailBlock('text', id(1), say),
      newEmailBlock('button', id(2), say),
      newEmailBlock('signature', id(3), say),
    ],
  };
}

/** Every piece of text a person typed, for merge-field checks. Links are included: they may hold merge fields too. */
export function emailDesignStrings(design: EmailDesign): string[] {
  return design.blocks.flatMap((b): string[] => {
    switch (b.type) {
      case 'header':
        return [b.title];
      case 'heading':
      case 'text':
        return [b.text];
      case 'image':
        return [b.alt, b.href];
      case 'button':
        return [b.label, b.url];
      case 'divider':
        return [];
      case 'social':
        return b.links.map((l) => l.url);
      case 'signature':
        return [b.name, b.title, b.phone, b.email, b.website];
      case 'product':
        return [b.name, b.description, b.price, b.url, b.buttonLabel];
      case 'pricing':
        return [b.title, b.footnote, ...b.rows.flatMap((r) => [r.label, r.price, r.note])];
      case 'footer':
        return [b.text];
    }
  });
}

// ───────────── Rendering ─────────────

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** A link that is safe to put in an href once merge fields are filled in, or null. */
export function safeEmailLink(url: string): string | null {
  const u = url.trim();
  return /^(?:https?:\/\/|mailto:)[^\s"'<>]+$/i.test(u) ? u : null;
}

export interface RenderEmailOptions {
  /** Fills in merge fields in one piece of typed text. Defaults to leaving the tags as typed. */
  merge?: (text: string) => string;
  /** Rewrites each link before it goes into the HTML (click tracking). */
  link?: (url: string) => string;
  /** Extra HTML appended inside the email body, after the last block (unsubscribe line, tracking pixel). Must be safe HTML. */
  appendHtml?: string;
  /** Keeps links that are still merge fields (`{{var.booking_link}}`), for the stored text version of a template. */
  keepTags?: boolean;
  /** For the designer's own preview: shows buttons without a link yet and a placeholder for images without one. */
  draft?: boolean;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Renders a design to email HTML (table layout, inline styles, 600px wide and fluid below that) and plain text. */
export function renderEmailDesign(
  design: EmailDesign,
  opts: RenderEmailOptions = {},
): RenderedEmail {
  const merge = opts.merge ?? ((s: string) => s);
  /** The link as written to the plain-text part, or null when it is not a usable link. */
  const plain = (raw: string): string | null => {
    const m = merge(raw).trim();
    return safeEmailLink(m) ?? (opts.keepTags && LINK.test(m) ? m : null);
  };
  const href = (raw: string): string | null => {
    const u = plain(raw);
    // Only web links go through tracking; a mailto: link is left as it is.
    return u ? (opts.link && /^https?:\/\//i.test(u) && safeEmailLink(u) ? opts.link(u) : u) : null;
  };
  const t = design.theme;
  const font =
    t.font === 'serif' ? "Georgia,'Times New Roman',serif" : 'Arial,Helvetica,sans-serif';
  const muted = 'color:#6b7280';
  const paragraphs = (raw: string, style: string) =>
    merge(raw)
      .trim()
      .split(/\n{2,}/)
      .filter(Boolean)
      .map(
        (p) =>
          `<p style="margin:0 0 12px;${style}">${autolink(p, href, t.accent).replace(/\n/g, '<br>')}</p>`,
      )
      .join('');
  const row = (inner: string, pad = '12px 32px') =>
    `<tr><td style="padding:${pad}">${inner}</td></tr>`;
  const button = (label: string, url: string | null, alignTo: string) =>
    (url || opts.draft) && label.trim()
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${alignTo}" style="margin:0 ${alignTo === 'center' ? 'auto' : '0'}"><tr><td bgcolor="${t.accent}" style="border-radius:6px"><${url ? `a href="${esc(url)}"` : 'span'} style="display:inline-block;padding:12px 24px;font-family:${font};font-size:15px;font-weight:bold;color:${readableOn(t.accent)};text-decoration:none;border-radius:6px">${esc(label)}</${url ? 'a' : 'span'}></td></tr></table>`
      : '';

  const html: string[] = [];
  const text: string[] = [];
  for (const b of design.blocks) {
    switch (b.type) {
      case 'header': {
        const title = merge(b.title).trim();
        const logo = b.logoUrl
          ? `<img src="${esc(b.logoUrl)}" alt="${esc(title)}" height="40" style="display:inline-block;height:40px;width:auto;border:0;vertical-align:middle">`
          : '';
        if (!logo && !title) break;
        html.push(
          `<tr><td bgcolor="${t.accent}" style="padding:20px 32px;text-align:${b.align};font-family:${font};font-size:20px;font-weight:bold;color:${readableOn(t.accent)}">${logo}${logo && title ? '&nbsp;&nbsp;' : ''}${logo && title ? `<span style="vertical-align:middle">${esc(title)}</span>` : esc(title)}</td></tr>`,
        );
        if (title) text.push(title);
        break;
      }
      case 'heading': {
        const h = merge(b.text).trim();
        if (!h) break;
        const size = b.level === 1 ? 26 : 20;
        html.push(
          row(
            `<h${b.level} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.3;text-align:${b.align};color:${t.text}">${esc(h)}</h${b.level}>`,
            '20px 32px 4px',
          ),
        );
        text.push(h);
        break;
      }
      case 'text': {
        const body = paragraphs(b.text, `text-align:${b.align}`);
        if (!body) break;
        html.push(row(body));
        text.push(merge(b.text).trim());
        break;
      }
      case 'image': {
        if (!b.src) {
          if (opts.draft)
            html.push(
              row(
                `<div style="padding:40px 12px;border:2px dashed #d1d5db;border-radius:6px;text-align:center;font-family:${font};font-size:13px;${muted}">Image: add an image link in the block settings</div>`,
              ),
            );
          break;
        }
        const alt = merge(b.alt).trim();
        const img = `<img src="${esc(b.src)}" alt="${esc(alt)}" width="${Math.round((536 * b.width) / 100)}" style="display:inline-block;width:${b.width}%;max-width:100%;height:auto;border:0">`;
        const target = b.href ? href(b.href) : null;
        html.push(
          row(
            `<div style="text-align:${b.align}">${target ? `<a href="${esc(target)}">${img}</a>` : img}</div>`,
          ),
        );
        if (alt) text.push(`[${alt}]`);
        break;
      }
      case 'button': {
        const label = merge(b.label).trim();
        const target = href(b.url);
        const html1 = button(label, target, b.align);
        if (!html1) break;
        html.push(row(html1, '16px 32px'));
        if (target) text.push(`${label}: ${plain(b.url)}`);
        break;
      }
      case 'divider':
        html.push(row(`<hr style="border:0;border-top:1px solid #e5e7eb;margin:0">`, '16px 32px'));
        text.push('---');
        break;
      case 'social': {
        const links = b.links.flatMap((l) => {
          const u = href(l.url);
          return u ? [{ name: SOCIAL_NETWORKS[l.network], u, raw: plain(l.url)! }] : [];
        });
        if (!links.length) break;
        html.push(
          row(
            `<p style="margin:0;text-align:${b.align};font-family:${font};font-size:14px">${links.map((l) => `<a href="${esc(l.u)}" style="color:${t.accent};text-decoration:underline">${esc(l.name)}</a>`).join(' &nbsp;·&nbsp; ')}</p>`,
          ),
        );
        text.push(links.map((l) => `${l.name}: ${l.raw}`).join('\n'));
        break;
      }
      case 'signature': {
        const name = merge(b.name).trim();
        const title = merge(b.title).trim();
        const phone = merge(b.phone).trim();
        const email = merge(b.email).trim();
        const site = b.website ? href(b.website) : null;
        const siteRaw = b.website ? plain(b.website) : null;
        const lines = [
          name && `<strong style="color:${t.text}">${esc(name)}</strong>`,
          title && `<span style="${muted}">${esc(title)}</span>`,
          phone && `<span style="${muted}">${esc(phone)}</span>`,
          email &&
            (/^[^\s@<>"']+@[^\s@<>"']+$/.test(email)
              ? `<a href="${esc(`mailto:${email}`)}" style="color:${t.accent}">${esc(email)}</a>`
              : `<span style="${muted}">${esc(email)}</span>`),
          site &&
            siteRaw &&
            `<a href="${esc(site)}" style="color:${t.accent}">${esc(siteRaw.replace(/^https?:\/\//i, ''))}</a>`,
        ].filter(Boolean);
        if (!lines.length) break;
        html.push(
          row(
            `<p style="margin:0;font-family:${font};font-size:14px;line-height:1.6;border-left:3px solid ${t.accent};padding-left:12px">${lines.join('<br>')}</p>`,
            '16px 32px',
          ),
        );
        text.push(['--', name, title, phone, email, siteRaw].filter(Boolean).join('\n'));
        break;
      }
      case 'product': {
        const name = merge(b.name).trim();
        if (!name) break;
        const price = merge(b.price).trim();
        const desc = merge(b.description).trim();
        const target = href(b.url);
        const label = merge(b.buttonLabel).trim();
        const img = b.imageUrl
          ? `<img src="${esc(b.imageUrl)}" alt="${esc(name)}" width="536" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:6px 6px 0 0">`
          : '';
        html.push(
          row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px"><tr><td>${img}</td></tr><tr><td style="padding:16px;font-family:${font}"><p style="margin:0 0 4px;font-size:17px;font-weight:bold;color:${t.text}">${esc(name)}</p>${price ? `<p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:${t.accent}">${esc(price)}</p>` : ''}${desc ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${t.text}">${esc(desc).replace(/\n/g, '<br>')}</p>` : ''}${button(label, target, 'left')}</td></tr></table>`,
          ),
        );
        text.push(
          [name, price, desc, target && label ? `${label}: ${plain(b.url)}` : '']
            .filter(Boolean)
            .join('\n'),
        );
        break;
      }
      case 'pricing': {
        const rows = b.rows
          .map((r) => ({
            label: merge(r.label).trim(),
            price: merge(r.price).trim(),
            note: merge(r.note).trim(),
          }))
          .filter((r) => r.label || r.price);
        const title = merge(b.title).trim();
        if (!rows.length) break;
        const foot = merge(b.footnote).trim();
        html.push(
          row(
            `${title ? `<p style="margin:0 0 8px;font-family:${font};font-size:17px;font-weight:bold;color:${t.text}">${esc(title)}</p>` : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${font};font-size:14px">${rows
              .map(
                (r) =>
                  `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:${t.text}">${esc(r.label)}${r.note ? `<br><span style="font-size:12px;${muted}">${esc(r.note)}</span>` : ''}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:bold;color:${t.text};white-space:nowrap">${esc(r.price)}</td></tr>`,
              )
              .join(
                '',
              )}</table>${foot ? `<p style="margin:8px 0 0;font-family:${font};font-size:12px;${muted}">${esc(foot)}</p>` : ''}`,
          ),
        );
        text.push(
          [title, ...rows.map((r) => `${r.label}: ${r.price}${r.note ? ` (${r.note})` : ''}`), foot]
            .filter(Boolean)
            .join('\n'),
        );
        break;
      }
      case 'footer': {
        const f = merge(b.text).trim();
        if (!f) break;
        html.push(
          row(
            `<p style="margin:0;font-family:${font};font-size:12px;line-height:1.5;text-align:center;${muted}">${autolink(f, href, '#6b7280').replace(/\n/g, '<br>')}</p>`,
            '20px 32px',
          ),
        );
        text.push(f);
        break;
      }
    }
  }

  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;padding:0;background:${t.background}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.background}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.surface}" style="width:100%;max-width:600px;border-radius:8px;overflow:hidden;font-family:${font};font-size:15px;line-height:1.6;color:${t.text}">${html.join('')}<tr><td style="padding:8px 32px 24px">${opts.appendHtml ?? ''}</td></tr></table></td></tr></table></body></html>`;
  return { html: doc, text: text.join('\n\n') };
}

/** Escapes text and turns bare links into anchors (through `href`, so tracking applies). */
function autolink(raw: string, href: (u: string) => string | null, color: string): string {
  let out = '';
  let last = 0;
  for (const m of raw.matchAll(URL_IN_TEXT)) {
    out += esc(raw.slice(last, m.index));
    const u = href(m[0]);
    out += u
      ? `<a href="${esc(u)}" style="color:${color};text-decoration:underline">${esc(m[0])}</a>`
      : esc(m[0]);
    last = m.index! + m[0].length;
  }
  return out + esc(raw.slice(last));
}

/** Black or white, whichever reads better on a background colour (WCAG relative luminance). */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  // Contrast against black is (L + 0.05) / 0.05, against white 1.05 / (L + 0.05).
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#111827' : '#ffffff';
}
