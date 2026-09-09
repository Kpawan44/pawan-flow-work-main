/**
 * Create-movement idempotency: the client must supply a stable operationId.
 * Do not mint a unique timestamp id on the server — retries would duplicate ledger rows.
 */
export function resolveCreateMovementOperationId(body: Record<string, any> | null | undefined): {
  ok: boolean;
  operationId?: string;
  error?: string;
} {
  const op = String(body?.operationId || "").trim();
  if (!op) {
    return {
      ok: false,
      error: "operationId is required. Retry the same create with the identical operationId to avoid duplicate movements."
    };
  }
  if (op.length > 200) {
    return { ok: false, error: "operationId is too long." };
  }
  return { ok: true, operationId: op };
}

/**
 * Stamp a stable operationId onto a client payload object so retries reuse it.
 * Does not mint a new id when one is already present.
 */
export function ensureClientMovementOperationId(payload: Record<string, any> | null | undefined): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("operationId is required.");
  }
  const existing = String(payload.operationId || "").trim();
  if (existing) return existing;
  const minted =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `op-${crypto.randomUUID()}`
      : `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  payload.operationId = minted;
  return minted;
}

export function defaultAcceptOperationId(movementId: string, acceptQty?: number): string {
  if (acceptQty !== undefined && Number.isFinite(acceptQty)) {
    return `op-accept-${movementId}-${acceptQty}`;
  }
  return `op-accept-${movementId}`;
}

export function defaultRejectOperationId(
  movementId: string,
  rejectedQty?: number,
  acceptedQty?: number
): string {
  if (rejectedQty !== undefined || acceptedQty !== undefined) {
    return `op-reject-${movementId}-${rejectedQty ?? "full"}-${acceptedQty || 0}`;
  }
  return `op-reject-${movementId}`;
}

/** Stable fingerprint so the same operationId cannot be reused for a different transfer. */
export function createMovementRequestFingerprint(input: {
  jobCardNo?: string;
  fromDepartment?: string;
  toDepartment?: string;
  quantity?: number;
}): string {
  const qty = Number(input.quantity);
  const qtyKey = Number.isFinite(qty) ? String(qty) : "";
  return [
    String(input.jobCardNo || "").trim().toUpperCase(),
    String(input.fromDepartment || "").trim().toLowerCase(),
    String(input.toDepartment || "").trim().toLowerCase(),
    qtyKey
  ].join("|");
}
