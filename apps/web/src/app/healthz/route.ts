/** Liveness and readiness for the web server itself (it holds no state; the API has its own checks). */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
