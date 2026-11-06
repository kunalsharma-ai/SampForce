/**
 * Copies src/ to dist/ and zips it for the Chrome Web Store or for loading unpacked.
 *   node build.mjs          → dist/ and sampforce-extension-<version>.zip
 *   node build.mjs --test   → dist-test/: site access granted at install, for the browser tests only
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const test = process.argv.includes('--test');
const out = join(here, test ? 'dist-test' : 'dist');
rmSync(out, { recursive: true, force: true });
cpSync(join(here, 'src'), out, { recursive: true });

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
if (test) {
  // Automated browsers cannot click the permission prompt, so the test build asks for site access up front.
  manifest.host_permissions = manifest.optional_host_permissions;
  delete manifest.optional_host_permissions;
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

if (!test) {
  const zip = join(here, `sampforce-extension-${manifest.version}.zip`);
  rmSync(zip, { force: true });
  if (existsSync('/usr/bin/zip') || process.platform !== 'win32') {
    execFileSync('zip', ['-qr', zip, '.'], { cwd: out });
    console.warn(`Built ${zip}`);
  }
}
