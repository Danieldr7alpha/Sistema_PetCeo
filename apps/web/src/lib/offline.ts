import Dexie, { type EntityTable } from "dexie";

export type OutboxStatus = "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
export type OutboxOperation = {
  id: string;
  companyId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  path: string;
  method: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: OutboxStatus;
};

type CachedResponse = { key: string; companyId: string; userId: string; path: string; value: unknown; updatedAt: string };
type SyncMetadata = { key: string; companyId: string; userId: string; lastSuccessfulSyncAt?: string };

class OfflineDatabase extends Dexie {
  cachedResponses!: EntityTable<CachedResponse, "key">;
  syncOutbox!: EntityTable<OutboxOperation, "id">;
  syncMetadata!: EntityTable<SyncMetadata, "key">;

  constructor() {
    super("ceo-pet-ai-offline");
    this.version(1).stores({
      cachedResponses: "&key, [companyId+userId], path, updatedAt",
      syncOutbox: "&id, [companyId+userId], status, createdAt",
      syncMetadata: "&key, [companyId+userId]"
    });
  }
}

export const offlineDb = new OfflineDatabase();
const scopeKey = (companyId: string, userId: string, path: string) => `${companyId}:${userId}:${path}`;

export async function cacheResponse(companyId: string, userId: string, path: string, value: unknown) {
  await offlineDb.cachedResponses.put({ key: scopeKey(companyId, userId, path), companyId, userId, path, value, updatedAt: new Date().toISOString() });
  await offlineDb.syncMetadata.put({ key: `${companyId}:${userId}`, companyId, userId, lastSuccessfulSyncAt: new Date().toISOString() });
}

export async function readCachedResponse<T>(companyId: string, userId: string, path: string) {
  return (await offlineDb.cachedResponses.get(scopeKey(companyId, userId, path)))?.value as T | undefined;
}

export async function invalidateCachedResponses(companyId: string, userId: string) {
  const keys = await offlineDb.cachedResponses.where("[companyId+userId]").equals([companyId, userId]).primaryKeys();
  await offlineDb.cachedResponses.bulkDelete(keys);
}

export async function queueOperation(input: Omit<OutboxOperation, "id" | "createdAt" | "updatedAt" | "attempts" | "status">) {
  const now = new Date().toISOString();
  const operation: OutboxOperation = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now, attempts: 0, status: "PENDING" };
  await offlineDb.syncOutbox.add(operation);
  window.dispatchEvent(new Event("ceo-pet-sync-changed"));
  return operation;
}

export async function pendingOperations(companyId: string, userId: string) {
  return offlineDb.syncOutbox.where("[companyId+userId]").equals([companyId, userId])
    .filter((item) => ["PENDING", "FAILED", "CONFLICT"].includes(item.status)).toArray();
}
