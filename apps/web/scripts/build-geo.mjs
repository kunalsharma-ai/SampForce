// Builds the small geography files the Revenue Globe draws, from Natural Earth data (public domain) as packaged by
// world-atlas (ISC). Run after upgrading world-atlas: `node scripts/build-geo.mjs`. Output is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoArea, geoCentroid } from 'd3-geo';
import countries from 'i18n-iso-countries';
import { feature, mesh } from 'topojson-client';

const require = createRequire(import.meta.url);
const load = (f) => JSON.parse(readFileSync(require.resolve(`world-atlas/${f}`), 'utf8'));
const r1 = (v) => Math.round(v * 10) / 10;

// Borders and coastlines at 1:110m, as polylines of [lng, lat].
const coarse = load('countries-110m.json');
const lines = mesh(coarse, coarse.objects.countries).coordinates.map((line) => line.flatMap(([lng, lat]) => [r1(lng), r1(lat)]));
writeFileSync('public/geo/borders-110m.json', JSON.stringify(lines));

// One anchor point per country at 1:50m (small countries are missing at 110m): the centroid of its largest polygon,
// so that overseas territories do not pull the point into the ocean.
const fine = load('countries-50m.json');
const out = {};
for (const f of feature(fine, fine.objects.countries).features) {
  const a2 = countries.numericToAlpha2(String(f.id).padStart(3, '0'));
  if (!a2 || out[a2]) continue;
  let geom = f.geometry;
  if (geom?.type === 'MultiPolygon') {
    const polys = geom.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
    geom = polys.reduce((best, p) => (geoArea(p) > geoArea(best) ? p : best));
  }
  if (!geom) continue;
  const [lng, lat] = geoCentroid(geom);
  out[a2] = [r1(lat), r1(lng)];
}
writeFileSync('src/lib/geo/anchors.json', JSON.stringify(out));
console.log(`${lines.length} border lines, ${Object.keys(out).length} country anchors`);
