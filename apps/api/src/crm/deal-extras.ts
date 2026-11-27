import { aggregate, fromRawDate, type TenantTx } from '@dealflow/database';
import type { DealRow } from '@dealflow/types';

type Extras = Required<Pick<DealRow, 'rfq' | 'sampbidx' | 'lastActivityAt' | 'nextFollowUp'>>;

/**
 * What the deal cards show beyond the deal itself (ADR 0096): the last logged activity, the earliest open
 * follow-up, the linked RFQ and the latest SampBidx send. One native `$in` read each, however many deals.
 * SampBidx deal sends are transfers of kind DEAL with a deal_id (the SampBidx bulk transfer work); until that
 * column exists the read simply finds none.
 */
export async function dealExtras(tx: TenantTx, ids: string[]): Promise<Map<string, Extras>> {
  const out = new Map<string, Extras>(ids.map((id) => [id, { rfq: null, sampbidx: null, lastActivityAt: null, nextFollowUp: null }]));
  if (ids.length === 0) return out;
  const [activities, tasks, rfqs, sends] = await Promise.all([
    aggregate<{ _id: string; at: unknown }>(tx.activity, [
      { $match: { opportunity_id: { $in: ids }, deleted_at: null } },
      { $group: { _id: '$opportunity_id', at: { $max: '$occurred_at' } } },
    ]),
    aggregate<{ _id: string; task: { _id: string; title: string; due_at: unknown } }>(tx.task, [
      { $match: { opportunity_id: { $in: ids }, status: 'OPEN', deleted_at: null } },
      // Dated follow-ups first (soonest first), then undated ones.
      { $addFields: { undated: { $cond: [{ $ifNull: ['$due_at', false] }, 0, 1] } } },
      { $sort: { undated: 1, due_at: 1, created_at: 1 } },
      { $group: { _id: '$opportunity_id', task: { $first: { _id: '$_id', title: '$title', due_at: '$due_at' } } } },
    ]),
    aggregate<{ _id: string; rfq: { _id: string; number: string; project_name: string } }>(tx.rfq, [
      { $match: { opportunity_id: { $in: ids }, deleted_at: null } },
      { $sort: { received_at: -1 } },
      { $group: { _id: '$opportunity_id', rfq: { $first: { _id: '$_id', number: '$number', project_name: '$project_name' } } } },
    ]),
    aggregate<{ _id: string; t: { delivery: string; remote_status: string | null; remote_url: string | null; sent_at: unknown } }>(tx.sampbidxTransfer, [
      { $match: { kind: 'DEAL', deal_id: { $in: ids } } },
      { $sort: { created_at: -1 } },
      { $group: { _id: '$deal_id', t: { $first: { delivery: '$delivery', remote_status: '$remote_status', remote_url: '$remote_url', sent_at: '$sent_at' } } } },
    ]),
  ]);
  for (const a of activities) {
    const e = out.get(a._id);
    if (e) e.lastActivityAt = fromRawDate(a.at)?.toISOString() ?? null;
  }
  for (const t of tasks) {
    const e = out.get(t._id);
    if (e) e.nextFollowUp = { id: t.task._id, title: t.task.title, dueAt: fromRawDate(t.task.due_at)?.toISOString() ?? null };
  }
  for (const r of rfqs) {
    const e = out.get(r._id);
    if (e) e.rfq = { id: r.rfq._id, number: r.rfq.number, projectName: r.rfq.project_name };
  }
  for (const s of sends) {
    const e = out.get(s._id);
    if (e) e.sampbidx = { delivery: s.t.delivery, remoteStatus: s.t.remote_status ?? null, remoteUrl: s.t.remote_url ?? null, sentAt: fromRawDate(s.t.sent_at)?.toISOString() ?? null };
  }
  return out;
}

/** Adds the extras to deal rows, in place. */
export async function withDealExtras<T extends DealRow>(tx: TenantTx, rows: T[]): Promise<T[]> {
  const extras = await dealExtras(tx, rows.map((r) => r.id));
  for (const r of rows) Object.assign(r, extras.get(r.id));
  return rows;
}
