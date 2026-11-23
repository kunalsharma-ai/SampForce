import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import {
  type ConsoleCityAddInput,
  type ConsoleCityRenameInput,
  type ConsoleCityRow,
  type ConsoleClientDetail,
  type ConsoleClientProfileInput,
  geoCountry,
} from '@dealflow/types';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';
import { sniffImage } from '../crm/company-logo-finder';
import { foldPlace, GeoService } from '../geo/geo.service';
import { ConsoleService, PROFILE_FIELDS, profileOf } from './console.service';
import type { OperatorContext } from './operator-auth';
import { changedFields, writePlatformAudit } from './platform-audit';

export const LOGO_MAX_BYTES = 2_000_000;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const NOT_FOUND = { code: 'NOT_FOUND', message: 'Client organisation not found.' };

/** Reads a raw image upload (the image is the request body), refusing anything over 2 MB as it streams in. */
export async function readLogoUpload(req: Request): Promise<Buffer> {
  const tooBig = () => new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'Logos can be up to 2 MB.' });
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) throw tooBig();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > LOGO_MAX_BYTES) throw tooBig();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * The client profile in the Console (ADR 0074, C4): company details, the logo, and the city list behind the location
 * pickers. Every change is one platform audit entry with the values before and after.
 */
@Injectable()
export class ConsoleClientsProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly console: ConsoleService,
    private readonly geo: GeoService,
  ) {}

  private async tenant(id: string) {
    const t = await this.prisma.run({ tenantId: id }, (tx) => tx.tenant.findFirst({ where: { id, deletedAt: null } }));
    if (!t) throw new NotFoundException(NOT_FOUND);
    return t;
  }

  async updateProfile(op: OperatorContext, id: string, input: ConsoleClientProfileInput, ip: string | null): Promise<ConsoleClientDetail> {
    const t = await this.tenant(id);
    if (input.countryCode && !geoCountry(input.countryCode)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a country from the list.' });
    if (input.countryCode && input.regionCode) this.region(input.countryCode, input.regionCode);
    // A region belongs to its country; changing the country without a region clears the old one.
    const next = { ...input, regionCode: input.countryCode ? input.regionCode : null };
    const before = { name: t.name, ...profileOf(t) };
    const after = { name: next.name, ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, next[f] ?? null])) };
    const diff = changedFields(before, after);
    const changed = Object.keys(diff.after);
    if (changed.length) await this.prisma.run({ tenantId: id }, (tx) => tx.tenant.update({ where: { id }, data: after }));
    await writePlatformAudit(this.prisma, {
      operatorId: op.id,
      action: 'client.profile_updated',
      tenantId: id,
      target: { type: 'client', id, label: next.name },
      before: diff.before,
      after: diff.after,
      metadata: { changes: changed },
      ip,
    });
    return this.console.client(null, id, ip);
  }

  async setLogo(op: OperatorContext, id: string, data: Buffer, ip: string | null): Promise<ConsoleClientDetail> {
    const t = await this.tenant(id);
    const img = data.length ? sniffImage(data) : null;
    if (!img || !LOGO_TYPES.has(img.contentType)) throw new BadRequestException({ code: 'LOGO_INVALID', message: 'Use a PNG, JPEG or WebP image.' });
    if (img.width !== null && (img.width < 32 || img.width > 4096)) throw new BadRequestException({ code: 'LOGO_INVALID', message: 'Use an image between 32 and 4096 pixels wide.' });
    const had = await this.prisma.clientLogo.findUnique({ where: { clientId: id }, select: { sizeBytes: true } });
    const bytes = new Uint8Array(data);
    await this.prisma.clientLogo.upsert({
      where: { clientId: id },
      create: { clientId: id, contentType: img.contentType, data: bytes, sizeBytes: data.length },
      update: { contentType: img.contentType, data: bytes, sizeBytes: data.length },
    });
    await writePlatformAudit(this.prisma, {
      operatorId: op.id,
      action: 'client.logo_set',
      tenantId: id,
      target: { type: 'client', id, label: t.name },
      before: { logo: had ? `${had.sizeBytes} bytes` : null },
      after: { logo: `${img.contentType}, ${data.length} bytes` },
      ip,
    });
    return this.console.client(null, id, ip);
  }

  async removeLogo(op: OperatorContext, id: string, ip: string | null): Promise<ConsoleClientDetail> {
    const t = await this.tenant(id);
    const { count } = await this.prisma.clientLogo.deleteMany({ where: { clientId: id } });
    await writePlatformAudit(this.prisma, { operatorId: op.id, action: 'client.logo_removed', tenantId: id, target: { type: 'client', id, label: t.name }, metadata: { removed: count > 0 }, ip });
    return this.console.client(null, id, ip);
  }

  async logo(id: string): Promise<{ contentType: string; data: Buffer }> {
    const row = await this.prisma.clientLogo.findUnique({ where: { clientId: id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This client has no logo.' });
    return { contentType: row.contentType, data: Buffer.from(row.data) };
  }

  // ───────────── Locations ─────────────

  /** Cities as the pickers show them, each with the operator change behind it, if any. */
  async cities(country: string, q: { region?: string; q?: string; limit: number }): Promise<ConsoleCityRow[]> {
    const code = this.country(country);
    const [cities, edits] = await Promise.all([this.geo.cities(code, q), this.prisma.geoCityEdit.findMany({ where: { countryCode: code } })]);
    const ops = await this.prisma.platformOperator.findMany({ where: { id: { in: [...new Set(edits.map((e) => e.operatorId))] } }, select: { id: true, name: true } });
    const who = new Map(ops.map((o) => [o.id, o.name]));
    return cities.map((c) => {
      const e = edits.find((x) => x.name === c.name && (x.regionCode ?? null) === (c.region ?? null));
      return {
        ...c,
        edit: e ? { id: e.id, kind: e.originalName === null ? 'added' : 'renamed', originalName: e.originalName, by: who.get(e.operatorId) ?? null, at: e.updatedAt.toISOString() } : null,
      };
    });
  }

  /** Every change operators made for a country, newest first (shown under the list). */
  async edits(country: string): Promise<ConsoleCityRow[]> {
    const code = this.country(country);
    const edits = await this.prisma.geoCityEdit.findMany({ where: { countryCode: code }, orderBy: { updatedAt: 'desc' }, take: 200 });
    const ops = await this.prisma.platformOperator.findMany({ where: { id: { in: [...new Set(edits.map((e) => e.operatorId))] } }, select: { id: true, name: true } });
    const who = new Map(ops.map((o) => [o.id, o.name]));
    return edits.map((e) => ({ name: e.name, region: e.regionCode, edit: { id: e.id, kind: e.originalName === null ? 'added' : 'renamed', originalName: e.originalName, by: who.get(e.operatorId) ?? null, at: e.updatedAt.toISOString() } }));
  }

  private country(code: string): string {
    const c = geoCountry(code);
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown country.' });
    return c.code;
  }

  private region(country: string, region: string | null): void {
    if (region && !this.geo.regions(country).some((r) => r.code === region)) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose a state or province from the list.' });
  }

  private label(country: string, region: string | null, name: string): string {
    const r = region ? this.geo.regions(country).find((x) => x.code === region)?.name : null;
    return [name, r, geoCountry(country)?.name].filter(Boolean).join(', ');
  }

  async addCity(op: OperatorContext, input: ConsoleCityAddInput, ip: string | null): Promise<ConsoleCityRow[]> {
    const country = this.country(input.countryCode);
    this.region(country, input.regionCode);
    const existing = await this.geo.cities(country, { region: input.regionCode ?? undefined, q: input.name, limit: 200 });
    if (existing.some((c) => foldPlace(c.name) === foldPlace(input.name) && (c.region ?? null) === input.regionCode)) {
      throw new BadRequestException({ code: 'CITY_EXISTS', message: 'That city is already in the list.' });
    }
    const row = await this.prisma.geoCityEdit.create({ data: { countryCode: country, regionCode: input.regionCode, name: input.name, originalName: null, operatorId: op.id } });
    this.geo.forgetEdits(country);
    await writePlatformAudit(this.prisma, {
      operatorId: op.id, action: 'location.city_added', target: { type: 'location', id: row.id, label: this.label(country, input.regionCode, input.name) },
      after: { country, region: input.regionCode, name: input.name }, ip,
    });
    return this.edits(country);
  }

  async renameCity(op: OperatorContext, input: ConsoleCityRenameInput, ip: string | null): Promise<ConsoleCityRow[]> {
    const country = this.country(input.countryCode);
    this.region(country, input.regionCode);
    // A city an operator added is renamed in place; a listed one gets (or updates) its rename.
    const added = await this.prisma.geoCityEdit.findFirst({ where: { countryCode: country, regionCode: input.regionCode, originalName: null, name: input.originalName } });
    const renamed = added ? null : await this.prisma.geoCityEdit.findFirst({ where: { countryCode: country, regionCode: input.regionCode, name: input.originalName, NOT: { originalName: null } } });
    const shippedName = renamed?.originalName ?? input.originalName;
    if (!added && !renamed && !this.geo.shipped(country, input.regionCode, shippedName)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That city is not in the list.' });
    const target = added ?? renamed;
    const row = target
      ? await this.prisma.geoCityEdit.update({ where: { id: target.id }, data: { name: input.name, operatorId: op.id } })
      : await this.prisma.geoCityEdit.create({ data: { countryCode: country, regionCode: input.regionCode, name: input.name, originalName: shippedName, operatorId: op.id } });
    this.geo.forgetEdits(country);
    await writePlatformAudit(this.prisma, {
      operatorId: op.id, action: 'location.city_renamed', target: { type: 'location', id: row.id, label: this.label(country, input.regionCode, input.name) },
      before: { name: input.originalName }, after: { name: input.name }, ip,
    });
    return this.edits(country);
  }

  /** Removes an added city, or puts a renamed one back to its listed name. */
  async undoCity(op: OperatorContext, id: string, ip: string | null): Promise<ConsoleCityRow[]> {
    const row = await this.prisma.geoCityEdit.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'That change was not found.' });
    await this.prisma.geoCityEdit.delete({ where: { id } });
    this.geo.forgetEdits(row.countryCode);
    await writePlatformAudit(this.prisma, {
      operatorId: op.id,
      action: row.originalName === null ? 'location.city_removed' : 'location.city_rename_undone',
      target: { type: 'location', id: row.id, label: this.label(row.countryCode, row.regionCode, row.originalName ?? row.name) },
      before: { name: row.name },
      after: row.originalName === null ? null : { name: row.originalName },
      ip,
    });
    return this.edits(row.countryCode);
  }
}
