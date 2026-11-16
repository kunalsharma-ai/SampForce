import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Injectable, NotFoundException } from '@nestjs/common';
import { geoCountry, type GeoCity, type GeoRegion } from '@dealflow/types';

/** apps/api/assets/geo, built by scripts/geo/build-geo-data.mjs (sources and licences in scripts/geo/README.md). */
const DATA_DIR = join(__dirname, '..', '..', 'assets', 'geo');

type RegionRows = Record<string, Array<[string, string, string]>>;
type CityRows = Record<string, Array<[string, string, number]>>;

/**
 * States, provinces and cities for the location pickers. The data (about 1.2 MB compressed) is read on first use and
 * kept in memory. Places not in the list can always be typed by hand.
 */
@Injectable()
export class GeoService {
  private regionsData?: RegionRows;
  private citiesData?: CityRows;

  regions(country: string): GeoRegion[] {
    const code = this.country(country);
    this.regionsData ??= JSON.parse(gunzipSync(readFileSync(join(DATA_DIR, 'regions.json.gz'))).toString('utf8')) as RegionRows;
    return (this.regionsData[code] ?? []).map(([c, name, type]) => ({ code: c, name, type }));
  }

  /** Largest places first; `q` matches the start of a word, case and accents ignored. */
  cities(country: string, opts: { region?: string; q?: string; limit?: number }): GeoCity[] {
    const code = this.country(country);
    this.citiesData ??= JSON.parse(gunzipSync(readFileSync(join(DATA_DIR, 'cities.json.gz'))).toString('utf8')) as CityRows;
    const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = opts.q ? fold(opts.q.trim()) : '';
    const limit = Math.min(opts.limit ?? 50, 200);
    const out: GeoCity[] = [];
    for (const [name, region] of this.citiesData[code] ?? []) {
      if (opts.region && region !== opts.region) continue;
      if (q && !fold(name).split(/[\s-]+/).some((w, i, all) => w.startsWith(q) || all.slice(i).join(' ').startsWith(q))) continue;
      out.push({ name, region: region || null });
      if (out.length >= limit) break;
    }
    return out;
  }

  private country(code: string): string {
    const c = geoCountry(code);
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country.' });
    return c.code;
  }
}
