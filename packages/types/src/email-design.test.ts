import { describe, expect, it } from 'vitest';
import {
  EMAIL_BLOCK_TYPES,
  emailDesignSchema,
  newEmailBlock,
  readableOn,
  renderEmailDesign,
  safeEmailLink,
  type EmailDesign,
} from './email-design';
import { designedTemplateBody, emailTemplateInputSchema, renderMerge } from './sequences';

const design = (blocks: unknown[], theme = {}): EmailDesign =>
  emailDesignSchema.parse({ blocks, theme });

describe('email designs', () => {
  it('accepts a starter block of every type, and refuses unsafe links and images', () => {
    // Starter blocks are valid once the button and image have their links.
    const starters = EMAIL_BLOCK_TYPES.map((t, i) => newEmailBlock(t, `b${i}`));
    const unfinished = emailDesignSchema.safeParse({ blocks: starters });
    expect(
      unfinished.success ? [] : unfinished.error.issues.map((i) => [i.path.join('.'), i.message]),
    ).toEqual([
      ['blocks.3.src', 'Use an image link starting with https://'],
      ['blocks.4.url', 'Use a full link starting with https://, or a merge field'],
    ]);
    const all = design(
      starters.map((b) =>
        b.type === 'image'
          ? { ...b, src: 'https://img.test/a.png' }
          : b.type === 'button'
            ? { ...b, url: 'https://cal.test' }
            : b,
      ),
    );
    expect(all.blocks).toHaveLength(EMAIL_BLOCK_TYPES.length);
    // The designer's own preview shows what is not finished yet.
    const draft = renderEmailDesign({ ...all, blocks: starters }, { draft: true, keepTags: true });
    expect(draft.html).toContain('Image: add an image link');
    expect(draft.html).toContain('>Book a call</span>');
    expect(draft.text).not.toContain('Book a call');
    expect(
      emailDesignSchema.safeParse({
        blocks: [{ id: 'a', type: 'button', label: 'Go', url: 'javascript:alert(1)' }],
      }).success,
    ).toBe(false);
    expect(
      emailDesignSchema.safeParse({
        blocks: [{ id: 'a', type: 'image', src: 'http://insecure.test/x.png' }],
      }).success,
    ).toBe(false);
    expect(
      emailDesignSchema.safeParse({
        blocks: [{ id: 'a', type: 'button', label: 'Book', url: '{{var.booking_link}}' }],
      }).success,
    ).toBe(true);
    expect(
      emailDesignSchema.safeParse({
        blocks: [
          { id: 'a', type: 'divider' },
          { id: 'a', type: 'divider' },
        ],
      }).success,
    ).toBe(false);
    expect(emailDesignSchema.safeParse({ blocks: [] }).success).toBe(false);
    expect(
      emailDesignSchema.safeParse({
        blocks: [{ id: 'a', type: 'divider' }],
        theme: { accent: 'red' },
      }).success,
    ).toBe(false);
  });

  it('escapes everything typed or merged, so a name cannot inject HTML', () => {
    const d = design([
      { id: 'h', type: 'heading', text: 'Hello {{first_name}}' },
      { id: 't', type: 'text', text: 'Price <b>5</b> & "more"' },
    ]);
    const out = renderEmailDesign(d, {
      merge: (s) => renderMerge(s, { first_name: '<script>x</script>' }).text,
    });
    expect(out.html).toContain('Hello &lt;script&gt;x&lt;/script&gt;');
    expect(out.html).toContain('Price &lt;b&gt;5&lt;/b&gt; &amp; &quot;more&quot;');
    expect(out.html).not.toContain('<script>');
    expect(out.text).toBe('Hello <script>x</script>\n\nPrice <b>5</b> & "more"');
  });

  it('fills merge fields in links, drops links that do not turn into a web or mail address, and tracks web links only', () => {
    const d = design([
      { id: 'b', type: 'button', label: 'Book a call', url: '{{var.booking_link}}' },
      { id: 'c', type: 'button', label: 'Broken', url: '{{var.missing}}' },
      {
        id: 's',
        type: 'signature',
        name: 'Sam',
        email: 'sam@seller.test',
        website: 'https://seller.test',
      },
      { id: 't', type: 'text', text: 'See https://seller.test/case.' },
    ]);
    const merge = (s: string) =>
      renderMerge(s, { 'var.booking_link': 'https://cal.test/sam', 'var.missing': 'not a link' })
        .text;
    const out = renderEmailDesign(d, {
      merge,
      link: (u) => `https://track.test/c?u=${encodeURIComponent(u)}`,
    });
    expect(out.html).toContain(
      `href="https://track.test/c?u=${encodeURIComponent('https://cal.test/sam')}"`,
    );
    expect(out.html).toContain(
      `href="https://track.test/c?u=${encodeURIComponent('https://seller.test/case')}"`,
    );
    expect(out.html).toContain('href="mailto:sam@seller.test"');
    expect(out.html).not.toContain('Broken');
    expect(out.text).toContain('Book a call: https://cal.test/sam');
    expect(out.text).not.toContain('Broken');
    expect(safeEmailLink('javascript:alert(1)')).toBeNull();
  });

  it('renders products, pricing tables, social links and a footer, and keeps their text in the plain-text part', () => {
    const d = design(
      [
        { id: 'h', type: 'header', title: 'Northwind Research' },
        {
          id: 'p',
          type: 'product',
          name: 'Usage panel',
          price: '$8 per complete',
          description: 'Weekly diaries',
          url: 'https://nw.test/panel',
          buttonLabel: 'See the panel',
        },
        {
          id: 'r',
          type: 'pricing',
          title: 'Options',
          rows: [
            { label: 'Starter', price: '$2,000', note: '500 completes' },
            { label: 'Pro', price: '$6,000' },
            { label: '', price: '' },
          ],
          footnote: 'Prices exclude tax.',
        },
        {
          id: 's',
          type: 'social',
          links: [{ network: 'linkedin', url: 'https://linkedin.com/company/nw' }],
        },
        { id: 'f', type: 'footer', text: 'Northwind, 1 Main St' },
      ],
      { accent: '#fde047', font: 'serif' },
    );
    const out = renderEmailDesign(d);
    expect(out.html).toContain('Georgia');
    expect(out.html).toContain('color:#111827'); // dark text on the yellow header and buttons
    expect(out.html.match(/<tr><td style="padding:10px 0/g)).toHaveLength(2);
    expect(out.text).toBe(
      'Northwind Research\n\nUsage panel\n$8 per complete\nWeekly diaries\nSee the panel: https://nw.test/panel\n\nOptions\nStarter: $2,000 (500 completes)\nPro: $6,000\nPrices exclude tax.\n\nLinkedIn: https://linkedin.com/company/nw\n\nNorthwind, 1 Main St',
    );
  });

  it('stores a designed template with its plain-text body, and checks merge fields inside the design', () => {
    const d = design([
      { id: 't', type: 'text', text: 'Hi {{first_name|there}}' },
      { id: 'b', type: 'button', label: 'Book', url: '{{var.booking_link}}' },
    ]);
    expect(designedTemplateBody(d)).toBe('Hi {{first_name|there}}\n\nBook: {{var.booking_link}}');
    const ok = emailTemplateInputSchema.safeParse({
      name: 'Designed',
      subject: 'Hello',
      design: d,
    });
    expect(ok.success).toBe(true);
    const bad = emailTemplateInputSchema.safeParse({
      name: 'Designed',
      subject: 'Hello',
      design: design([{ id: 't', type: 'text', text: 'Hi {{nickname}}' }]),
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error)).toContain('Unknown merge field {{nickname}}');
    expect(emailTemplateInputSchema.safeParse({ name: 'Empty', subject: 'Hello' }).success).toBe(
      false,
    );
  });

  it('picks readable text on accent colours', () => {
    expect(readableOn('#2563eb')).toBe('#ffffff');
    expect(readableOn('#fde047')).toBe('#111827');
    expect(readableOn('#000000')).toBe('#ffffff');
  });
});
