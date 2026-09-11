/** Client restore must never rewrite the manufacturing ledger. */

export const LEDGER_RESTORE_BLOCKED_COLLECTIONS = [
  "mfr_job_cards",
  "mfr_movements",
  "mfr_idempotency_keys",
  "mfr_purchase_invoice_claims",
  "mfr_serialize_locks"
] as const;

export const RESTORE_ADMIN_ONLY_MESSAGE =
  "Unauthorized: Only Admin/Super Admin users may restore a database dump.";

export const RESTORE_LEDGER_CLIENT_BLOCKED_MESSAGE =
  "Job cards and material movements cannot be restored through the client. Ledger history is immutable outside the movement engine.";

export function isRestoreAdminRole(role: string | undefined | null): boolean {
  const r = String(role || "").toLowerCase();
  return r === "admin" || r === "super_admin";
}

export function authorizeDatabaseRestore(actor: { role?: string } | null | undefined): {
  ok: boolean;
  error?: string;
} {
  if (!actor || !isRestoreAdminRole(actor.role)) {
    return { ok: false, error: RESTORE_ADMIN_ONLY_MESSAGE };
  }
  return { ok: true };
}

export function isLedgerRestoreCollection(collection: string): boolean {
  return (LEDGER_RESTORE_BLOCKED_COLLECTIONS as readonly string[]).includes(collection);
}
