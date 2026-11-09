import { transactionLock } from '@dealflow/database';
import type { SecretBox } from '../common/crypto';
import type { PrismaService } from '../common/prisma.service';
import { AppError } from './apps.service';

export interface RefreshableCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Refreshes a workspace app's OAuth token under a row lock. Providers that rotate refresh tokens (Zoom, DocuSign)
 * invalidate the old one, so two refreshes at once would lock the workspace out. A refusal the provider marks as
 * final (`revoked`) is saved on the connection, so the Integrations page shows Needs reconnecting.
 */
export async function refreshUnderLock<C extends RefreshableCreds>(
  prisma: PrismaService,
  box: SecretBox,
  tenantId: string,
  connectionId: string,
  refresher: (refreshToken: string) => Promise<RefreshableCreds>,
  isRevoked: (e: unknown) => e is Error,
  staleAccessToken?: string,
): Promise<C> {
  const out = await prisma.run({ tenantId }, async (tx): Promise<C | { revoked: string }> => {
    await transactionLock(tx, `app_connection:${connectionId}`);
    const row = await tx.appConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const current = JSON.parse(box.open(row.credentialsEncrypted)) as C;
    // Another request refreshed while this one waited for the lock.
    if (current.expiresAt - 60_000 > Date.now() && current.accessToken !== staleAccessToken) return current;
    try {
      const t = await refresher(current.refreshToken);
      const next = { ...current, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt };
      await tx.appConnection.update({ where: { id: connectionId }, data: { credentialsEncrypted: box.seal(JSON.stringify(next)), status: 'CONNECTED', lastError: null } });
      return next;
    } catch (e) {
      if (!isRevoked(e)) throw e;
      // Saved (the transaction commits), then reported to the caller below.
      await tx.appConnection.update({ where: { id: connectionId }, data: { status: 'ERROR', lastError: e.message } });
      return { revoked: e.message };
    }
  });
  if ('revoked' in out) throw new AppError(out.revoked);
  return out;
}
