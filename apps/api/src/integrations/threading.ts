import { randomUUID } from 'node:crypto';
import { Prisma, RetryableDuplicateError, type TenantTx } from '@dealflow/database';

type NewEmail = Omit<Prisma.EmailMessageUncheckedCreateInput, 'id' | 'conversationId'>;

const isDuplicate = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Stores one email and files it in its inbox conversation (was the email_messages_join_thread trigger). A message
 * already stored for the same mailbox and provider id is skipped, so a re-sync never counts twice. The conversation is
 * the provider thread, or the message on its own when the provider gives no thread. A newer inbound message reopens
 * the conversation; a newer outbound one moves an open conversation to waiting on the customer.
 *
 * Two transactions filing into the same new conversation collide on its unique key; the loser is retried by
 * withDbContext and then finds the conversation.
 */
export async function storeEmail<I extends Prisma.EmailMessageInclude | undefined = undefined>(
  tx: TenantTx,
  data: NewEmail,
  include?: I,
): Promise<Prisma.EmailMessageGetPayload<{ include: I }> | null> {
  const exists = await tx.emailMessage.findUnique({ where: { connectionId_providerMessageId: { connectionId: data.connectionId, providerMessageId: data.providerMessageId } }, select: { id: true } });
  if (exists) return null;
  const id = randomUUID();
  const threadKey = data.threadId ?? `msg:${id}`;
  const at = new Date(data.sentAt);
  const direction = String(data.direction);
  const existing = await tx.emailThread.findUnique({ where: { connectionId_threadKey: { connectionId: data.connectionId, threadKey } } });
  let conversationId: string;
  try {
    if (!existing) {
      const t = await tx.emailThread.create({
        data: {
          tenantId: data.tenantId, connectionId: data.connectionId, threadKey, subject: data.subject.slice(0, 500), contactId: data.contactId ?? null, leadId: data.leadId ?? null,
          messageCount: 1, lastMessageAt: at, lastDirection: direction, status: direction === 'INBOUND' ? 'OPEN' : 'WAITING',
        },
        select: { id: true },
      });
      conversationId = t.id;
    } else {
      const newer = at >= existing.lastMessageAt;
      const status = newer && direction === 'INBOUND' ? 'OPEN' : newer && direction === 'OUTBOUND' && existing.status === 'OPEN' ? 'WAITING' : existing.status;
      await tx.emailThread.update({
        where: { id: existing.id },
        data: {
          messageCount: { increment: 1 },
          contactId: existing.contactId ?? data.contactId ?? null,
          leadId: existing.leadId ?? data.leadId ?? null,
          lastDirection: newer ? direction : existing.lastDirection,
          lastMessageAt: newer ? at : existing.lastMessageAt,
          status,
        },
      });
      conversationId = existing.id;
    }
    return (await tx.emailMessage.create({ data: { ...data, id, conversationId }, ...(include ? { include } : {}) })) as Prisma.EmailMessageGetPayload<{ include: I }>;
  } catch (err) {
    if (isDuplicate(err)) throw new RetryableDuplicateError();
    throw err;
  }
}
