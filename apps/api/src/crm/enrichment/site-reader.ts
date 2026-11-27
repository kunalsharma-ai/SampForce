import { looksEmpty, type Page, pagesFromList, pagesToRead, pageWeight, type SiteLinks, sitemapEntries, sitemapsInRobots, teamPageLink } from './website';

/*
 * Which pages of a company's site auto-fill reads, and how (ADR 0079). Pure apart from `io`, so it is tested with
 * stand-in sites:
 *  1. The home page, as sent. When it is almost empty (a site built by JavaScript), it is opened in the hidden browser.
 *  2. The About, Contact and Offices pages it links to. When some are missing, the sitemap (robots.txt, /sitemap.xml)
 *     is asked, then the usual addresses (/about-us, /contact-us ...) are tried. A business sub-site linked from the
 *     home page stands in for a missing About page.
 *  3. One more step: a Contact page linked only from the About page or the business sub-site.
 *  4. The team or leadership page, for the people the company lists.
 * At most MAX_PAGES pages are read per company.
 */

export interface SiteIo {
  /** The page as the server sends it (redirects followed), or null. */
  page(url: string): Promise<Page | null>;
  /** A file such as robots.txt or a sitemap (at most `maxBytes`), or null. */
  file(url: string, accept: string, maxBytes: number): Promise<Buffer | null>;
  /** The page after its scripts ran, from the hidden browser; null when rendering is off or failed. */
  render: ((url: string) => Promise<(Page & { status: number }) | null>) | null;
}

export interface SitePages {
  /** The pages read; the home page first. */
  pages: Page[];
  contactPage: string | null;
  /** Whether the hidden browser drew any of them. */
  rendered: boolean;
}

const MAX_PAGES = 7;
const SITEMAP_MAX_BYTES = 2_000_000;
const GUESSES: { kind: keyof SiteLinks; paths: string[] }[] = [
  { kind: 'contact', paths: ['/contact-us', '/contact'] },
  { kind: 'about', paths: ['/about-us', '/about'] },
];

/** Reads the site at `site` (a domain without www). Null when not even the home page could be read. */
export async function readSitePages(io: SiteIo, site: string): Promise<SitePages | null> {
  let rendered = false;
  let home: Page | null = null;
  for (const start of [`https://${site}/`, `https://www.${site}/`]) {
    home = await io.page(start).catch(() => null);
    if (home) break;
  }
  // A site that refuses plain requests but works in a browser, or a home page built by JavaScript.
  if (io.render && (!home || looksEmpty(home.html))) {
    const drawn = await io.render(home?.url ?? `https://${site}/`).catch(() => null);
    if (drawn && drawn.status < 400 && (!home || richer(drawn.html, home.html))) {
      home = { url: drawn.url, html: drawn.html };
      rendered = true;
    }
  }
  if (!home) return null;

  const read = async (url: string): Promise<Page | null> => {
    // On a JavaScript site every page needs the browser; elsewhere only pages that come back (almost) empty.
    if (rendered && io.render) return browserPage(io, url, true);
    const plain = await io.page(url).catch(() => null);
    if (plain && (!io.render || !looksEmpty(plain.html))) return plain;
    if (!io.render) return null;
    const drawn = await browserPage(io, url, false);
    return drawn && (!plain || richer(drawn.html, plain.html)) ? drawn : plain;
  };

  let links = pagesToRead(home, site);
  if (missing(links)) links = pagesFromList(await sitemapUrls(io, site, home.url), site, links);
  const pages: Page[] = [home];
  const seen = new Set([norm(home.url)]);
  const add = (p: Page | null) => {
    if (!p || seen.has(norm(p.url)) || pages.length >= MAX_PAGES) return false;
    // A site that answers every address with its home page (a single-page app) has not got this page.
    if (sameContent(p.html, home.html)) return false;
    seen.add(norm(p.url));
    pages.push(p);
    return true;
  };

  const wanted = (['about', 'contact', 'offices'] as const).map((k) => links[k]).filter((u): u is string => !!u && !seen.has(norm(u)));
  const got = await Promise.all(wanted.map((u) => read(u)));
  const found: SiteLinks = { about: null, contact: null, offices: null };
  for (const k of ['about', 'contact', 'offices'] as const) {
    const i = wanted.indexOf(links[k] ?? '');
    const p = i >= 0 ? got[i] : null;
    if (p && add(p)) found[k] = p.url;
  }

  // The usual addresses, for plain sites whose menus are images or scripts and that have no sitemap.
  if (!rendered) {
    for (const g of GUESSES) {
      if (found[g.kind]) continue;
      for (const path of g.paths) {
        const p = await io.page(new URL(path, home.url).toString()).catch(() => null);
        if (p && add(p)) {
          found[g.kind] = p.url;
          break;
        }
      }
    }
  }

  // A Contact page linked only from the About page or the business sub-site.
  if (!found.contact) {
    for (const p of pages.slice(1)) {
      const next = pagesToRead(p, site).contact;
      if (next && !seen.has(norm(next))) {
        const c = await read(next);
        if (c && add(c)) {
          found.contact = c.url;
          break;
        }
      }
    }
  }

  // The team or leadership page, for the people the company lists (name, title, email, LinkedIn).
  for (const p of [...pages]) {
    const team = teamPageLink(p, site);
    if (team && !seen.has(norm(team))) {
      const t = await read(team);
      if (t) add(t);
      break;
    }
  }

  const drawnAny = rendered || pages.some((p) => (p as Page & { drawn?: boolean }).drawn === true);
  return { pages: pages.map((p) => ({ url: p.url, html: p.html })), contactPage: found.contact ?? links.contact, rendered: drawnAny };
}

async function browserPage(io: SiteIo, url: string, jsSite: boolean): Promise<(Page & { drawn: true }) | null> {
  const drawn = await io.render!(url).catch(() => null);
  if (!drawn) return null;
  // A JavaScript site often answers unknown addresses with 404 and still draws the page in the browser.
  // The address came from the site's own links or sitemap, so a drawn page there is the page asked for.
  if (drawn.status >= 400 && !(jsSite && pageWeight(drawn.html).text >= 80)) return null;
  return { url: drawn.url, html: drawn.html, drawn: true };
}

/** Pages the sitemap lists: robots.txt's sitemaps, else /sitemap.xml, /sitemap_index.xml and /wp-sitemap.xml. */
async function sitemapUrls(io: SiteIo, site: string, homeUrl: string): Promise<string[]> {
  const origin = new URL(homeUrl).origin;
  const robots = await io.file(`${origin}/robots.txt`, 'text/plain', 200_000).catch(() => null);
  const named = robots ? sitemapsInRobots(robots.toString('utf8')).filter((u) => sameHost(u, site)) : [];
  const candidates = named.length ? named.slice(0, 2) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  for (const url of candidates) {
    const xml = await io.file(url, 'application/xml,text/xml', SITEMAP_MAX_BYTES).catch(() => null);
    if (!xml) continue;
    const { urls, index } = sitemapEntries(xml.toString('utf8'));
    if (!index) {
      if (urls.length) return urls;
      continue;
    }
    // An index of sitemaps: read the ones for pages (not posts, products or images), at most two.
    const children = urls.filter((u) => sameHost(u, site)).sort((a, b) => Number(/page/i.test(b)) - Number(/page/i.test(a))).slice(0, 2);
    const all: string[] = [];
    for (const c of children) {
      const sub = await io.file(c, 'application/xml,text/xml', SITEMAP_MAX_BYTES).catch(() => null);
      if (sub) all.push(...sitemapEntries(sub.toString('utf8')).urls);
    }
    if (all.length) return all;
  }
  return [];
}

const missing = (l: SiteLinks) => !l.about || !l.contact;
const norm = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
/** Whether `a` (the drawn page) shows clearly more than `b` (the page as sent): more text, or more links. */
function richer(a: string, b: string): boolean {
  const wa = pageWeight(a);
  const wb = pageWeight(b);
  return wa.text > wb.text + 50 || wa.links > wb.links + 2;
}
const sameContent = (a: string, b: string) => a.length === b.length && a === b;

function sameHost(url: string, site: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h === site || h.endsWith(`.${site}`);
  } catch {
    return false;
  }
}
