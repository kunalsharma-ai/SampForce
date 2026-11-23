import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { languageCodeSchema, type LanguageCode, type MobileNotificationType, type MobilePushStatus } from '@dealflow/types';
import type { AuthContext } from '../../common/auth-context';
import { API_ENV, type ApiEnv } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { localizeNotification } from '../../common/request-language';
import { claimDue, errorMessage } from '../../worker/queue';
import { mobileBlockReason } from '../mobile-gate';
import { MobileConfigService } from '../mobile-config.service';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
/** Expo takes up to 100 messages a request. */
const CHUNK = 100;

interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  sound: 'default';
  priority: 'high';
  channelId: 'default';
  data: { route: string | null; type: MobileNotificationType; pushId: string };
}

type ExpoTicket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

/**
 * Sends queued phone notifications through Expo's push service (ADR 0072, M8), which passes them on to Apple (APNs) and
 * Google (FCM) with the credentials kept in the Expo project. Each one is checked again when it goes: the organisation's
 * mobile access must be live, the person still an active member, and their level's Mobile Configuration must send
 * this type. A phone whose token Apple or Google no longer accept is forgotten.
 */
@Injectable()
export class MobilePushService {
  private readonly log = new Logger(MobilePushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: MobileConfigService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Whether this phone gets notifications: the configuration sends some to the person, and the phone has a token. */
  status(auth: AuthContext): Promise<MobilePushStatus> {
    return this.prisma.run(auth, async (tx) => {
      const config = await this.configs.resolvedFor(tx, auth);
      const device = auth.deviceId ? await tx.mobileDevice.findFirst({ where: { tenantId: auth.tenantId, id: auth.deviceId }, select: { pushToken: true } }) : null;
      return { enabled: config.notifications.enabled && config.notifications.types.length > 0, registered: !!device?.pushToken };
    });
  }

  /** Stores the phone's push token. The same token on another person's phone row (a shared phone) is let go. */
  async register(auth: AuthContext, token: string): Promise<MobilePushStatus> {
    if (!auth.deviceId) throw new BadRequestException({ code: 'NOT_A_PHONE', message: 'Only the SampForce app can turn on notifications.' });
    const deviceId = auth.deviceId;
    await this.prisma.run(auth, async (tx) => {
      await tx.mobileDevice.updateMany({ where: { tenantId: auth.tenantId, pushToken: token, id: { not: deviceId } }, data: { pushToken: null } });
      await tx.mobileDevice.updateMany({ where: { tenantId: auth.tenantId, id: deviceId, userId: auth.userId }, data: { pushToken: token } });
    });
    return this.status(auth);
  }

  /** Forgets the phone's push token: no more notifications to it until the person turns them on again. */
  async unregister(auth: AuthContext): Promise<MobilePushStatus> {
    if (auth.deviceId) await this.prisma.run(auth, (tx) => tx.mobileDevice.updateMany({ where: { tenantId: auth.tenantId, id: auth.deviceId, userId: auth.userId }, data: { pushToken: null } }));
    return this.status(auth);
  }

  async sendDue(limit = 50, now = new Date()): Promise<number> {
    const due = await claimDue<{ id: string; tenantId: string }>(this.prisma.mobilePush, {
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      lease: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
      select: { tenantId: true },
      orderBy: { nextAttemptAt: 'asc' },
      limit,
    });
    let sent = 0;
    for (const d of due) {
      try {
        if (await this.send(d.id, d.tenantId)) sent++;
      } catch (err) {
        this.log.error({ pushId: d.id, err: errorMessage(err) }, 'push crashed');
      }
    }
    return sent;
  }

  /** Sends one queued notification. Returns true when it went to at least one phone. */
  private async send(id: string, tenantId: string): Promise<boolean> {
    const ctx = { tenantId };
    const prepared = await this.prisma.run(ctx, async (tx) => {
      const p = await tx.mobilePush.findFirst({ where: { id, tenantId, status: 'PENDING' } });
      if (!p) return null;
      const skip = async (why: string) => {
        await tx.mobilePush.update({ where: { id }, data: { status: 'SKIPPED', lastError: why } });
        return null;
      };
      if (await mobileBlockReason(tx, tenantId)) return skip('Mobile access is not live for this organisation.');
      const m = await tx.membership.findFirst({
        where: { tenantId, userId: p.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        select: { workspaceNodeId: true, role: { select: { permissions: true } } },
      });
      if (!m) return skip('The person is no longer an active member.');
      const config = await this.configs.resolvedFor(tx, { tenantId, workspaceNodeId: m.workspaceNodeId ?? null, permissions: m.role.permissions });
      const type = p.type as MobileNotificationType;
      if (!config.notifications.types.includes(type)) return skip('This notification is switched off in the Mobile Configuration.');
      if (type === 'chat_message' && !config.chat.enabled) return skip('Chat is switched off in the Mobile Configuration.');
      const devices = await tx.mobileDevice.findMany({ where: { tenantId, userId: p.userId, signedOutAt: null, pushToken: { not: null } }, select: { id: true, pushToken: true } });
      if (!devices.length) return skip('No phone with notifications allowed.');
      return { p, devices };
    });
    if (!prepared) return false;
    const { p, devices } = prepared;
    const language = await this.languageOf(p.userId);
    const messages: ExpoMessage[] = devices.map((d) => ({
      to: d.pushToken!,
      title: localizeNotification(p.title, language),
      ...(p.body ? { body: localizeNotification(p.body, language) } : {}),
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: { route: p.route, type: p.type as MobileNotificationType, pushId: p.id },
    }));

    let tickets: ExpoTicket[] = [];
    try {
      for (let i = 0; i < messages.length; i += CHUNK) tickets = tickets.concat(await this.post(messages.slice(i, i + CHUNK)));
    } catch (err) {
      const attempts = p.attempts + 1;
      await this.prisma.run(ctx, (tx) =>
        tx.mobilePush.update({
          where: { id: p.id },
          data: { attempts, lastError: errorMessage(err), ...(attempts >= MAX_ATTEMPTS ? { status: 'FAILED' } : { nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** attempts) }) },
        }),
      );
      return false;
    }

    // Tokens Apple or Google no longer accept (the app was removed, or notifications turned off): forget them.
    const gone = devices.filter((_, i) => {
      const t = tickets[i];
      return t?.status === 'error' && t.details?.error === 'DeviceNotRegistered';
    });
    const ok = tickets.filter((t) => t.status === 'ok').length;
    const firstError = tickets.find((t): t is Extract<ExpoTicket, { status: 'error' }> => t.status === 'error');
    await this.prisma.run(ctx, async (tx) => {
      if (gone.length) await tx.mobileDevice.updateMany({ where: { tenantId, id: { in: gone.map((d) => d.id) } }, data: { pushToken: null } });
      await tx.mobilePush.update({
        where: { id: p.id },
        data: { status: ok ? 'SENT' : 'FAILED', sentTo: ok, sentAt: new Date(), attempts: p.attempts + 1, lastError: firstError ? firstError.message.slice(0, 500) : null },
      });
    });
    return ok > 0;
  }

  private async post(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const res = await fetch(this.env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(this.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: { message: string }[] } | null;
    if (!res.ok || !json || !Array.isArray(json.data)) throw new Error(json?.errors?.[0]?.message ?? `Expo push service answered ${res.status}.`);
    return json.data;
  }

  private async languageOf(userId: string): Promise<LanguageCode> {
    const saved = await this.prisma.userRegionalSetting.findUnique({ where: { userId }, select: { language: true } });
    const parsed = languageCodeSchema.safeParse(saved?.language);
    return parsed.success ? parsed.data : 'en';
  }
}
