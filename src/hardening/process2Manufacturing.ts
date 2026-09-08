/**
 * Process 2 — Manufacturing flow hardening helpers.
 * Isolated so tests run without Firestore. Complements Process 1; does not replace it.
 */

import {
  displayUnitLabel,
  isVisibleInProductionQueue,
  normalizeDeptName,
  normalizeItemCode,
  parseDecimalQuantity
} from "./process1Purchase";
import { computeRmRuntimeStock } from "./rmSkuMaster";

export { displayUnitLabel, isVisibleInProductionQueue, parseDecimalQuantity };

export function isRawMaterialStoreIssuingToProduction(mov: {
  isIssueRequest?: unknown;
  fromDepartment?: string;
  toDepartment?: string;
  issueStatus?: string;
}): boolean {
  return Boolean(
    mov.isIssueRequest &&
      normalizeDeptName(mov.fromDepartment) === "raw material store" &&
      normalizeDeptName(mov.toDepartment) === "production" &&
      String(mov.issueStatus || "") === "Issued"
  );
}

/** RM catalog stock still drops on Issued. Production consume/start uses this instead. */
export function getAcceptedRawMaterialIssuedQty(
  job: { jobCardNo?: string; processType?: string; orderQty?: number },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    isIssueRequest?: unknown;
    accepted?: boolean;
    quantity?: number;
  }> = []
): number {
  if (!job) return 0;
  if (job.processType === "Purchase") return Number(job.orderQty || 0);
  const target = String(job.jobCardNo || "").toLowerCase();
  return (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === "raw material store" &&
        Boolean(m.isIssueRequest) &&
        m.accepted === true
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

export function canStartProductionWithRm(
  job: { processType?: string; jobCardNo?: string; orderQty?: number },
  movements: any[],
  opts?: { compulsory?: boolean }
): { ok: boolean; error?: string } {
  if (opts?.compulsory === false) return { ok: true };
  if (job.processType === "Purchase") return { ok: true };
  const accepted = getAcceptedRawMaterialIssuedQty(job, movements);
  if (accepted <= 0) {
    return { ok: false, error: "Production cannot start until issued raw material is accepted by Production." };
  }
  return { ok: true };
}

export function remainingAtProduction(
  job: { orderQty?: number; jobCardNo?: string },
  movements: Array<{ jobCardNo?: string; fromDepartment?: string; quantity?: number }> = []
): number {
  const order = Number(job.orderQty || 0);
  const target = String(job.jobCardNo || "").toLowerCase();
  const produced = (movements || [])
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === "production"
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  return Math.max(0, order - produced);
}

export function getEffectiveDepartmentRejectionQty(
  job: {
    jobCardNo?: string;
    heatTreatmentDetails?: { rejectionQty?: number };
    platingDetails?: { rejectionQty?: number };
    packingDetails?: { rejectionQty?: number };
  },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    accepted?: boolean;
    quantity?: number;
    processDetails?: any;
  }> = [],
  department: string
): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const dept = normalizeDeptName(department);

  let recordedRejections = 0;
  if (dept === "heat treatment") recordedRejections = Number(job.heatTreatmentDetails?.rejectionQty || 0);
  if (dept === "plating") recordedRejections = Number(job.platingDetails?.rejectionQty || 0);
  if (dept === "packing") recordedRejections = Number(job.packingDetails?.rejectionQty || 0);

  const isUpstream = (fromD: string, toD: string) => {
    const f = normalizeDeptName(fromD);
    const t = normalizeDeptName(toD);
    if (f === "plating" && (t === "heat treatment" || t === "production")) return true;
    if (f === "heat treatment" && t === "production") return true;
    if (f === "packing" && (t === "plating" || t === "heat treatment" || t === "production")) return true;
    return false;
  };

  // Only reverse movements marked as rejection returns offset the recorded rejectionQty to avoid double deduction.
  // Standard reverse transfers (e.g. good rework) count as sent outbound while recordedRejections count as scrap.
  const reverseRejectionSentQty = (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === dept &&
        isUpstream(m.fromDepartment || "", m.toDepartment || "") &&
        m.accepted === true &&
        (Boolean(m.processDetails?.isRejectionReturn) || Boolean(m.processDetails?.isWireRejection))
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  return Math.max(0, recordedRejections - reverseRejectionSentQty);
}

export function remainingAtDepartment(
  job: { jobCardNo?: string; heatTreatmentDetails?: { rejectionQty?: number }; platingDetails?: { rejectionQty?: number }; packingDetails?: { rejectionQty?: number } },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    accepted?: boolean;
    quantity?: number;
  }> = [],
  department: string
): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const dept = normalizeDeptName(department);
  const received = (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.toDepartment) === dept &&
        m.accepted === true
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const sent = (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === dept
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  const effectiveRejection = getEffectiveDepartmentRejectionQty(job, movements, department);
  return Math.max(0, received - sent - effectiveRejection);
}

/** Store on-hand: accepted inbound minus outbound. Avoids Packing loop double-count. */
export function storeAuthoritativeOnHand(
  job: { jobCardNo?: string; currentQty?: number; currentDepartment?: string; dispatchDetails?: { dispatchQty?: number }; completed?: boolean },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    accepted?: boolean;
    quantity?: number;
  }> = []
): number {
  const target = String(job.jobCardNo || "").toLowerCase();
  const inbound = (movements || [])
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.toDepartment) === "store" &&
        m.accepted === true
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const outbound = (movements || [])
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === "store"
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const net = inbound - outbound;
  if (inbound > 0 || outbound > 0) return Math.max(0, net);
  if (normalizeDeptName(job.currentDepartment) === "store") return Math.max(0, Number(job.currentQty || 0));
  return 0;
}

export function canIssueRawMaterialQty(availableStock: number, requestedQty: number): { ok: boolean; error?: string } {
  const avail = Number(availableStock);
  const req = Number(requestedQty);
  if (!(req > 0) || !Number.isFinite(req)) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  if (!Number.isFinite(avail) || req > avail) {
    return { ok: false, error: `Cannot issue ${req} KG; available RM stock is ${avail} KG.` };
  }
  return { ok: true };
}

export function rmAvailableForIssue(
  openingQty: number,
  movements: any[],
  code: string
): number {
  return computeRmRuntimeStock(openingQty, movements, code);
}

export function findPendingDuplicateMovement(
  movements: Array<{
    accepted?: boolean;
    deletedDate?: string;
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    isIssueRequest?: unknown;
  }>,
  input: { jobCardNo: string; fromDepartment: string; toDepartment: string; isIssueRequest?: unknown }
): boolean {
  if (input.isIssueRequest) return false;
  const jc = String(input.jobCardNo || "").toLowerCase();
  const from = normalizeDeptName(input.fromDepartment);
  const to = normalizeDeptName(input.toDepartment);
  return (movements || []).some(
    (m) =>
      !m.accepted &&
      !m.deletedDate &&
      String(m.jobCardNo || "").toLowerCase() === jc &&
      normalizeDeptName(m.fromDepartment) === from &&
      normalizeDeptName(m.toDepartment) === to
  );
}

export function attachProcess2MovementContract(
  movement: Record<string, any>,
  job?: {
    itemCode?: string;
    itemName?: string;
    materialType?: string;
    unit?: string;
    jobCardNo?: string;
    isWire?: boolean;
    rawMaterialKind?: string;
  } | null
): any {
  const itemCode = normalizeItemCode(movement.itemCode || job?.itemCode);
  const itemName = String(movement.itemName || job?.itemName || "").trim();
  const materialType = movement.materialType || job?.materialType;
  const unit = movement.unit || job?.unit;
  const processDetails = { ...(movement.processDetails || {}) };
  if (itemCode && itemCode !== "-") processDetails.itemCode = processDetails.itemCode || itemCode;
  if (itemName) processDetails.itemName = processDetails.itemName || itemName;
  if (materialType) processDetails.materialType = processDetails.materialType || materialType;
  if (unit) processDetails.unit = processDetails.unit || unit;
  if (processDetails.rawMaterialCode) {
    processDetails.rawMaterialCode = normalizeItemCode(processDetails.rawMaterialCode);
  }
  return {
    ...movement,
    jobCardNo: movement.jobCardNo || job?.jobCardNo,
    itemCode: itemCode && itemCode !== "-" ? itemCode : movement.itemCode,
    itemName: itemName || movement.itemName,
    materialType,
    unit,
    processDetails
  };
}

export function shouldUpdateJobOnAccept(mov: {
  isIssueRequest?: unknown;
  fromDepartment?: string;
  toDepartment?: string;
  issueStatus?: string;
}): boolean {
  return !isRawMaterialStoreIssuingToProduction(mov);
}

export function isVisibleInDispatchQueue(
  job: {
    completed?: boolean;
    currentDepartment?: string;
    status?: string;
    processType?: string;
    jobCardNo?: string;
  },
  movements: Array<{
    jobCardNo?: string;
    toDepartment?: string;
    fromDepartment?: string;
    accepted?: boolean;
    isIssueRequest?: unknown;
    issueStatus?: string;
  }> = []
): boolean {
  if (job.completed) return false;
  const dept = normalizeDeptName(job.currentDepartment);
  if (dept === "dispatch" || dept === "completed") return true;
  const jc = String(job.jobCardNo || "").toLowerCase();
  return (movements || []).some((m) => {
    if (String(m.jobCardNo || "").toLowerCase() !== jc) return false;
    if (normalizeDeptName(m.toDepartment) === "dispatch" && !m.accepted) return true;
    if (m.isIssueRequest && normalizeDeptName(m.fromDepartment) === "dispatch") return true;
    if (
      m.isIssueRequest &&
      normalizeDeptName(m.fromDepartment) === "store" &&
      normalizeDeptName(m.toDepartment) === "dispatch" &&
      m.issueStatus !== "Rejected"
    ) {
      return true;
    }
    return false;
  });
}

export function getCumulativeDispatchedQty(
  job: { jobCardNo?: string; dispatchDetails?: { dispatchQty?: number } },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    accepted?: boolean;
    quantity?: number;
  }> = []
): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const dispatchedMovQty = (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.toDepartment) === "dispatch" &&
        m.accepted === true
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  if (dispatchedMovQty > 0) return dispatchedMovQty;
  return Number(job.dispatchDetails?.dispatchQty || 0);
}

export function canFinalizeDispatch(
  job: {
    completed?: boolean;
    status?: string;
    jobCardNo?: string;
    orderQty?: number;
    dispatchDetails?: { dispatchQty?: number };
  },
  movements: Array<any> = [],
  requestedQty: number = 0
): { ok: boolean; error?: string } {
  if (!job) return { ok: false, error: "Invalid job card." };
  if (job.completed || String(job.status || "") === "Completed") {
    return { ok: false, error: "This job has already been dispatched." };
  }

  const req = Number(requestedQty || 0);
  const availableInStore = storeAuthoritativeOnHand(job, movements);

  if (availableInStore <= 0 && Number(job.dispatchDetails?.dispatchQty || 0) > 0) {
    return { ok: false, error: "This job has already been dispatched." };
  }

  if (req > 0 && availableInStore > 0 && req > availableInStore) {
    return {
      ok: false,
      error: `Cannot dispatch ${req} KG; available Store stock is only ${availableInStore} KG.`
    };
  }

  return { ok: true };
}

export function sameDepartmentTransferBlocked(fromDepartment: string, toDepartment: string): boolean {
  return normalizeDeptName(fromDepartment) === normalizeDeptName(toDepartment) && Boolean(fromDepartment);
}

export function process2SendAvailableQty(
  fromDepartment: string,
  job: any,
  movements: any[]
): number | null {
  const from = normalizeDeptName(fromDepartment);
  if (from === "production") return remainingAtProduction(job, movements);
  if (from === "heat treatment") return remainingAtDepartment(job, movements, "Heat Treatment");
  if (from === "plating") return remainingAtDepartment(job, movements, "Plating");
  if (from === "packing") return remainingAtDepartment(job, movements, "Packing");
  if (from === "store") return storeAuthoritativeOnHand(job, movements);
  return null;
}
