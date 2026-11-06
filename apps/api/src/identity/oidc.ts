import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import { Agent as HttpsAgent } from 'node:https';
import { assertPublicUrl, guardedLookup, publicFetch, UnsafeTargetError } from '../common/net-guard';

/**
 * A minimal OpenID Connect relying party: discovery, the authorization-code flow with PKCE (S256), and
 * ID token validation (signature from the provider's JWKS, issuer, audience, expiry, nonce). Only what
 * SampForce needs to learn who signed in; no access tokens are kept.
 */

export interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
}

export class OidcError extends Error {
  constructor(
    readonly reason: 'discovery' | 'provider_error' | 'invalid_response',
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;
const ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];

const jwksAgent = new HttpsAgent({ lookup: guardedLookup(), keepAlive: true });

const discoveryCache = new Map<string, { at: number; meta: ProviderMetadata }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function guardedUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  try {
    return await assertPublicUrl(raw, allowPrivate);
  } catch (e) {
    throw new OidcError('discovery', e instanceof UnsafeTargetError ? e.message : 'Invalid URL');
  }
}

/** Fetches and checks the provider's discovery document. Cached for ten minutes per issuer. */
export async function discover(issuer: string, allowPrivate: boolean, fresh = false): Promise<ProviderMetadata> {
  const cached = discoveryCache.get(issuer);
  if (!fresh && cached && Date.now() - cached.at < 600_000) return cached.meta;
  const url = await guardedUrl(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, allowPrivate);
  let res: Response;
  try {
    res = await publicFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }, allowPrivate);
  } catch {
    throw new OidcError('discovery', 'The identity provider could not be reached.');
  }
  if (!res.ok) throw new OidcError('discovery', `The identity provider answered ${res.status} for its discovery document.`);
  const meta = (await res.json().catch(() => null)) as ProviderMetadata | null;
  if (!meta || typeof meta.authorization_endpoint !== 'string' || typeof meta.token_endpoint !== 'string' || typeof meta.jwks_uri !== 'string') {
    throw new OidcError('discovery', 'The discovery document is missing required endpoints.');
  }
  // OpenID Connect Discovery §4.3: the issuer in the document must be exactly the one configured.
  if (meta.issuer !== issuer) throw new OidcError('discovery', `The provider reports issuer ${String(meta.issuer)}, not ${issuer}.`);
  for (const u of [meta.authorization_endpoint, meta.token_endpoint, meta.jwks_uri]) await guardedUrl(u, allowPrivate);
  discoveryCache.set(issuer, { at: Date.now(), meta });
  return meta;
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function authorizationRequest(meta: ProviderMetadata, clientId: string, redirectUri: string, loginHint?: string): AuthorizationRequest {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const url = new URL(meta.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  if (loginHint) params.login_hint = loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), state, nonce, codeVerifier };
}

export interface VerifiedIdentity {
  subject: string;
  email: string;
  name: string | null;
  claims: JWTPayload;
}

/** Exchanges the authorization code and validates the ID token it returns. */
export async function exchangeCode(
  meta: ProviderMetadata,
  client: { clientId: string; clientSecret: string },
  params: { code: string; redirectUri: string; codeVerifier: string; nonce: string },
  allowPrivate: boolean,
): Promise<VerifiedIdentity> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri, code_verifier: params.codeVerifier });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  const methods = meta.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
  if (methods.includes('client_secret_basic')) {
    // RFC 6749 §2.3.1: form-encode the id and secret before base64.
    const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
    headers.authorization = `Basic ${Buffer.from(`${enc(client.clientId)}:${enc(client.clientSecret)}`).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    body.set('client_secret', client.clientSecret);
  }
  let res: Response;
  try {
    res = await publicFetch(meta.token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' }, allowPrivate);
  } catch {
    throw new OidcError('provider_error', 'The token endpoint could not be reached.');
  }
  const json = (await res.json().catch(() => null)) as { id_token?: string; error?: string } | null;
  if (!res.ok || !json?.id_token) throw new OidcError('provider_error', json?.error ? `Token exchange failed (${res.status}: ${json.error}).` : `Token exchange failed (${res.status}).`);

  let jwks = jwksCache.get(meta.jwks_uri);
  if (!jwks) {
    // The JWKS connection resolves through the same guard, so the key set cannot be fetched from an internal address.
    jwks = createRemoteJWKSet(new URL(meta.jwks_uri), { timeoutDuration: TIMEOUT_MS, ...(allowPrivate ? {} : { agent: jwksAgent }) });
    jwksCache.set(meta.jwks_uri, jwks);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(json.id_token, jwks, { issuer: meta.issuer, audience: client.clientId, algorithms: ALGS, clockTolerance: 60 }));
  } catch (e) {
    throw new OidcError('invalid_response', `The ID token did not verify: ${(e as Error).message}`);
  }
  if (payload.nonce !== params.nonce) throw new OidcError('invalid_response', 'The ID token nonce does not match this sign-in.');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== client.clientId) {
    throw new OidcError('invalid_response', 'The ID token was issued to a different client.');
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OidcError('invalid_response', 'The identity provider did not send an email address.');
  // Providers that say the address is unverified are refused; some (Microsoft Entra ID) omit the claim.
  if (payload.email_verified === false || payload.email_verified === 'false') throw new OidcError('invalid_response', 'The identity provider says this email address is not verified.');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new OidcError('invalid_response', 'The ID token has no subject.');
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 120) : null;
  return { subject: payload.sub, email, name, claims: payload };
}

/** For tests: forget cached discovery documents and key sets. */
export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
