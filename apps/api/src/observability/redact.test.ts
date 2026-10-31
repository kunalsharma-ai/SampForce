import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact';

describe('redactUrl', () => {
  it('hides tokens in paths and secrets in query strings', () => {
    expect(redactUrl('/api/v1/auth/invitations/abc123')).toBe('/api/v1/auth/invitations/[redacted]');
    expect(redactUrl('/api/v1/auth/invitations/accept')).toBe('/api/v1/auth/invitations/accept');
    expect(redactUrl('/api/v1/auth/sso/callback?code=xyz&state=s1')).toBe('/api/v1/auth/sso/callback?code=[redacted]&state=[redacted]');
    expect(redactUrl('/api/v1/integrations/google/callback?code=1&scope=email')).toBe('/api/v1/integrations/google/callback?code=[redacted]&scope=email');
    expect(redactUrl('/api/v1/contacts?page=2')).toBe('/api/v1/contacts?page=2');
    expect(redactUrl(undefined)).toBe('');
  });
});
