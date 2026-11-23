import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * What a store build (EAS Build, `expo export:embed`) needs, checked here so it fails in CI instead of on the build
 * server (issue #94): the app's Expo packages match the versions its Expo SDK expects (what `expo doctor` checks),
 * native peer dependencies are installed directly, and workspace packages resolve on a fresh checkout.
 */

const ROOT = join(import.meta.dirname, '..');
const require = createRequire(join(ROOT, 'package.json'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const deps = pkg.dependencies;
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const installedPackageJson = (name: string) =>
  readJson(join(dirname(require.resolve(`${name}/package.json`)), 'package.json'));

const parse = (v: string) =>
  v.replace(/^[~^]/, '').split('.').map(Number) as [number, number, number];

/** Whether an exact pinned version satisfies an Expo range: "1.2.3", "~1.2.3" or "^1.2.3". */
function satisfies(version: string, range: string): boolean {
  const [ma, mi, pa] = parse(version);
  const [rMa, rMi, rPa] = parse(range);
  if (range.startsWith('~')) return ma === rMa && mi === rMi && pa >= rPa;
  if (range.startsWith('^')) return ma === rMa && (mi > rMi || (mi === rMi && pa >= rPa));
  return version === range;
}

describe('store build', () => {
  it('pins each package at a version the installed Expo SDK expects', () => {
    const bundled = readJson(
      join(dirname(require.resolve('expo/package.json')), 'bundledNativeModules.json'),
    ) as Record<string, string>;
    const mismatches = Object.entries(deps)
      .filter(
        ([name, version]) =>
          bundled[name] && !version.startsWith('workspace:') && !satisfies(version, bundled[name]),
      )
      .map(([name, version]) => `${name} ${version} (expected ${bundled[name]})`);
    expect(mismatches).toEqual([]);
  });

  it('installs the native peer dependencies of its packages directly', () => {
    const missing: string[] = [];
    for (const name of Object.keys(deps)) {
      if (deps[name]?.startsWith('workspace:')) continue;
      const { peerDependencies = {}, peerDependenciesMeta = {} } = installedPackageJson(name);
      for (const peer of Object.keys(peerDependencies)) {
        const native = peer.startsWith('expo-') || peer.startsWith('react-native-');
        if (native && !peerDependenciesMeta[peer]?.optional && !deps[peer])
          missing.push(`${peer} (needed by ${name})`);
      }
    }
    expect(missing).toEqual([]);
    // The one issue #94 found: icons need fonts outside Expo Go.
    expect(deps['expo-font']).toBeDefined();
  });

  it('bundles @dealflow/types from source, so a fresh checkout without its dist/ folder still builds', () => {
    const config = require('./metro.config.js');
    const fallback = () => ({ type: 'empty' });
    const resolved = config.resolver.resolveRequest(
      { resolveRequest: fallback },
      '@dealflow/types',
      'android',
    );
    expect(resolved.type).toBe('sourceFile');
    expect(resolved.filePath).toBe(join(ROOT, '../../packages/types/src/index.ts'));
    expect(existsSync(resolved.filePath)).toBe(true);
    // Every other import still goes through Expo's normal resolver.
    expect(
      config.resolver.resolveRequest({ resolveRequest: fallback }, 'react-native', 'android'),
    ).toEqual({ type: 'empty' });
  });
});
