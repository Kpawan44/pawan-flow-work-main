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

/** Staff may record ordinary shop-floor status. Terminal ledger/workflow states are privileged. */
const STAFF_ALLOWED_STATUS = new Set([
  "in process",
  "in progress",
  "pending",
  "pending acceptance",
  "on hold"
]);

const WORKFLOW_ALLOWED_FIELDS = new Set([
  "operatorName",
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

const DISPATCH_OR_ADMIN_EXTRA = new Set(["completed", "heatTreatmentRequired"]);

/** Department-owned workflow blobs. Ordinary staff may update only their own department's fields. */
const DEPARTMENT_OWNED_FIELDS: Record<string, string> = {
  productionDetails: "Production",
  heatTreatmentDetails: "Heat Treatment",
  platingDetails: "Plating",
  packingDetails: "Packing",
  packingCompleted: "Packing",
  packingDate: "Packing",
  storeDetails: "Store",
  storeCompleted: "Store",
  storeDate: "Store",
  purchaseDetails: "Purchase",
  purchaseCompleted: "Purchase",
  purchaseDate: "Purchase",
  dispatchDetails: "Dispatch",
  rawMaterialStoreDetails: "Raw Material Store",
  rawStoreDetails: "Raw Material Store",
  rawStoreCompleted: "Raw Material Store",
  rawStoreDate: "Raw Material Store",
  incomingStoreDetails: "Incoming Store",
  incomingStoreCompleted: "Incoming Store",
  incomingStoreDate: "Incoming Store"
};

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
    if (key === "status") {
      const nextStatus = String(updates[key] ?? "").trim();
      const isStaffStatus = STAFF_ALLOWED_STATUS.has(nextStatus.toLowerCase());
      if (!isStaffStatus && !canDispatchExtras) {
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
    const ownedDept = DEPARTMENT_OWNED_FIELDS[key];
    if (ownedDept && !isAdmin && !canDispatchExtras && !isDeptAuthorized(actor, ownedDept)) {
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
