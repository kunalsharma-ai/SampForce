import { type NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy, newNonce } from '@/lib/csp';

/**
 * Coarse routing gate plus the per-request Content Security Policy. Real authorization happens in the API
 * on every request; the gate only avoids rendering the app shell for visitors who clearly have no session.
 * Visitors without a session see the public landing page at `/`.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('df_access') || req.cookies.has('df_refresh');
  const { pathname, search } = req.nextUrl;

  if (pathname === '/' && hasSession) return NextResponse.redirect(new URL('/app', req.url));
  if (pathname.startsWith('/app') && !hasSession) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = newNonce();
  const https = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  const policy = contentSecurityPolicy(nonce, { embeddable: pathname.startsWith('/f/'), dev: process.env.NODE_ENV === 'development', https });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', policy);
  return res;
}

export const config = {
  // Pages only: not the API proxy, build assets, or prefetches (which reuse the page's policy).
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|geo/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
