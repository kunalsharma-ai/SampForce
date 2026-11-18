import { describe, expect, it } from 'vitest';
import type { ApiEnv } from './env';
import { UnsafeTargetError } from './net-guard';
import { allowedAddresses, assertWorkspaceUrl, isTrusted, parseTrustedHosts } from './trusted-targets';

const env = (trusted?: string) => ({ ALLOW_PRIVATE_NETWORK_TARGETS: false, TRUSTED_PRIVATE_HOSTS: trusted }) as unknown as ApiEnv;

describe('servers a workspace brings itself (ADR 0068)', () => {
  it('reads the operator’s list of names, addresses and ranges, and says what is wrong with a bad entry', () => {
    const t = parseTrustedHosts('ollama.lan, 10.0.0.0/8 [2406:b400::]/32\n192.168.1.20');
    expect(t.empty).toBe(false);
    expect(isTrusted(t, 'ollama.lan', '172.17.0.5')).toBe(true);
    expect(isTrusted(t, 'other.lan', '10.20.30.40')).toBe(true);
    expect(isTrusted(t, 'x', '2406:b400:71:c635:ea86:c5e:a0d6:76af')).toBe(true);
    expect(isTrusted(t, 'x', '192.168.1.20')).toBe(true);
    expect(isTrusted(t, 'x', '192.168.1.21')).toBe(false);
    expect(isTrusted(t, 'x', '169.254.169.254')).toBe(false);
    expect(parseTrustedHosts('').empty).toBe(true);
    expect(() => parseTrustedHosts('10.0.0.0/40')).toThrow('"10.0.0.0/40" has an invalid range size.');
    expect(() => parseTrustedHosts('http://ollama:11434')).toThrow(/is not a host name, an address or a range/);
  });

  it('allows public addresses, and private ones only when the operator approved them', async () => {
    await expect(allowedAddresses(env(), '8.8.8.8')).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
    await expect(allowedAddresses(env(), '10.1.2.3')).rejects.toThrow(UnsafeTargetError);
    await expect(allowedAddresses(env(), '10.1.2.3')).rejects.toThrow(/10\.1\.2\.3 is a private or internal address.*operator console > Providers > Workspace servers/);
    await expect(allowedAddresses(env(), '127.0.0.1')).rejects.toThrow(UnsafeTargetError);
    await expect(allowedAddresses(env(), '[fd00::1]')).rejects.toThrow(UnsafeTargetError);
    await expect(allowedAddresses(env('10.0.0.0/8'), '10.1.2.3')).resolves.toHaveLength(1);
    await expect(allowedAddresses(env('10.0.0.0/8'), '169.254.169.254')).rejects.toThrow(UnsafeTargetError);
  });

  it('needs https across the internet; plain http only to an approved private server', async () => {
    await expect(assertWorkspaceUrl(env(), 'http://8.8.8.8/v1')).rejects.toThrow(/Use an https:\/\/ address/);
    await expect(assertWorkspaceUrl(env(), 'https://8.8.8.8/v1')).resolves.toBeUndefined();
    await expect(assertWorkspaceUrl(env(), 'http://192.168.1.20:11434/v1')).rejects.toThrow(/private or internal address/);
    await expect(assertWorkspaceUrl(env('192.168.1.20'), 'http://192.168.1.20:11434/v1')).resolves.toBeUndefined();
    await expect(assertWorkspaceUrl(env(), 'https://user:pw@8.8.8.8/v1')).rejects.toThrow(/user name or password/);
    await expect(assertWorkspaceUrl(env(), 'file:///etc/passwd')).rejects.toThrow(/Only http and https/);
  });
});
