/**
 * Changes the current page's query string (views, filters, the open record) without asking the server for the
 * page again.
 *
 * `router.replace()` re-requests the page from the server even when only the query changes. While that response
 * streams in, Next.js takes the page's <title> out of the document and puts it back, so the browser tab, and what
 * a screen reader announces, goes blank for a moment on every view or filter change (axe flags it as a missing
 * page title). On the pages that use this the query only drives client state, so the History API is enough:
 * Next.js keeps `useSearchParams()` and `usePathname()` in step with `history.replaceState`.
 *
 * The patch is applied to the address as it is now, not to a `useSearchParams()` value captured at render, so two
 * changes made before React re-renders (opening a deal, then closing it) both take effect.
 */
export function replaceQuery(patch: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const query = url.searchParams.toString();
  // `null`, not the current state: Next.js only syncs its router for calls that do not carry its own state object.
  window.history.replaceState(null, '',`${url.pathname}${query ? `?${query}` : ''}${url.hash}`);
}
