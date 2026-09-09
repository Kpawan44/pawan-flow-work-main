import { SimpleStore } from "./commitMaterialMovement";

export const JOB_CARD_DELETE_PRESERVES_MOVEMENTS = true;

export const JOB_CARD_CLIENT_DESTROY_BLOCKED_MESSAGE =
  "Ledger-linked job cards cannot be physically deleted from the client. Movement history is immutable. Use the server tombstone path; movements are never deleted.";

export interface JobCardTombstoneInput {
  jobCardNo: string;
  actor: { userId: string; userName: string; role?: string };
  nowIso?: string;
}

/**
 * Soft-delete a job card. Never deletes mfr_movements.
 */
export async function tombstoneJobCardTx(
  store: SimpleStore,
  input: JobCardTombstoneInput
): Promise<{ success: boolean; statusCode?: number; error?: string; jobCard?: any; tombstone?: any }> {
  const jobCardNo = String(input.jobCardNo || "").trim();
  if (!jobCardNo) {
    return { success: false, statusCode: 400, error: "Job Card number is required." };
  }
  const upper = jobCardNo.toUpperCase();
  const existing = (await store.get("mfr_job_cards", upper)) || (await store.get("mfr_job_cards", jobCardNo));
  if (!existing) {
    return { success: false, statusCode: 404, error: "Job card not found." };
  }

  const now = input.nowIso || new Date().toISOString();
  const tombstone = {
    jobCardNo: existing.jobCardNo || upper,
    deletedAt: now,
    deletedBy: input.actor.userId,
    deletedByName: input.actor.userName,
    tombstone: true
  };
  const updated = {
    ...existing,
    active: false,
    status: "deleted",
    deletedAt: now,
    deletedBy: input.actor.userId,
    tombstone: true
  };
  await store.set("mfr_deleted_job_cards", upper, tombstone);
  await store.set("mfr_job_cards", existing.jobCardNo || upper, updated);
  return { success: true, jobCard: updated, tombstone };
}
