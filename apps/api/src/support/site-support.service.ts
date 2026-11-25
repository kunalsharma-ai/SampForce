import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  SITE_SUPPORT_STATUSES,
  type SiteSupportList,
  type SiteSupportReceipt,
  type SiteSupportRow,
  type SiteSupportStatus,
  type SiteSupportTopic,
  type operatorSiteSupportQuerySchema,
  type siteSupportRequestSchema,
} from '@dealflow/types';
import type { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { notFound } from '../crm/crm-helpers';
import { requestLanguage } from '../common/request-language';
import type { OperatorContext } from '../operator/operator-auth';
import { writePlatformAudit } from '../operator/platform-audit';

/** No 0/O or 1/I, so a reference read out over the phone is unambiguous. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newReference(): string {
  let s = 'SF-';
  for (let i = 0; i < 6; i++) s += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return s;
}

const LIST_MAX = 200;

/**
 * Help & Support on the public website (ADR 0078). A visitor who is not signed in sends a message; the Console
 * reads it under Support tickets > Website messages and marks it handled once someone has replied by email.
 * The collection is global: it belongs to no workspace and holds only what the visitor typed.
 */
@Injectable()
export class SiteSupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: z.output<typeof siteSupportRequestSchema>): Promise<SiteSupportReceipt> {
    const reference = newReference();
    // A filled honeypot is a bot. It gets the same answer as a person, so it learns nothing, but nothing is stored.
    if (input.website?.trim()) return { reference };
    await this.prisma.siteSupportRequest.create({
      data: {
        reference,
        name: input.name,
        email: input.email,
        topic: input.topic,
        message: input.message,
        pagePath: input.pagePath ?? null,
        language: requestLanguage(),
      },
    });
    return { reference };
  }

  async list(q: z.output<typeof operatorSiteSupportQuerySchema>): Promise<SiteSupportList> {
    const search = q.q?.trim();
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { message: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, groups] = await Promise.all([
      this.prisma.siteSupportRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: LIST_MAX }),
      this.prisma.siteSupportRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const handlerIds = [...new Set(rows.map((r) => r.handledByOperatorId).filter((x): x is string => !!x))];
    const handlers = handlerIds.length
      ? await this.prisma.platformOperator.findMany({ where: { id: { in: handlerIds } }, select: { id: true, name: true } })
      : [];
    const names = new Map(handlers.map((h) => [h.id, h.name]));
    const counts = Object.fromEntries(SITE_SUPPORT_STATUSES.map((s) => [s, 0])) as Record<SiteSupportStatus, number>;
    for (const g of groups) if ((SITE_SUPPORT_STATUSES as readonly string[]).includes(g.status)) counts[g.status as SiteSupportStatus] = g._count._all;
    return { rows: rows.map((r) => toRow(r, names)), counts };
  }

  async setStatus(op: OperatorContext, id: string, status: SiteSupportStatus, ip: string | null): Promise<SiteSupportRow> {
    const found = await this.prisma.siteSupportRequest.findUnique({ where: { id } });
    if (!found) throw notFound('Website message');
    const handled = status === 'HANDLED';
    const row = await this.prisma.siteSupportRequest.update({
      where: { id },
      data: { status, handledAt: handled ? new Date() : null, handledByOperatorId: handled ? op.id : null },
    });
    if (found.status !== status) {
      await writePlatformAudit(this.prisma, {
        operatorId: op.id,
        action: handled ? 'site_support.handled' : 'site_support.reopened',
        target: { type: 'site_support_request', id, label: found.reference },
        before: { status: found.status },
        after: { status },
        ip,
      });
    }
    return toRow(row, new Map([[op.id, op.name]]));
  }
}

type Row = {
  id: string;
  reference: string;
  name: string;
  email: string;
  topic: string;
  message: string;
  pagePath: string | null;
  language: string | null;
  status: string;
  handledAt: Date | null;
  handledByOperatorId: string | null;
  createdAt: Date;
};

function toRow(r: Row, names: Map<string, string>): SiteSupportRow {
  return {
    id: r.id,
    reference: r.reference,
    name: r.name,
    email: r.email,
    topic: r.topic as SiteSupportTopic,
    message: r.message,
    pagePath: r.pagePath,
    language: r.language,
    status: r.status as SiteSupportStatus,
    handledAt: r.handledAt?.toISOString() ?? null,
    handledByName: r.handledByOperatorId ? (names.get(r.handledByOperatorId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  };
}
