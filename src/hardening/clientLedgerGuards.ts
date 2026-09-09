/** Fail-closed client guards: movement history is immutable outside the transactional engine. */

export const MOVEMENT_UPDATE_BLOCKED_MESSAGE =
  "Movement quantity cannot be edited. Original movement history is immutable. Use reject/return through the receiving department or send a new transfer for remaining quantity.";

export const MOVEMENT_DELETE_BLOCKED_MESSAGE =
  "Movement records cannot be deleted. History is immutable. Pending transfers may be undone via the movement engine; accepted material must be rejected by the receiving department.";

export const JOB_CARD_CREATE_NO_CLIENT_FALLBACK_MESSAGE =
  "Server connection unavailable. Job card was not created. Direct Firestore fallback is disabled.";

export function denyDirectMovementUpdate(): never {
  throw new Error(MOVEMENT_UPDATE_BLOCKED_MESSAGE);
}

export function denyDirectMovementDelete(): never {
  throw new Error(MOVEMENT_DELETE_BLOCKED_MESSAGE);
}

export const LEDGER_SYNC_QUEUE_BLOCKED_COLLECTIONS = [
  "mfr_movements",
  "mfr_job_cards",
  "mfr_idempotency_keys"
] as const;

export function isLedgerCollectionBlockedFromClientSync(collection: string): boolean {
  return (LEDGER_SYNC_QUEUE_BLOCKED_COLLECTIONS as readonly string[]).includes(collection);
}
