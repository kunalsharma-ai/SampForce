// Every image in src/assets/media is available by its file name without extension: media('command') etc.
// Vite fingerprints them in the normal build and inlines them in the standalone build.
const files = import.meta.glob('../assets/media/*.{webp,png,jpg,jpeg,svg}', { eager: true, import: 'default' });

const byName = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split('/').pop().replace(/\.[^.]+$/, ''), url]),
);

export function media(name) {
  const url = byName[name];
  if (!url && import.meta.env.DEV) console.warn(`[media] missing image "${name}" in src/assets/media`);
  return url ?? '';
}

export { default as logoOnDark } from '../assets/brand/sampforce-logo-dark.svg';
export { default as logoOnLight } from '../assets/brand/sampforce-logo-light.svg';
export { default as iconSvg } from '../assets/brand/sampforce-icon.svg';
// Static icon (no built-in animation): used where the full bolt must always be visible.
export { default as iconStatic } from '../assets/brand/sampforce-icon-512.png';
