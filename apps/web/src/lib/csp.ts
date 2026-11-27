/**
 * Content Security Policy for every page. Scripts must carry the per-request nonce (Next.js adds it to its
 * own scripts when it sees the policy on the request); 'strict-dynamic' lets those scripts load the code
 * chunks they import. Inline style attributes stay allowed because the chart and animation libraries set
 * them; styles cannot run code.
 */
/**
 * Learning & Development (ADR 0097): the video players lessons embed and their preview images. Kept equal to
 * VIDEO_FRAME_HOSTS and VIDEO_IMAGE_HOSTS in @dealflow/types (csp.test.ts checks), without importing the whole
 * package into the middleware.
 */
export const LEARNING_FRAME_HOSTS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com', 'https://www.loom.com', 'https://fast.wistia.net', 'https://www.dailymotion.com'];
export const LEARNING_IMAGE_HOSTS = ['https://i.ytimg.com', 'https://i.vimeocdn.com', 'https://cdn.loom.com', 'https://embed-ssl.wistia.com', 'https://s1.dmcdn.net', 'https://s2.dmcdn.net'];

export function contentSecurityPolicy(nonce: string, opts: { embeddable?: boolean; dev?: boolean; https?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...LEARNING_IMAGE_HOSTS],
    // Lesson videos: uploaded ones come from the API ('self'); a pasted link to a video file may be on any HTTPS host.
    'media-src': ["'self'", 'blob:', 'https:'],
    // The app's own PDFs (lesson documents, certificates) and the video players lessons embed.
    'frame-src': ["'self'", ...LEARNING_FRAME_HOSTS],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(opts.dev ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    // Hosted lead forms are meant to be embedded on customers' sites; nothing else may be framed.
    'frame-ancestors': [opts.embeddable ? '*' : "'none'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  // Only behind TLS: on a plain-HTTP local run it would rewrite the app's own asset URLs to https.
  if (opts.https && !opts.dev) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
