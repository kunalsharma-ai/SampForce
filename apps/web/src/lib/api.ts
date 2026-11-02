import type { ApiErrorBody } from '@dealflow/types';
import { useRegional } from '@/stores/regional';

/**
 * The API writes its messages (errors, validation problems, sentences it composes) in the language this header
 * names, so they match the interface the person chose rather than the browser's own preference.
 */
export function languageHeader(): { 'accept-language': string } {
  return { 'accept-language': useRegional.getState().regional.language };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Sign-in steps answer 401 for wrong credentials; refreshing the session would not help them. */
const NO_REFRESH = /^\/(operator\/|client-portal\/|auth\/(login|register|refresh|logout|invitations|mfa\/verify))/;

/** Single-flight refresh so parallel 401s trigger one token rotation, not many. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Calls the DealFlow API through the same-origin proxy. On 401 it rotates the refresh token
 * once and retries; if that fails the caller receives the 401 and the shell redirects to sign-in.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...languageHeader(), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  // Operator sessions have no refresh token; only workspace sessions are refreshed.
  if (res.status === 401 && retry && !NO_REFRESH.test(path)) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
    );
  }
  return body as T;
}

/** Downloads a CSV export through the same refresh-aware path as JSON calls. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res = await fetch(`/api/v1${path}`, { credentials: 'include', headers: languageHeader() });
  if (res.status === 401 && (await refreshSession())) res = await fetch(`/api/v1${path}`, { credentials: 'include', headers: languageHeader() });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? 'Download failed.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
