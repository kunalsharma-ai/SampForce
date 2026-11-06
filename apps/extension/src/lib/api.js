/** Talks to the person's SampForce with the extension's own connection token. */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** "app.dealflow.example/app/leads" → "https://app.dealflow.example". Plain http only for this computer. */
export function normaliseBase(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function connection() {
  const { baseUrl, token, me } = await chrome.storage.local.get(['baseUrl', 'token', 'me']);
  return baseUrl && token ? { baseUrl, token, me: me ?? null } : null;
}

export async function call(path, { method = 'GET', body, baseUrl, token } = {}) {
  if (!baseUrl || !token) {
    const c = await connection();
    if (!c) throw new ApiError(401, 'NOT_CONNECTED', 'Connect the extension to SampForce first.');
    baseUrl ??= c.baseUrl;
    token ??= c.token;
  }
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      // The extension's own screens are in English, so its error messages are too.
      headers: { authorization: `Bearer ${token}`, 'accept-language': 'en', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Could not reach SampForce at ${baseUrl}. Check the address and your connection.`);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    const message =
      res.status === 401
        ? 'This connection has ended. Create a new connection code in SampForce and connect again.'
        : err?.message ?? `SampForce answered with an error (${res.status}).`;
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, message);
  }
  return data;
}

/** Signs in with a SampForce email and password (no token yet). Answers a connection, or a second-factor challenge. */
export async function signIn(baseUrl, path, body) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': 'en' }, body: JSON.stringify(body), credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'NETWORK', `Could not reach SampForce at ${baseUrl}. Check the address and your connection.`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'HTTP_' + res.status, data?.error?.message ?? `SampForce answered with an error (${res.status}).`);
  return data;
}
