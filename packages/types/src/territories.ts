import { z } from 'zod';
import type { DealRow, OwnerRef } from './crm';

/** ISO 3166-1 alpha-2, upper case, as companies store their country. */
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use two-letter country codes such as DE or IN');

/**
 * A sales territory: a named set of countries with an optional manager. A deal belongs to the territory that holds
 * its company's country. A country can be in one territory only.
 */
export const territoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => v || null),
  managerId: z.string().uuid().nullable().optional(),
  countries: z
    .array(countryCode)
    .max(250)
    .default([])
    .refine((c) => new Set(c).size === c.length, 'Each country can be listed once'),
});
export type TerritoryInput = z.infer<typeof territoryInputSchema>;
export const territoryUpdateSchema = territoryInputSchema.partial();

export interface TerritoryRow {
  id: string;
  name: string;
  description: string | null;
  manager: OwnerRef | null;
  countries: string[];
  createdAt: string;
  updatedAt: string;
}

/** Open pipeline and closed results for one territory (or for the deals no territory covers). */
export interface TerritorySummary {
  territory: TerritoryRow | null;
  openCount: number;
  /** Open value and weighted value, in the workspace currency only. */
  openValue: number;
  weightedValue: number;
  /** Open deals in other currencies, counted but not added to the values. */
  otherCurrencyCount: number;
  overdueCount: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  /** Who owns the open deals, most deals first. */
  owners: { owner: OwnerRef | null; count: number }[];
  /** The largest open deals, up to ten. */
  deals: DealRow[];
}

export interface TerritoryView {
  currency: string;
  /** Won and lost counts cover deals closed on or after this date (start of the current quarter, UTC). */
  closedSince: string;
  territories: TerritorySummary[];
  /** Open deals no territory covers, and why. */
  unassigned: TerritorySummary & { noCompany: number; noCountry: number; uncoveredCountries: { country: string; count: number }[] };
}
