'use client';

/**
 * The chat outbox (ADR 0061): messages written while this browser cannot reach the SampForce server wait here, in
 * IndexedDB on this device, files included, and are sent in order when the connection returns. Each message has a
 * `clientId` chosen when it was written, so sending it twice (a retry after a dropped reply) stores it once.
 *
 * Where IndexedDB is not available (some private windows), the outbox lives in memory: queued messages survive a
 * lost connection but not a closed tab.
 */

export interface OutboxFile {
  name: string;
  type: string;
  blob: Blob;
  /** Set once the file has been uploaded, so a retry does not upload it again. */
  attachmentId?: string;
}

export interface OutboxItem {
  clientId: string;
  /** Whose outbox: `user:<tenantId>:<userId>` or `operator:<operatorId>`. */
  owner: string;
  conversationId: string;
  body: string;
  link: { type: 'COMPANY' | 'RFQ' | 'DEAL'; id: string; label: string } | null;
  files: OutboxFile[];
  writtenAt: string;
  status: 'queued' | 'sending' | 'failed';
  /** Why the server refused it (status failed). */
  error?: string;
}

const DB = 'sampforce-chat';
const STORE = 'outbox';
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, OutboxItem>();

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clientId' }).createIndex('owner', 'owner');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function outboxList(owner: string): Promise<OutboxItem[]> {
  const db = await open();
  let rows: OutboxItem[];
  if (!db) rows = [...memory.values()].filter((i) => i.owner === owner);
  else {
    try {
      rows = await tx<OutboxItem[]>(db, 'readonly', (s) => s.index('owner').getAll(owner));
    } catch {
      rows = [...memory.values()].filter((i) => i.owner === owner);
    }
  }
  return rows.sort((a, b) => a.writtenAt.localeCompare(b.writtenAt));
}

export async function outboxPut(item: OutboxItem): Promise<void> {
  const db = await open();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => s.put(item));
      return;
    } catch {
      // Storage full or refused: keep it in memory instead.
    }
  }
  memory.set(item.clientId, item);
}

export async function outboxRemove(clientId: string): Promise<void> {
  memory.delete(clientId);
  const db = await open();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.delete(clientId));
  } catch {
    // Already gone.
  }
}
