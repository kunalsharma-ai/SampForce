import type { MobileConfigResponse, MobileResolvedConfig, MobileSession } from '@dealflow/types';

/**
 * Keeps the phone's copy of its published Mobile Configuration (ADR 0072, M2). The server narrows the configuration to
 * the person, so the copy belongs to one person in one organisation at one level and role: if any of those change, the
 * copy is fetched again even when the version number did not move.
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CachedConfig {
  owner: string;
  version: number;
  config: MobileResolvedConfig;
}

export const CONFIG_KEY = 'sampforce.config';

/** Who the copy was made for. Permissions are sorted so their order never forces a fetch. */
export function configOwner(s: Pick<MobileSession, 'user' | 'organisation' | 'level' | 'role' | 'permissions'>): string {
  return [s.organisation.id, s.user.id, s.level, s.role, [...s.permissions].sort().join(',')].join('|');
}

export async function readCachedConfig(store: KeyValueStore): Promise<CachedConfig | null> {
  try {
    const raw = await store.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedConfig;
    return typeof parsed?.owner === 'string' && typeof parsed.version === 'number' && parsed.config ? parsed : null;
  } catch {
    return null;
  }
}

export interface ConfigFetcher {
  get<T>(path: string): Promise<T>;
}

/**
 * The configuration for this session: the stored copy when it is current, otherwise the server's. The server is asked
 * with `known=<version>` so an unchanged version costs one small reply.
 */
export async function syncConfig(api: ConfigFetcher, session: MobileSession, store: KeyValueStore): Promise<CachedConfig> {
  const owner = configOwner(session);
  const cached = await readCachedConfig(store);
  const mine = cached && cached.owner === owner ? cached : null;
  if (mine && mine.version === session.configVersion) return mine;
  const res = await api.get<MobileConfigResponse>(mine ? `/mobile/config?known=${mine.version}` : '/mobile/config');
  if (res.unchanged && mine) return mine;
  if (!res.config) {
    // "unchanged" for a copy this phone does not have: ask again for the whole configuration.
    const full = await api.get<MobileConfigResponse>('/mobile/config');
    if (!full.config) throw new Error('The server sent no configuration.');
    return keep(store, { owner, version: full.version, config: full.config });
  }
  return keep(store, { owner, version: res.version, config: res.config });
}

async function keep(store: KeyValueStore, c: CachedConfig): Promise<CachedConfig> {
  await store.setItem(CONFIG_KEY, JSON.stringify(c));
  return c;
}
