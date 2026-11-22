import { describe, expect, it } from 'vitest';
import { png, ico } from '../../test/fixtures/logo-fixture';
import { findLogo, iconLinks, type LogoFetcher, logoDomain, sniffImage } from './company-logo-finder';

describe('sniffImage', () => {
  it('reads the type and size from the bytes', () => {
    expect(sniffImage(png(180))).toEqual({ contentType: 'image/png', width: 180 });
    expect(sniffImage(ico(48))).toEqual({ contentType: 'image/x-icon', width: 48 });
    const gif = Buffer.from('GIF89a', 'latin1');
    expect(sniffImage(Buffer.concat([gif, Buffer.from([64, 0, 32, 0]), Buffer.alloc(8)]))).toEqual({ contentType: 'image/gif', width: 64 });
    // JPEG: SOI, an APP0 segment, then SOF0 with height 120 and width 200.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x00, 0xc8, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(jpeg)).toEqual({ contentType: 'image/jpeg', width: 200 });
    expect(sniffImage(Buffer.from('<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual({ contentType: 'image/svg+xml', width: null });
  });

  it('refuses what is not an image, whatever it claims to be', () => {
    expect(sniffImage(Buffer.from('<html><body>404</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('<div><svg></svg></div>'))).toBeNull();
    expect(sniffImage(Buffer.from('MZ\x90\x00 executable file here'))).toBeNull();
  });
});

describe('iconLinks', () => {
  it('ranks SVG, then declared sizes, and resolves URLs against the page and <base>', () => {
    const html = `<head><base href="https://cdn.acme.test/assets/">
      <link rel="shortcut icon" href="favicon.ico">
      <link rel="icon" sizes="16x16 32x32" href="/i32.png">
      <link rel='apple-touch-icon' href=touch.png>
      <link rel="mask-icon" href="mask.svg" color="#000">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="icon" type="image/svg+xml" href="logo.svg">
      <link rel="stylesheet" href="site.css"></head>`;
    expect(iconLinks(html, 'https://acme.test/')).toEqual([
      { url: 'https://cdn.acme.test/assets/logo.svg', score: 1000 },
      { url: 'https://cdn.acme.test/assets/touch.png', score: 180 },
      { url: 'https://cdn.acme.test/assets/favicon.ico', score: 32 },
      { url: 'https://cdn.acme.test/i32.png', score: 32 },
    ]);
  });

  it('ignores links that are not http(s)', () => {
    expect(iconLinks('<link rel="icon" href="javascript:alert(1)"><link rel="icon" href="file:///etc/passwd">', 'https://a.test/')).toEqual([]);
  });
});

describe('logoDomain', () => {
  it('reduces a website or domain to its host name', () => {
    expect(logoDomain('https://www.Acme.co.uk/about?x=1')).toBe('acme.co.uk');
    expect(logoDomain('acme.io')).toBe('acme.io');
    expect(logoDomain('http://localhost:3000')).toBeNull();
    expect(logoDomain('10.0.0.5')).toBeNull();
    expect(logoDomain('')).toBeNull();
  });
});

function net(files: Record<string, Buffer>, pages: Record<string, string> = {}): LogoFetcher & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    page: async (url) => (asked.push(url), pages[url] !== undefined ? { url, html: pages[url]! } : null),
    file: async (url) => (asked.push(url), files[url] ?? null),
  };
}

describe('findLogo', () => {
  it('takes the first image that is big enough', async () => {
    const n = net({ 'https://acme.test/t.png': png(180), 'https://acme.test/favicon.ico': ico(32) }, { 'https://acme.test/': '<link rel="apple-touch-icon" href="/t.png">' });
    const r = await findLogo('acme.test', n);
    expect(r).toMatchObject({ status: 'FOUND', logo: { contentType: 'image/png', width: 180, sourceUrl: 'https://acme.test/t.png' } });
    expect(n.asked).not.toContain('https://acme.test/favicon.ico');
  });

  it('falls back to the largest small icon, and skips images that are not images', async () => {
    const n = net({ 'https://acme.test/bad.png': Buffer.from('<html>'), 'https://acme.test/favicon.ico': ico(48) }, { 'https://acme.test/': '<link rel="icon" sizes="64x64" href="/bad.png">' });
    expect(await findLogo('acme.test', n)).toMatchObject({ status: 'FOUND', logo: { contentType: 'image/x-icon', width: 48, sourceUrl: 'https://acme.test/favicon.ico' } });
  });

  it('says NOT_FOUND for a site without icons and UNREACHABLE for a site that does not answer', async () => {
    expect(await findLogo('acme.test', net({}, { 'https://acme.test/': '<p>hi</p>' }))).toEqual({ status: 'NOT_FOUND' });
    expect(await findLogo('gone.test', net({}))).toMatchObject({ status: 'UNREACHABLE' });
  });

  it('tries www when the bare domain has no page', async () => {
    const n = net({ 'https://www.acme.test/l.png': png(128) }, { 'https://www.acme.test/': '<link rel="icon" href="/l.png">' });
    expect(await findLogo('acme.test', n)).toMatchObject({ status: 'FOUND', logo: { sourceUrl: 'https://www.acme.test/l.png' } });
  });
});
