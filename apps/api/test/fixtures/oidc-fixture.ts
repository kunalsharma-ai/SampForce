import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

/**
 * A local OpenID Connect provider for tests: discovery, an authorize endpoint that signs the person in
 * at once, a token endpoint that checks client credentials and PKCE, and a JWKS. `next` controls the
 * claims of the following ID token, including deliberately wrong ones.
 */
export interface OidcFixture {
  issuer: string;
  clientId: string;
  clientSecret: string;
  next: { sub: string; email: string; name?: string; email_verified?: boolean; nonce?: string; iss?: string; aud?: string; signWithOtherKey?: boolean };
  /** Requests the token endpoint refused, with the reason. */
  refusals: string[];
  close: () => Promise<void>;
}

export async function createOidcFixture(port = 0): Promise<OidcFixture> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'fixture-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { clientId: string; redirectUri: string; nonce: string; challenge: string }>();
  const fixture = { clientId: 'dealflow-test', clientSecret: 'fixture-secret with spaces', next: { sub: 'user-1', email: 'ada@acme.test' }, refusals: [] } as unknown as OidcFixture;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', fixture.issuer);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer: fixture.issuer,
        authorization_endpoint: `${fixture.issuer}/authorize`,
        token_endpoint: `${fixture.issuer}/token`,
        jwks_uri: `${fixture.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== fixture.clientId || p.get('code_challenge_method') !== 'S256' || !p.get('nonce')) return send(400, { error: 'invalid_request' });
      const code = randomBytes(16).toString('hex');
      codes.set(code, { clientId: p.get('client_id')!, redirectUri: p.get('redirect_uri')!, nonce: p.get('nonce')!, challenge: p.get('code_challenge')! });
      const back = new URL(p.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state')!);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        void (async () => {
          const form = new URLSearchParams(raw);
          const basic = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
          const [id, secret] = basic.split(':').map((s) => decodeURIComponent(s.replace(/\+/g, ' ')));
          const grant = codes.get(form.get('code') ?? '');
          const refuse = (why: string) => {
            fixture.refusals.push(why);
            send(400, { error: 'invalid_grant' });
          };
          if (id !== fixture.clientId || secret !== fixture.clientSecret) return refuse('client');
          if (!grant) return refuse('code');
          codes.delete(form.get('code')!);
          if (grant.redirectUri !== form.get('redirect_uri')) return refuse('redirect_uri');
          if (createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) return refuse('pkce');
          const n = fixture.next;
          const idToken = await new SignJWT({ email: n.email, name: n.name ?? 'Ada Lovelace', ...(n.email_verified === undefined ? { email_verified: true } : { email_verified: n.email_verified }), nonce: n.nonce ?? grant.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'fixture-1' })
            .setIssuer(n.iss ?? fixture.issuer)
            .setAudience(n.aud ?? grant.clientId)
            .setSubject(n.sub)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(n.signWithOtherKey ? other.privateKey : privateKey);
          send(200, { access_token: 'unused', token_type: 'Bearer', expires_in: 300, id_token: idToken });
        })();
      });
      return;
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const addr = server.address();
  fixture.issuer = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}`;
  fixture.close = () => new Promise((r) => server.close(() => r()));
  return fixture;
}
