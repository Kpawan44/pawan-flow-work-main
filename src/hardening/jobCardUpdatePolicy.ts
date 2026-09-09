import { isDeptAuthorized, MovementCommitInput } from "./commitMaterialMovement";

export type JobCardActor = MovementCommitInput["actor"];

/** Ledger / custody fields that must never be client-writable via PUT. */
export const JOB_CARD_LEDGER_PROTECTED_FIELDS = [
  "currentQty",
  "currentDepartment",
  "orderQty",
  "balanceQty",
  "jobCardNo",
  "version",
  "createdAt",
  "createdBy",
  "createdByUserId",
  "childJobCardNos",
  "parentJobCardNo",
  "pendingOutbound",
  "accepted",
  "rejected",
  "acceptedQty",
  "rejectedQty",
  "movementId",
  "operationId",
  "quantity",
  "resolutionStatus",
  "parentMovementId",
  "originalMovementId",
  "reversalOfMovementId",
  "transactionType",
  "undone"
] as const;

const WORKFLOW_ALLOWED_FIELDS = new Set([
  "operatorName",
  "status",
  "productionDetails",
  "heatTreatmentDetails",
  "platingDetails",
  "packingDetails",
  "storeDetails",
  "purchaseDetails",
  "dispatchDetails",
  "rawMaterialStoreDetails",
  "rawStoreDetails",
  "incomingStoreDetails",
  "incomingStoreCompleted",
  "incomingStoreDate",
  "packingCompleted",
  "packingDate",
  "storeCompleted",
  "storeDate",
  "purchaseCompleted",
  "purchaseDate",
  "rawStoreCompleted",
  "rawStoreDate",
  "outsourceDetails",
  "remarks",
  "heatTreatmentRequired",
  "customRoutedToPlating",
  "customRoutedToPacking",
  "customRoutedToStore",
  "isAssemblyProduct",
  "assemblyComponents",
  "unit",
  "materialType",
  "isWire",
  "rawMaterialKind",
  "itemName",
  "itemCode",
  "partyName",
  "processType",
  "wireScrapQty",
  "priority",
  "expectedDeliveryDate",
  "orderNo",
  "poNumber"
]);

const DISPATCH_OR_ADMIN_EXTRA = new Set(["completed"]);

export interface JobCardPutPolicyResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  sanitized?: Record<string, any>;
  rejectedFields?: string[];
}

export function applyJobCardPutPolicy(
  existing: Record<string, any> | null,
  updates: Record<string, any>,
  actor: JobCardActor
): JobCardPutPolicyResult {
  if (!existing) {
    return { ok: false, statusCode: 404, error: "Job card not found." };
  }
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return { ok: false, statusCode: 400, error: "Invalid job card update payload." };
  }

  const rejectedFields: string[] = [];
  const sanitized: Record<string, any> = {};
  const role = String(actor.role || "staff").toLowerCase();
  const isAdmin =
    role === "super_admin" ||
    role === "admin" ||
    String(actor.department || "").toLowerCase() === "admin" ||
    String(actor.department || "").toLowerCase() === "management";
  const canDispatchExtras =
    isAdmin || isDeptAuthorized(actor, "Dispatch") || isDeptAuthorized(actor, "Purchase");

  for (const key of Object.keys(updates)) {
    if (key.startsWith("_")) continue;
    if ((JOB_CARD_LEDGER_PROTECTED_FIELDS as readonly string[]).includes(key)) {
      rejectedFields.push(key);
      continue;
    }
    if (DISPATCH_OR_ADMIN_EXTRA.has(key)) {
      if (!canDispatchExtras) {
        rejectedFields.push(key);
        continue;
      }
      sanitized[key] = updates[key];
      continue;
    }
    if (!WORKFLOW_ALLOWED_FIELDS.has(key)) {
      rejectedFields.push(key);
      continue;
    }
    sanitized[key] = updates[key];
  }

  if (rejectedFields.length > 0) {
    return {
      ok: false,
      statusCode: 403,
      error: `Forbidden: job card fields are not writable via PUT: ${rejectedFields.join(", ")}. Ledger fields must change only through the movement engine.`,
      rejectedFields
    };
  }

  return { ok: true, sanitized };
}

/** Client helper: drop ledger fields before PUT so workflow blobs still save. The API still 403s if those fields are sent. */
export function omitLedgerFieldsFromJobCardPut(updates: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  if (!updates || typeof updates !== "object") return out;
  for (const key of Object.keys(updates)) {
    if ((JOB_CARD_LEDGER_PROTECTED_FIELDS as readonly string[]).includes(key)) continue;
    out[key] = updates[key];
  }
  return out;
}
