import { describe, expect, it } from 'vitest';
import { explainNetworkError, hostAndPort, networkCode } from './network-error';

const fetchError = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code}`), { code }) });

describe('connection failures in words', () => {
  it('finds the system code on fetch errors and in nodemailer messages', () => {
    expect(networkCode(fetchError('ENETUNREACH'))).toBe('ENETUNREACH');
    expect(networkCode(Object.assign(new Error('connect ETIMEDOUT 1.2.3.4:587'), { code: 'ESOCKET' }))).toBe('ETIMEDOUT');
    expect(networkCode(new Error('nope'))).toBeNull();
  });

  it('says an IPv6 address is unreachable because the containers have no IPv6', () => {
    const { host, port } = hostAndPort('http://[2406:b400:71:c635::1]:11434/v1');
    expect(host).toBe('[2406:b400:71:c635::1]');
    expect(port).toBe('11434');
    expect(explainNetworkError(fetchError('ENETUNREACH'), 'The AI server', host, port)).toMatch(/no IPv6 route.*host\.docker\.internal/);
  });

  it('explains localhost, refused connections, firewalls and unknown names', () => {
    expect(explainNetworkError(fetchError('ECONNREFUSED'), 'The AI server', 'localhost', '11434')).toMatch(/localhost is the container itself/);
    expect(explainNetworkError(fetchError('ECONNREFUSED'), 'The AI server', '10.0.0.5', '11434')).toMatch(/OLLAMA_HOST=0\.0\.0\.0/);
    expect(explainNetworkError(fetchError('UND_ERR_CONNECT_TIMEOUT'), 'The AI server', '10.0.0.5', '11434')).toMatch(/firewall/);
    expect(explainNetworkError(fetchError('ENOTFOUND'), 'The email service', 'smtp.exmple.com', '587')).toMatch(/does not resolve/);
  });
});
