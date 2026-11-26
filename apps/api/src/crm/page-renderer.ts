import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { Browser, BrowserContext } from 'playwright-core';
import type { SiteFetcher } from './site-fetch';

/*
 * Reading websites that build their pages with JavaScript (ADR 0079). Many company sites send an almost empty page and
 * fill it in the visitor's browser; reading the HTML alone then finds only the title and description. For those
 * pages company auto-fill opens the page in a hidden Chromium, waits for it to draw, and reads the result.
 *
 * Safety, since the browser runs other people's JavaScript:
 *  - The browser never touches the network itself. Every request the page makes is intercepted and made by the
 *    server through `SiteFetcher.raw`, which is `publicFetch`: public https addresses only, checked at connect time
 *    (no DNS rebinding into the internal network), size and time capped. Anything not intercepted goes to a proxy
 *    address that does not exist, so it fails; WebRTC is kept on that proxy too, and WebSockets and service workers
 *    are refused.
 *  - Only GET and HEAD requests for documents, scripts and data are made; images, fonts, media and style sheets are
 *    not fetched, and a page gets at most MAX_REQUESTS requests.
 *  - Each page has its own browser context (no cookies or storage shared between companies), closed afterwards.
 */

/** Requests one page may make; the rest are refused. */
const MAX_REQUESTS = 120;
/** Size cap for one script or data response. */
const RESOURCE_MAX_BYTES = 4_000_000;
/** Pages rendered at once by one process; more wait their turn. */
const MAX_PARALLEL = 2;
/** The browser is closed after this long without work, so an idle server keeps no Chromium running. */
const IDLE_CLOSE_MS = 60_000;
/** Follows the redirects of `url` (each hop checked by `net`), returning the final address and its answer. */
async function finalAddress(url: string, net: SiteFetcher): Promise<{ url: string; res: NonNullable<Awaited<ReturnType<SiteFetcher['raw']>>> } | null> {
  let at = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await net.raw(at, 'text/html,application/xhtml+xml', RESOURCE_MAX_BYTES);
    if (!res) return null;
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return { url: at, res };
    at = new URL(location, at).toString();
    if (!/^https:\/\//i.test(at)) return null;
  }
  return null;
}

const SKIPPED_TYPES = new Set(['image', 'media', 'font', 'stylesheet', 'texttrack', 'manifest', 'eventsource', 'websocket', 'beacon', 'ping', 'cspreport', 'imageset']);
/** Response headers the browser does not get: the body is already decoded, and nothing is stored. */
const DROPPED_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie', 'keep-alive', 'strict-transport-security', 'alt-svc']);

/** Where Chromium is found when COMPANY_AUTOFILL_BROWSER_PATH is not set: the Docker image, Debian, Ubuntu CI, Playwright. */
const KNOWN_PATHS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/pw-browsers/chromium/chrome-linux/chrome'];

/** The Chromium to use: the configured path, else the first known one that exists, else null (rendering is off). */
export function findBrowser(configured: string | undefined): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  return KNOWN_PATHS.find((p) => existsSync(p)) ?? null;
}

export interface RenderedPage {
  /** The address the page ended up at, after redirects. */
  url: string;
  /** The page's HTML after its scripts ran. */
  html: string;
  /** HTTP status of the page itself. */
  status: number;
}

export class PageRenderer {
  private readonly log = new Logger(PageRenderer.name);
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(readonly executablePath: string) {}

  /**
   * Opens `url`, waits until the page has drawn (or `timeoutMs` passed), and returns its HTML, or null when it could
   * not be opened. `net` makes every request the page needs. Never throws.
   */
  async render(url: string, net: SiteFetcher, timeoutMs: number): Promise<RenderedPage | null> {
    await this.slot();
    let context: BrowserContext | null = null;
    try {
      const browser = await this.launch();
      // An ordinary desktop Chrome, with this Chromium's version (a headless Chrome names itself "HeadlessChrome",
      // which many sites block).
      const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version().split('.')[0]}.0.0.0 Safari/537.36`;
      context = await browser.newContext({ userAgent, serviceWorkers: 'block', javaScriptEnabled: true, locale: 'en-US', viewport: { width: 1280, height: 900 } });
      context.setDefaultTimeout(timeoutMs);
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      let requests = 0;
      let finalUrl: string | null = null;
      let prefetched: { url: string; res: NonNullable<Awaited<ReturnType<SiteFetcher['raw']>>> } | null = null;
      await context.route('**/*', async (route) => {
        const req = route.request();
        const target = req.url();
        if (SKIPPED_TYPES.has(req.resourceType()) || !['GET', 'HEAD'].includes(req.method()) || !/^https:\/\//i.test(target) || ++requests > MAX_REQUESTS) {
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }
        // Redirects are followed here (each hop checked again): a redirect handed to the browser would leave it to
        // fetch the next address itself, which it cannot.
        let at = target;
        // The first page was already fetched while finding its address; use that answer.
        let got = prefetched && prefetched.url === target ? prefetched.res : await net.raw(at, req.headers().accept ?? '*/*', RESOURCE_MAX_BYTES);
        if (prefetched?.url === target) prefetched = null;
        for (let hop = 0; got && got.status >= 300 && got.status < 400 && got.headers.get('location') && hop < 5; hop++) {
          at = new URL(got.headers.get('location')!, at).toString();
          got = /^https:\/\//i.test(at) ? await net.raw(at, req.headers().accept ?? '*/*', RESOURCE_MAX_BYTES) : null;
        }
        if (got && got.status >= 300 && got.status < 400) got = null;
        if (got && req.isNavigationRequest() && !req.frame().parentFrame()) finalUrl = at;
        if (!got) {
          await route.abort('failed').catch(() => undefined);
          return;
        }
        const headers: Record<string, string> = {};
        got.headers.forEach((v, k) => {
          if (!DROPPED_HEADERS.has(k.toLowerCase())) headers[k] = v;
        });
        await route.fulfill({ status: got.status, headers, body: got.body }).catch(() => undefined);
      });
      const page = await context.newPage();
      const started = Date.now();
      // Opened at the address it redirects to, so the page's own relative links and scripts resolve against it.
      const start = await finalAddress(url, net);
      if (!start) return null;
      prefetched = start;
      const res = await page.goto(start.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (!res) return null;
      // Most pages draw within a few seconds of their scripts arriving; stop waiting when the network goes quiet.
      const left = Math.max(1000, timeoutMs - (Date.now() - started));
      await page.waitForLoadState('networkidle', { timeout: Math.min(left, 6000) }).catch(() => undefined);
      const html = await page.content();
      return { url: finalUrl ?? page.url(), html, status: res.status() };
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'page could not be rendered');
      return null;
    } finally {
      await context?.close().catch(() => undefined);
      this.release();
    }
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const b = this.browser;
    this.browser = null;
    if (b) await (await b.catch(() => null))?.close().catch(() => undefined);
  }

  private launch(): Promise<Browser> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.browser ??= import('playwright-core')
      .then(({ chromium }) =>
        chromium.launch({
          executablePath: this.executablePath,
          headless: true,
          // Every request is intercepted (above); anything that is not goes to this dead proxy and fails.
          proxy: { server: 'http://127.0.0.1:9' },
          args: [
            // The container has no user namespaces for Chromium's own sandbox; the container itself is the sandbox
            // (read-only, no capabilities, non-root), and the page can only reach what route() above fetches for it.
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-default-apps',
            '--mute-audio',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            '--webrtc-ip-handling-policy=disable_non_proxied_udp',
          ],
        }),
      )
      .catch((err: unknown) => {
        this.browser = null;
        throw err;
      });
    return this.browser;
  }

  private async slot(): Promise<void> {
    if (this.active < MAX_PARALLEL) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active--;
    if (this.active === 0) {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
      this.idleTimer.unref();
    }
  }
}
