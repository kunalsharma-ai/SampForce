/**
 * Creates or resets a platform operator account. There are no default operator credentials: the
 * first operator is created from the command line by someone with database access. List, disable
 * and change the role of operators with operators.ts.
 *
 *   OPERATOR_EMAIL=ops@example.com OPERATOR_NAME="Ops" OPERATOR_PASSWORD='…' OPERATOR_ROLE=ADMIN \
 *     pnpm --filter @dealflow/api operator:create   (source checkout)
 *   docker compose run --rm api node dist/cli/create-operator.js   (production image)
 */
import { PrismaClient } from '@dealflow/database';
import { emailSchema, passwordSchema } from '@dealflow/types';
import { PasswordService } from '../auth/password.service';

async function main(): Promise<void> {
  const email = emailSchema.parse(process.env.OPERATOR_EMAIL);
  const password = passwordSchema.parse(process.env.OPERATOR_PASSWORD);
  const name = (process.env.OPERATOR_NAME ?? '').trim() || email;
  const role = process.env.OPERATOR_ROLE === 'ADMIN' ? 'ADMIN' : 'SUPPORT';
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.platformOperator.findUnique({ where: { email } });
    if (existing?.role === 'ADMIN' && existing.status === 'ACTIVE' && role !== 'ADMIN') {
      const others = await prisma.platformOperator.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: existing.id } } });
      if (others === 0) throw new Error(`${email} is the last active ADMIN; set OPERATOR_ROLE=ADMIN to reset its password.`);
    }
    const passwordHash = await new PasswordService().hash(password);
    const op = await prisma.platformOperator.upsert({ where: { email }, create: { email, name, passwordHash, role }, update: { name, passwordHash, role, status: 'ACTIVE' } });
    await prisma.platformAuditLog.create({ data: { operatorId: op.id, action: 'operator.provisioned', metadata: { role, via: 'cli' } } });
    console.warn(`Operator ${email} (${role}) is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
