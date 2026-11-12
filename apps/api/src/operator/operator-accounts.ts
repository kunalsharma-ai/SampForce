import type { PrismaClient } from '@dealflow/database';

/**
 * Managing operator (super admin) accounts from the command line: list them, disable or re-enable
 * one, change a role. The operator guard re-reads the account on every request, so a disabled or
 * demoted operator loses access at once, even with a session cookie still in the browser.
 *
 * The deployment must always keep one active ADMIN, so these refuse to disable or demote the last one.
 */
export type OperatorRole = 'ADMIN' | 'SUPPORT';

export interface OperatorRow {
  email: string;
  name: string;
  role: OperatorRole;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: Date | null;
  createdAt: Date;
}

export class OperatorAccountError extends Error {}

type Db = Pick<PrismaClient, 'platformOperator' | 'platformAuditLog'>;

export async function listOperators(db: Db): Promise<OperatorRow[]> {
  return db.platformOperator.findMany({
    select: { email: true, name: true, role: true, status: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
}

async function find(db: Db, email: string) {
  const op = await db.platformOperator.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!op) throw new OperatorAccountError(`No operator account for ${email}.`);
  return op;
}

async function otherActiveAdmins(db: Db, id: string): Promise<number> {
  return db.platformOperator.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } } });
}

export async function setOperatorStatus(db: Db, email: string, active: boolean): Promise<OperatorRow> {
  const op = await find(db, email);
  const status = active ? 'ACTIVE' : 'DISABLED';
  if (!active && op.role === 'ADMIN' && op.status === 'ACTIVE' && (await otherActiveAdmins(db, op.id)) === 0) {
    throw new OperatorAccountError(`${op.email} is the last active ADMIN. Create or enable another ADMIN first.`);
  }
  const updated = await db.platformOperator.update({ where: { id: op.id }, data: { status } });
  await db.platformAuditLog.create({ data: { operatorId: op.id, action: active ? 'operator.enabled' : 'operator.disabled', metadata: { via: 'cli' } } });
  return updated;
}

export async function setOperatorRole(db: Db, email: string, role: OperatorRole): Promise<OperatorRow> {
  const op = await find(db, email);
  if (role === 'SUPPORT' && op.role === 'ADMIN' && op.status === 'ACTIVE' && (await otherActiveAdmins(db, op.id)) === 0) {
    throw new OperatorAccountError(`${op.email} is the last active ADMIN. Make another operator ADMIN first.`);
  }
  const updated = await db.platformOperator.update({ where: { id: op.id }, data: { role } });
  await db.platformAuditLog.create({ data: { operatorId: op.id, action: 'operator.role_changed', metadata: { via: 'cli', from: op.role, to: role } } });
  return updated;
}
