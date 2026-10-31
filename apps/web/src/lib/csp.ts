/**
 * Content Security Policy for every page. Scripts must carry the per-request nonce (Next.js adds it to its
 * own scripts when it sees the policy on the request); 'strict-dynamic' lets those scripts load the code
 * chunks they import. Inline style attributes stay allowed because the chart and animation libraries set
 * them; styles cannot run code.
 */
export function contentSecurityPolicy(nonce: string, opts: { embeddable?: boolean; dev?: boolean; https?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
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
