import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * What the App Store and Google Play need from the app's configuration (ADR 0072, M9), checked before a build is
 * sent, so a missing icon or permission text fails here instead of in store review.
 */

const ROOT = join(import.meta.dirname, '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8'));

/** Width, height and PNG colour type (2 = RGB, 6 = RGBA) from the file's header. */
function png(path: string) {
  const b = readFileSync(join(ROOT, path));
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] };
}
const plugin = (name: string) => (app.plugins as (string | [string, Record<string, unknown>])[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);

describe('store configuration', () => {
  it('has one identity on both stores', () => {
    expect(app.name).toBe('SampForce');
    expect(app.ios.bundleIdentifier).toBe('com.sampledge.sampforce');
    expect(app.android.package).toBe('com.sampledge.sampforce');
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    // Phones only: an iPad app would need its own screenshots and review.
    expect(app.ios.supportsTablet).toBe(false);
    expect(app.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it('has icons the stores accept', () => {
    // The App Store icon may not be transparent.
    expect(png(app.icon)).toEqual({ width: 1024, height: 1024, colourType: 2 });
    expect(png(app.android.adaptiveIcon.foregroundImage)).toMatchObject({ width: 1024, height: 1024, colourType: 6 });
    expect(app.android.adaptiveIcon.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    const notifications = plugin('expo-notifications') as [string, { icon: string }];
    expect(png(notifications[1].icon)).toMatchObject({ width: 96, height: 96, colourType: 6 });
    const splash = plugin('expo-splash-screen') as [string, { image: string }];
    expect(existsSync(join(ROOT, splash[1].image))).toBe(true);
  });

  it('asks only for what it uses, and says why', () => {
    const picker = plugin('expo-image-picker') as [string, Record<string, unknown>];
    expect(picker[1].photosPermission).toMatch(/profile picture/);
    expect(picker[1].cameraPermission).toMatch(/profile picture/);
    expect(picker[1].microphonePermission).toBe(false);
    expect(app.android.permissions).toEqual(expect.arrayContaining(['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS']));
    expect(app.android.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.ACCESS_FINE_LOCATION']));
    expect(app.ios.privacyManifests.NSPrivacyTracking).toBe(false);
  });

  it('links its privacy notice and builds for the stores', () => {
    expect(app.extra.privacyUrl).toMatch(/^https:\/\/.+\/app-privacy$/);
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.preview.distribution).toBe('internal');
  });
});
