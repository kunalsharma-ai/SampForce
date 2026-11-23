import type { TenantTx } from '@dealflow/database';
import type { MobileNotificationType } from '@dealflow/types';

export interface PushDraft {
  type: MobileNotificationType;
  title: string;
  body?: string | null;
  /** Where a tap opens the app; null opens the notifications screen. */
  route?: string | null;
}

/**
 * Queues a phone notification for each person who has a phone with notifications allowed (ADR 0072, M8). It is written
 * in the caller's transaction, so it goes out only if the change it is about is saved. Whether the person's Mobile
 * Configuration sends this type is checked when it is sent, so a configuration published in between is followed.
 * People without such a phone cost one small read and nothing is stored.
 */
export async function queueMobilePush(tx: TenantTx, tenantId: string, userIds: (string | null | undefined)[], draft: PushDraft): Promise<number> {
  const users = [...new Set(userIds.filter((u): u is string => !!u))];
  if (!users.length) return 0;
  const devices = await tx.mobileDevice.findMany({ where: { tenantId, userId: { in: users }, signedOutAt: null, pushToken: { not: null } }, select: { userId: true } });
  const to = [...new Set(devices.map((d) => d.userId))];
  if (!to.length) return 0;
  await tx.mobilePush.createMany({
    data: to.map((userId) => ({ tenantId, userId, type: draft.type, title: draft.title.slice(0, 200), body: draft.body?.slice(0, 500) ?? null, route: draft.route ?? null })),
  });
  return to.length;
}
