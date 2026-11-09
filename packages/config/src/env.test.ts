import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env';

const base = {
  DATABASE_URL: 'mongodb://u:p@db1:27017,db2:27017/sampforce?replicaSet=rs0',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadApiEnv', () => {
  it('applies defaults', () => {
    const env = loadApiEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('takes MongoDB connection strings, including replica sets and SRV records, and nothing else', () => {
    expect(loadApiEnv(base).DATABASE_URL).toContain('replicaSet=rs0');
    expect(loadApiEnv({ ...base, DATABASE_URL: 'mongodb+srv://u:p@cluster0.example.net/sampforce' }).DATABASE_URL).toMatch(/^mongodb\+srv/);
    expect(() => loadApiEnv({ ...base, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects short secrets with a readable message', () => {
    expect(() => loadApiEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires secure cookies in production', () => {
    expect(() => loadApiEnv({ ...base, NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
    const prod = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true', ENCRYPTION_KEY: 'k'.repeat(44) };
    expect(loadApiEnv(prod).COOKIE_SECURE).toBe(true);
  });

  it('requires an encryption key and refuses private network targets in production', () => {
    const prod = { ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' };
    expect(() => loadApiEnv(prod)).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadApiEnv({ ...prod, ENCRYPTION_KEY: 'k'.repeat(44), ALLOW_PRIVATE_NETWORK_TARGETS: 'true' })).toThrow(
      /ALLOW_PRIVATE_NETWORK_TARGETS/,
    );
  });
});
