import type { TenantTx } from '@dealflow/database';
import { ForbiddenException } from '@nestjs/common';
import { levelOf } from '../workspaces/access';

/**
 * Who may chat with whom across the workspace hierarchy (ADR 0071 part 5). Checked on the server whenever a direct
 * conversation is opened, people are put into a channel, or a direct message is sent:
 *
 * - People in the same workspace always may.
 * - The Super Workspace reaches everyone in the organisation, and everyone reaches it.
 * - A manager and the executives of its own team may.
 * - Two managers only when the Super Workspace allows both (canChatWithPeers).
 * - Two executives only of the same team, and only when their parent allows both.
 *
 * A channel takes its members from whoever adds them: the person adding must be allowed to reach each of them.
 */

interface Seat {
  nodeId: string | null;
  level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
  parentId: string | null;
  peers: boolean;
}

export class ChatReach {
  private constructor(private readonly seats: Map<string, Seat>) {}

  static async load(tx: TenantTx, tenantId: string): Promise<ChatReach> {
    const [nodes, members] = await Promise.all([
      tx.workspaceNode.findMany({ where: { tenantId }, select: { id: true, level: true, parentId: true, canChatWithPeers: true, archivedAt: true } }),
      tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true, workspaceNodeId: true } }),
    ]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const root = nodes.find((n) => levelOf(n.level) === 'SUPER' && !n.parentId);
    const seats = new Map<string, Seat>();
    for (const m of members) {
      const node = m.workspaceNodeId ? byId.get(m.workspaceNodeId) : undefined;
      if (!node || node.id === root?.id || levelOf(node.level) === 'SUPER') {
        seats.set(m.userId, { nodeId: null, level: 'SUPER', parentId: null, peers: true });
        continue;
      }
      const parent = node.parentId && node.parentId !== root?.id ? node.parentId : null;
      seats.set(m.userId, { nodeId: node.id, level: levelOf(node.level) as Seat['level'], parentId: parent, peers: node.canChatWithPeers && !node.archivedAt });
    }
    return new ChatReach(seats);
  }

  /** Whether two people of the organisation may talk. Someone without an active membership reaches nobody. */
  canTalk(a: string, b: string): boolean {
    if (a === b) return true;
    const x = this.seats.get(a);
    const y = this.seats.get(b);
    if (!x || !y) return false;
    if (x.level === 'SUPER' || y.level === 'SUPER') return true;
    if (x.nodeId === y.nodeId) return true;
    // A manager and an executive of its own team.
    if (x.level === 'MANAGER' && y.level === 'EXECUTIVE') return y.parentId === x.nodeId;
    if (y.level === 'MANAGER' && x.level === 'EXECUTIVE') return x.parentId === y.nodeId;
    if (!x.peers || !y.peers) return false;
    if (x.level === 'MANAGER' && y.level === 'MANAGER') return true;
    // Executives: of the same team (the same manager, or both straight under the Super Workspace).
    return x.level === 'EXECUTIVE' && y.level === 'EXECUTIVE' && x.parentId === y.parentId;
  }

  /** The people `userId` may reach, out of `candidates`. */
  reachable(userId: string, candidates: readonly string[]): string[] {
    return candidates.filter((c) => this.canTalk(userId, c));
  }

  /** Whether the person works in the Super Workspace. */
  isSuper(userId: string): boolean {
    return this.seats.get(userId)?.level === 'SUPER';
  }

  assert(from: string, to: readonly string[]): void {
    const blocked = to.filter((t) => !this.canTalk(from, t));
    if (blocked.length) throw chatNotAllowed();
  }
}

export function chatNotAllowed(): ForbiddenException {
  return new ForbiddenException({ code: 'CHAT_NOT_ALLOWED', message: 'Your workspace may not chat with this person.' });
}
