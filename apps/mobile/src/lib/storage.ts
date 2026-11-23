import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { StoredTokens, TokenStore } from './api';
import type { KeyValueStore } from './config-sync';

const TOKENS_KEY = 'sampforce.tokens';
const INSTALL_KEY = 'sampforce.install';

/**
 * Tokens live in the Keychain (iOS) or the Keystore-backed store (Android), readable only while the phone is unlocked
 * and never backed up to another device. The web build is only for previews; it falls back to browser storage.
 */
const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string | null): Promise<void> {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
};

export const secureTokens: TokenStore = {
  async get() {
    const raw = await secure.get(TOKENS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredTokens;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    await secure.set(TOKENS_KEY, tokens ? JSON.stringify(tokens) : null);
  },
};

/** The app's random install id: one phone stays one device row across sign-ins (ADR 0072). */
export async function installId(newId: () => string): Promise<string> {
  const existing = await secure.get(INSTALL_KEY);
  if (existing) return existing;
  const id = newId().replace(/[^A-Za-z0-9_-]/g, '');
  await secure.set(INSTALL_KEY, id);
  return id;
}

/** Plain storage for things that are not secret: the server address and the configuration copy. */
export const plainStore: KeyValueStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};
