/**
 * Lists and manages operator (super admin) accounts. Create one with create-operator first.
 *
 *   node dist/cli/operators.js list
 *   node dist/cli/operators.js disable ops@example.com
 *   node dist/cli/operators.js enable ops@example.com
 *   node dist/cli/operators.js role ops@example.com SUPPORT
 *
 * From a source checkout: pnpm --filter @dealflow/api operator:manage <command> [...]
 */
import { PrismaClient } from '@dealflow/database';
import { listOperators, OperatorAccountError, type OperatorRow, setOperatorRole, setOperatorStatus } from '../operator/operator-accounts';

const USAGE = 'usage: operators <list | disable <email> | enable <email> | role <email> ADMIN|SUPPORT>';

function show(op: OperatorRow): string {
  const last = op.lastLoginAt ? op.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : 'never';
  return `${op.email.padEnd(36)} ${op.role.padEnd(8)} ${op.status.padEnd(9)} last sign-in ${last}  ${op.name}`;
}

async function main(argv: string[]): Promise<void> {
  const [command, email, role] = argv;
  const prisma = new PrismaClient();
  try {
    if (command === 'list') {
      const rows = await listOperators(prisma);
      if (!rows.length) console.warn('No operator accounts yet. Create one with create-operator.');
      for (const row of rows) console.warn(show(row));
      return;
    }
    if ((command === 'disable' || command === 'enable') && email) {
      console.warn(show(await setOperatorStatus(prisma, email, command === 'enable')));
      return;
    }
    if (command === 'role' && email && (role === 'ADMIN' || role === 'SUPPORT')) {
      console.warn(show(await setOperatorRole(prisma, email, role)));
      return;
    }
    throw new OperatorAccountError(USAGE);
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
