import { OPERATIONAL_RESET_COLLECTIONS } from "./constants";

export const DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS = [
  "mfr_dispatch_store_requirements",
  "mfr_dispatch_store_issues"
] as const;

export const LIVE_FACTORY_RESET_EXTRA_COLLECTIONS = [
  "mfr_users",
  "mfr_user_credentials",
  "mfr_audit_logs",
  "mfr_deleted_users"
] as const;

function uniqueStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export function operationalCollectionsForFactoryReset(): string[] {
  return [...OPERATIONAL_RESET_COLLECTIONS];
}

/** POST /api/admin/factory-reset — extras (users/audit) plus authoritative operational collections. */
export function liveFactoryResetPurgeCollections(): string[] {
  return uniqueStrings([...LIVE_FACTORY_RESET_EXTRA_COLLECTIONS, ...OPERATIONAL_RESET_COLLECTIONS]);
}

/** POST /api/factory/delete-all — authoritative operational collections (users not purged here). */
export function liveFactoryDeleteAllPurgeCollections(): string[] {
  return uniqueStrings([...OPERATIONAL_RESET_COLLECTIONS]);
}

export function isProtectedSuperAdmin(user: { role?: string; active?: boolean } | null | undefined): boolean {
  return String(user?.role || "").toLowerCase() === "super_admin";
}

export function shouldDeleteUserOnFactoryReset(user: { role?: string } | null | undefined): boolean {
  return !isProtectedSuperAdmin(user);
}

export function shouldTombstoneUserOnFactoryReset(user: { role?: string } | null | undefined): boolean {
  return shouldDeleteUserOnFactoryReset(user);
}

export async function applyFactoryResetToStore(
  store: {
    list(collection: string): Promise<any[]>;
    delete?(collection: string, id: string): Promise<void>;
    clearCollection?(collection: string): Promise<void>;
    set(collection: string, id: string, data: any): Promise<void>;
    get(collection: string, id: string): Promise<any | null>;
  },
  nextGeneration: string
): Promise<{ preservedSuperAdmins: any[]; purgedJobs: number }> {
  const jobs = await store.list("mfr_job_cards");
  for (const col of operationalCollectionsForFactoryReset()) {
    if (store.clearCollection) {
      await store.clearCollection(col);
    } else {
      const docs = await store.list(col);
      for (const d of docs) {
        const id = d.jobCardNo || d.movementId || d.notificationId || d.transferId || d.id || d.operationId;
        if (id && store.delete) await store.delete(col, String(id));
      }
    }
  }

  const users = await store.list("mfr_users");
  const preservedSuperAdmins: any[] = [];
  for (const u of users) {
    const id = u.userId || u.id;
    if (isProtectedSuperAdmin(u)) {
      const kept = { ...u, role: "super_admin", active: true };
      if (id) await store.set("mfr_users", id, kept);
      preservedSuperAdmins.push(kept);
    } else if (id && store.delete) {
      await store.delete("mfr_users", id);
      await store.delete("mfr_user_credentials", id);
    }
  }

  await store.set("mfr_system_state", "global", {
    factoryResetGeneration: nextGeneration,
    updatedAt: new Date().toISOString(),
    firstRun: preservedSuperAdmins.length === 0
  });

  return { preservedSuperAdmins, purgedJobs: jobs.length };
}
