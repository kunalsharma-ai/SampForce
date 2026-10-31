/**
 * Removes secrets from request URLs before they reach logs or traces: invitation tokens in paths, and the
 * OAuth/SSO `code` and `state` (and any `token`) in query strings.
 */
const SECRET_PARAMS = new Set(['code', 'state', 'token', 'id_token', 'access_token', 'session_state']);

export function redactUrl(url: string | undefined): string {
  if (!url) return '';
  const [path, query] = url.split('?', 2) as [string, string | undefined];
  const safePath = path
    .replace(/(\/auth\/invitations\/)(?!accept\b)[^/?]+/, '$1[redacted]')
    .replace(/(\/public\/forms\/|\/f\/)[^/?]+/, '$1[redacted]');
  if (!query) return safePath;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (SECRET_PARAMS.has(key.toLowerCase())) params.set(key, '[redacted]');
  return `${safePath}?${params.toString().replace(/%5Bredacted%5D/g, '[redacted]')}`;
}
