import { PASSWORD_CONFIRMATION_HEADER } from '@dealflow/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { setPasswordConfirmationAsker } from './password-confirmation';

/* The API client asks for the password when the server wants a confirmation, then sends the request again. */

const refused = () =>
  new Response(JSON.stringify({ error: { code: 'PASSWORD_CONFIRMATION_REQUIRED', message: 'Enter your password to delete this.' } }), { status: 403, headers: { 'content-type': 'application/json' } });

describe('password confirmation in api()', () => {
  afterEach(() => {
    setPasswordConfirmationAsker(null);
    vi.unstubAllGlobals();
  });

  it('asks for the password and repeats the delete with the one-time pass', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const ask = vi.fn().mockResolvedValue('pass-123');
    setPasswordConfirmationAsker(ask);

    await api('/leads/1', { method: 'DELETE' });
    expect(ask).toHaveBeenCalledWith({ method: 'DELETE', path: '/leads/1', message: 'Enter your password to delete this.' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ [PASSWORD_CONFIRMATION_HEADER]: 'pass-123' });
  });

  it('deletes nothing when the person cancels', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(refused());
    vi.stubGlobal('fetch', fetch);
    setPasswordConfirmationAsker(() => Promise.resolve(null));
    await expect(api('/leads/1', { method: 'DELETE' })).rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' } satisfies Partial<ApiError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes the refusal on when nothing can ask (a page without the dialog)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(refused()));
    await expect(api('/leads/1', { method: 'DELETE' })).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CONFIRMATION_REQUIRED' });
  });
});
