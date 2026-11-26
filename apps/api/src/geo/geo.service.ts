import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Injectable, NotFoundException } from '@nestjs/common';
import Holidays from 'date-holidays';
import { foldName, geoCountry, type GeoCity, type GeoRegion, type PublicHoliday } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';

/** apps/api/assets/geo, built by scripts/geo/build-geo-data.mjs (sources and licences in scripts/geo/README.md). */
const DATA_DIR = join(__dirname, '..', '..', 'assets', 'geo');

type RegionRows = Record<string, Array<[string, string, string]>>;
type CityRows = Record<string, Array<[string, string, number]>>;
type Edit = { id: string; regionCode: string | null; name: string; originalName: string | null };

export const foldPlace = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const EDITS_TTL_MS = 30_000;

/**
 * States, provinces and cities for the location pickers. The data (about 1.2 MB compressed) is read on first use and
 * kept in memory. Places not in the list can always be typed by hand.
 */
@Injectable()
export class GeoService {
  private regionsData?: RegionRows;
  private citiesData?: CityRows;
  private edits = new Map<string, { at: number; rows: Edit[] }>();

  constructor(private readonly prisma: PrismaService) {}

  /** The Console's city edits for a country, cached briefly; an edit made here clears the cache at once. */
  private async editsFor(code: string): Promise<Edit[]> {
    const hit = this.edits.get(code);
    if (hit && Date.now() - hit.at < EDITS_TTL_MS) return hit.rows;
    const rows = await this.prisma.geoCityEdit.findMany({ where: { countryCode: code }, select: { id: true, regionCode: true, name: true, originalName: true } });
    this.edits.set(code, { at: Date.now(), rows });
    return rows;
  }

  forgetEdits(country: string): void {
    this.edits.delete(country.toUpperCase());
  }

  /** Whether the shipped data has this city (by exact name, in the region when one is given). */
  shipped(country: string, region: string | null, name: string): boolean {
    const code = this.country(country);
    return (this.cityData()[code] ?? []).some(([n, r]) => n === name && (region === null || r === region));
  }

  private cityData(): CityRows {
    this.citiesData ??= JSON.parse(gunzipSync(readFileSync(join(DATA_DIR, 'cities.json.gz'))).toString('utf8')) as CityRows;
    return this.citiesData;
  }

  regions(country: string): GeoRegion[] {
    const code = this.country(country);
    this.regionsData ??= JSON.parse(gunzipSync(readFileSync(join(DATA_DIR, 'regions.json.gz'))).toString('utf8')) as RegionRows;
    return (this.regionsData[code] ?? []).map(([c, name, type]) => ({ code: c, name, type }));
  }

  /**
   * Largest places first; `q` matches the start of a word, case and accents ignored. Cities an operator added come
   * first, and a city an operator renamed shows its new name.
   */
  async cities(country: string, opts: { region?: string; q?: string; limit?: number }): Promise<GeoCity[]> {
    const code = this.country(country);
    const q = opts.q ? foldPlace(opts.q.trim()) : '';
    const limit = Math.min(opts.limit ?? 50, 200);
    const matches = (name: string) => !q || foldPlace(name).split(/[\s-]+/).some((w, i, all) => w.startsWith(q) || all.slice(i).join(' ').startsWith(q));
    const edits = await this.editsFor(code);
    const renamed = new Map(edits.filter((e) => e.originalName !== null).map((e) => [`${e.regionCode ?? ''}|${e.originalName}`, e.name]));
    const out: GeoCity[] = [];
    for (const e of edits) {
      if (e.originalName !== null || (opts.region && e.regionCode !== opts.region) || !matches(e.name)) continue;
      out.push({ name: e.name, region: e.regionCode });
      if (out.length >= limit) return out;
    }
    for (const [shippedName, region] of this.cityData()[code] ?? []) {
      if (opts.region && region !== opts.region) continue;
      const name = renamed.get(`${region}|${shippedName}`) ?? shippedName;
      if (!matches(name)) continue;
      out.push({ name, region: region || null });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Public holidays on the country's (and, where the data has them, the state's) calendar, from the open date-holidays
   * data (ADR 0089). Only days the data marks as public holidays: bank and optional observances are left out. A
   * country the data does not cover returns an empty list, and the card says holidays are not checked.
   */
  holidays(country: string, state: string | null, from: string, days: number): { covered: boolean; holidays: PublicHoliday[] } {
    const code = this.country(country);
    const hd = new Holidays();
    if (!hd.getCountries()[code]) return { covered: false, holidays: [] };
    let region: string | undefined;
    if (state) {
      const wanted = foldName(state);
      const subs = hd.getStates(code) ?? {};
      const fromList = this.regions(code).find((r) => foldName(r.name) === wanted || r.code.toUpperCase() === state.trim().toUpperCase());
      region = Object.keys(subs).find((k) => k === fromList?.code.toUpperCase() || k === state.trim().toUpperCase() || foldName(subs[k] ?? '') === wanted);
    }
    const cal = new Holidays(code, region ?? '', { types: ['public'] });
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(start.getTime() + days * 86_400_000);
    const out = new Map<string, PublicHoliday>();
    for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
      for (const h of cal.getHolidays(year) || []) {
        if (h.type !== 'public') continue;
        const date = h.date.slice(0, 10);
        if (date < from || date >= end.toISOString().slice(0, 10) || out.has(date)) continue;
        out.set(date, { date, name: h.name });
      }
    }
    return { covered: true, holidays: [...out.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  private country(code: string): string {
    const c = geoCountry(code);
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country.' });
    return c.code;
  }
}
