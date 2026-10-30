import { type NextRequest, NextResponse } from 'next/server';

/**
 * Coarse routing gate. Real authorization happens in the API on every request; this only
 * avoids rendering the app shell for visitors who clearly have no session. Visitors without a
 * session see the public landing page at `/`.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('df_access') || req.cookies.has('df_refresh');
  const { pathname, search } = req.nextUrl;

  if (pathname === '/') {
    return hasSession ? NextResponse.redirect(new URL('/app', req.url)) : NextResponse.next();
  }
  if (pathname.startsWith('/app') && !hasSession) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/app/:path*'] };
