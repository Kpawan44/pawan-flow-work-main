/**
 * Coordination for authoritative movement writes.
 *
 * 1. In-process keyed mutex (same Cloud Run instance).
 * 2. Firestore single-document exclusive lock (cross-instance).
 *
 * Quantity checks still live in commitMaterialMovementTxInner. This module
 * only prevents two instances from running that read/check/write for the
 * same serialize key at the same time. It is not a substitute for a full
 * multi-document Firestore transaction over every movement row.
 */

export const MOVEMENT_SERIALIZE_LOCK_COLLECTION = "mfr_serialize_locks";

const DEFAULT_TTL_MS = 20_000;
const MAX_ACQUIRE_ATTEMPTS = 50;

const chains = new Map<string, Promise<unknown>>();

export function createKeyedSerializer(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const local = new Map<string, Promise<unknown>>();
  return function runLocalKeyedSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = String(key || "movement").toUpperCase();
    const prev = local.get(k) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    local.set(
      k,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  };
}

export function runKeyedSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = String(key || "movement").toUpperCase();
  const prev = chains.get(k) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(
    k,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export function serializeLockDocId(key: string): string {
  const raw = String(key || "movement").toUpperCase();
  return raw.replace(/[^A-Z0-9:_-]/g, "-").slice(0, 700) || "MOVEMENT";
}

export class SerializeLockBusyError extends Error {
  readonly retry = true;
  constructor() {
    super("serialize-lock-busy");
    this.name = "SerializeLockBusyError";
  }
}

export interface ExclusiveLockSnapshot {
  exists: boolean;
  data(): { owner?: string; expiresAtMs?: number } | undefined;
}

export interface ExclusiveLockRef {
  delete(): Promise<unknown>;
}

export interface ExclusiveLockTransaction {
  get(ref: ExclusiveLockRef): Promise<ExclusiveLockSnapshot>;
  set(ref: ExclusiveLockRef, data: Record<string, unknown>): void;
}

export interface ExclusiveLockDb {
  runTransaction<T>(update: (tx: ExclusiveLockTransaction) => Promise<T>): Promise<T>;
  collection(name: string): { doc(id: string): ExclusiveLockRef };
}

function isBusyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { retry?: boolean; message?: string; name?: string };
  return e.retry === true || e.name === "SerializeLockBusyError" || String(e.message || "").includes("serialize-lock-busy");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireExclusiveLock(
  db: ExclusiveLockDb,
  ref: ExclusiveLockRef,
  owner: string,
  ttlMs: number
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const data = snap.data() || {};
      const expiresAtMs = Number(data.expiresAtMs || 0);
      const currentOwner = String(data.owner || "");
      if (expiresAtMs > now && currentOwner !== owner) {
        throw new SerializeLockBusyError();
      }
    }
    tx.set(ref, {
      owner,
      expiresAtMs: now + ttlMs,
      updatedAtMs: now
    });
  });
}

/**
 * Hold a per-key exclusive lock, run fn, then release.
 * Falls back to in-process FIFO mutex when Firestore Admin is unavailable.
 */
export async function runWithExclusiveLock<T>(options: {
  key: string;
  fn: () => Promise<T>;
  db?: ExclusiveLockDb | null;
  ttlMs?: number;
  fallback?: <R>(key: string, fn: () => Promise<R>) => Promise<R>;
}): Promise<T> {
  const key = String(options.key || "movement");
  const fallback = options.fallback || runKeyedSerialized;
  const db = options.db;
  if (!db) {
    return fallback(key, options.fn);
  }

  const ref = db.collection(MOVEMENT_SERIALIZE_LOCK_COLLECTION).doc(serializeLockDocId(key));
  const owner = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
    try {
      await acquireExclusiveLock(db, ref, owner, ttlMs);
    } catch (err) {
      if (isBusyError(err)) {
        await sleep(15 + Math.floor(Math.random() * 40));
        continue;
      }
      throw err;
    }
    try {
      return await options.fn();
    } finally {
      await ref.delete().catch(() => undefined);
    }
  }

  throw new Error("Could not acquire movement serialize lock.");
}
