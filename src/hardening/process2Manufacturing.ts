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

export function isRejectionReturnMovement(m: { processDetails?: any; transactionType?: string } | null | undefined): boolean {
  if (!m) return false;
  return Boolean(m.processDetails?.isRejectionReturn) || String(m.transactionType || "").toUpperCase() === "REVERSAL";
}

export function isDeletedMovement(m: { deletedDate?: string; isDeleted?: boolean; status?: string } | null | undefined): boolean {
  if (!m) return true;
  return Boolean(m.deletedDate) || Boolean(m.isDeleted) || String(m.status || "") === "deleted";
}

export function isFullyRejectedMovement(m: { accepted?: boolean; issueStatus?: string; resolutionStatus?: string } | null | undefined): boolean {
  if (!m) return false;
  const status = String(m.issueStatus || m.resolutionStatus || "").toLowerCase();
  return status === "rejected" && !m.accepted;
}

export function isUndoneMovement(m: { undone?: boolean; resolutionStatus?: string; issueStatus?: string } | null | undefined): boolean {
  if (!m) return false;
  if (m.undone === true) return true;
  const status = String(m.resolutionStatus || m.issueStatus || "").toLowerCase();
  return status === "undone" || status === "cancelled";
}

export function isUndoReversalMovement(m: { processDetails?: any } | null | undefined): boolean {
  return Boolean(m?.processDetails?.isUndoReversal);
}

export function creditedInboundQty(m: {
  accepted?: boolean;
  quantity?: number;
  acceptedQty?: number;
  issueStatus?: string;
  resolutionStatus?: string;
}): number {
  if (isFullyRejectedMovement(m) || isUndoneMovement(m as any) || isUndoReversalMovement(m as any)) return 0;
  const acceptedQty = Number(m.acceptedQty);
  if (Number.isFinite(acceptedQty) && acceptedQty > 0) return acceptedQty;
  if (m.accepted) return Number(m.quantity || 0);
  return 0;
}

export function unresolvedPendingQty(m: {
  accepted?: boolean;
  quantity?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  issueStatus?: string;
  resolutionStatus?: string;
  deletedDate?: string;
  isDeleted?: boolean;
  isIssueRequest?: unknown;
}): number {
  if (isDeletedMovement(m)) return 0;
  if (isFullyRejectedMovement(m) || isUndoneMovement(m as any)) return 0;
  const q = Number(m.quantity);
  const acc = Number(m.acceptedQty || 0);
  const rej = Number(m.rejectedQty || 0);
  if (!Number.isFinite(q) || q <= 0) {
    return m.accepted || isFullyRejectedMovement(m) ? 0 : 1;
  }
  if (m.accepted && !(acc > 0 && acc + rej < q)) return 0;
  return Math.max(0, q - acc - rej);
}

export function isPendingAcceptanceMovement(m: {
  accepted?: boolean;
  deletedDate?: string;
  isDeleted?: boolean;
  status?: string;
  issueStatus?: string;
  resolutionStatus?: string;
  toDepartment?: string;
  quantity?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  isIssueRequest?: unknown;
  fromDepartment?: string;
  processDetails?: any;
} | null | undefined): boolean {
  if (!m || isDeletedMovement(m)) return false;
  if (isUndoneMovement(m) || isUndoReversalMovement(m)) return false;
  if (isRejectionReturnMovement(m)) return false;
  if (isFullyRejectedMovement(m)) return false;
  const resolved = String(m.issueStatus || m.resolutionStatus || "").toLowerCase();
  if (resolved === "resolved" || resolved === "split") return false;
  if (m.isIssueRequest) {
    return (
      normalizeDeptName(m.fromDepartment) === "raw material store" &&
      normalizeDeptName(m.toDepartment) === "production" &&
      !m.accepted &&
      String(m.issueStatus || "") === "Issued"
    );
  }
  return unresolvedPendingQty(m) > 0;
}

function jobMovements<T extends { jobCardNo?: string }>(jobCardNo: string, movements: T[]): T[] {
  const target = String(jobCardNo || "").toLowerCase();
  return (movements || []).filter((m) => m && String(m.jobCardNo || "").toLowerCase() === target);
}

export function productionSendAvailable(
  job: { jobCardNo?: string; processType?: string; orderQty?: number },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    quantity?: number;
    accepted?: boolean;
    isIssueRequest?: unknown;
    processDetails?: any;
    transactionType?: string;
    deletedDate?: string;
    isDeleted?: boolean;
  }> = [],
  opts?: { compulsory?: boolean }
): number | null {
  if (!job) return 0;
  if (opts?.compulsory === false) return null;
  if (job.processType === "Purchase") return null;

  const targetMoves = jobMovements(String(job.jobCardNo || ""), movements).filter((m) => !isDeletedMovement(m));
  const rm = getAcceptedRawMaterialIssuedQty(job, targetMoves);
  const outbound = targetMoves
    .filter(
      (m) =>
        normalizeDeptName(m.fromDepartment) === "production" &&
        !isRejectionReturnMovement(m) &&
        !isUndoneMovement(m as any) &&
        !isUndoReversalMovement(m as any)
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const returnsIn = targetMoves
    .filter(
      (m) =>
        normalizeDeptName(m.toDepartment) === "production" &&
        isRejectionReturnMovement(m) &&
        creditedInboundQty(m) > 0
    )
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);
  return Math.max(0, rm + returnsIn - outbound);
}

export function remainingAtProduction(
  job: { orderQty?: number; jobCardNo?: string; processType?: string },
  movements: Array<{ jobCardNo?: string; fromDepartment?: string; toDepartment?: string; quantity?: number; accepted?: boolean; isIssueRequest?: unknown; processDetails?: any; transactionType?: string }> = [],
  opts?: { compulsory?: boolean }
): number {
  const available = productionSendAvailable(job, movements, opts);
  if (available === null) {
    return remainingAtDepartment(job, movements, "Production");
  }
  return available;
}

export function assertHeatTreatmentRouting(
  job: { heatTreatmentRequired?: boolean } | null | undefined,
  fromDepartment: string,
  toDepartment: string,
  extra?: { isIssueRequest?: unknown; isRejectionReturn?: boolean }
): { ok: boolean; error?: string } {
  if (extra?.isIssueRequest || extra?.isRejectionReturn) return { ok: true };
  const from = normalizeDeptName(fromDepartment);
  const to = normalizeDeptName(toDepartment);
  if (from !== "production") return { ok: true };
  if (job?.heatTreatmentRequired && to !== "heat treatment") {
    return {
      ok: false,
      error: "Heat Treatment is required for this job card. Production must send material to Heat Treatment and cannot skip to another department."
    };
  }
  return { ok: true };
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
  job: {
    jobCardNo?: string;
    currentQty?: number;
    currentDepartment?: string;
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
    acceptedQty?: number;
    issueStatus?: string;
    resolutionStatus?: string;
    processDetails?: any;
    transactionType?: string;
    deletedDate?: string;
    isDeleted?: boolean;
  }> = [],
  department: string
): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const dept = normalizeDeptName(department);
  const cardMoves = (movements || []).filter(
    (m) => m && String(m.jobCardNo || "").toLowerCase() === target && !isDeletedMovement(m)
  );
  const received = cardMoves
    .filter((m) => normalizeDeptName(m.toDepartment) === dept)
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);
  const sent = cardMoves
    .filter((m) => {
      if (normalizeDeptName(m.fromDepartment) !== dept) return false;
      if (isUndoneMovement(m as any) || isUndoReversalMovement(m as any)) return false;
      if (isRejectionReturnMovement(m) && (m as any).parentMovementId) return false;
      if (isRejectionReturnMovement(m) && (m as any).processDetails?.originalMovementId) return false;
      return true;
    })
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  const effectiveRejection = getEffectiveDepartmentRejectionQty(job, movements, department);
  if (received === 0 && sent === 0) {
    // Ledger history for this job exists: a department with no inbound/outbound is empty.
    // Do not let a manipulated currentQty cache invent transferable quantity.
    if (cardMoves.length > 0) return 0;
    // LEGACY_NO_HISTORY_FALLBACK: only when this job has zero movements. Never use orderQty.
    // Once any movement exists, cache cannot increase transferable quantity.
    return Math.max(0, Number(job.currentQty || 0));
  }
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
    processDetails?: any;
    transactionType?: string;
    deletedDate?: string;
    isDeleted?: boolean;
    status?: string;
  }> = []
): number {
  const target = String(job.jobCardNo || "").toLowerCase();
  const inbound = (movements || [])
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.toDepartment) === "store" &&
        !isDeletedMovement(m)
    )
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);
  const outbound = (movements || [])
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === target &&
        normalizeDeptName(m.fromDepartment) === "store" &&
        !isDeletedMovement(m) &&
        !isRejectionReturnMovement(m)
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
  const net = inbound - outbound;
  if (inbound > 0 || outbound > 0) return Math.max(0, net);
  const hasLedger = (movements || []).some(
    (m) => String(m.jobCardNo || "").toLowerCase() === target && !isDeletedMovement(m)
  );
  if (hasLedger) return 0;
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
      isPendingAcceptanceMovement(m) &&
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
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);

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

/** Split authorization: ledger remaining when history exists; currentQty only if there are zero movements. Never orderQty. */
export function parentSplitAvailableQty(
  job: {
    jobCardNo?: string;
    currentQty?: number;
    currentDepartment?: string;
    processType?: string;
    orderQty?: number;
  },
  movements: any[] = [],
  opts?: { compulsory?: boolean }
): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const hasLedger = (movements || []).some(
    (m) => m && String(m.jobCardNo || "").toLowerCase() === target && !isDeletedMovement(m)
  );
  if (hasLedger) {
    const dept = job.currentDepartment || "Production";
    const cap = process2SendAvailableQty(dept, job, movements, opts);
    if (cap !== null) return cap;
    return remainingAtDepartment(job, movements, dept);
  }
  return Math.max(0, Number(job.currentQty || 0));
}

/** Store/challan/scan: ledger custody when history exists; currentQty only with zero movements. */
export function ledgerAuthorizedExternalQty(job: any, movements: any[] = []): number {
  if (!job) return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  const related = (movements || []).filter(
    (m) => m && String(m.jobCardNo || "").toLowerCase() === target && !isDeletedMovement(m)
  );
  if (related.length > 0) {
    const dept = job.currentDepartment || "Store";
    if (normalizeDeptName(dept) === "store") return storeAuthoritativeOnHand(job, movements);
    const cap = process2SendAvailableQty(dept, job, movements);
    if (cap !== null) return cap;
    return remainingAtDepartment(job, movements, dept);
  }
  return Math.max(0, Number(job.currentQty || 0));
}

export function rmIssueAvailableQty(
  job: any,
  movements: any[],
  skuCode: string | undefined,
  skuOpeningQty: number
): number {
  const code = String(skuCode || job?.itemCode || "").trim();
  if (code) {
    return computeRmRuntimeStock(Number(skuOpeningQty) || 0, movements || [], code);
  }
  return remainingAtDepartment(job, movements, "Raw Material Store");
}

export function process2SendAvailableQty(
  fromDepartment: string,
  job: any,
  movements: any[],
  opts?: { compulsory?: boolean }
): number | null {
  const from = normalizeDeptName(fromDepartment);
  if (from === "production") {
    const rmCap = productionSendAvailable(job, movements, opts);
    // OPTIONAL_RM_NO_LEDGER_CEILING: when RM is not compulsory (or Purchase), do not invent a
    // transferable qty from orderQty/currentQty. Compulsory RM uses the RM+returns-outbound ledger.
    if (rmCap !== null) return rmCap;
    return null;
  }
  if (from === "store") return storeAuthoritativeOnHand(job, movements);
  return remainingAtDepartment(job, movements, fromDepartment);
}

export function deriveCachedCurrentQty(
  job: any,
  movements: any[],
  department: string,
  opts?: { compulsory?: boolean }
): number {
  const from = normalizeDeptName(department);
  if (from === "production") {
    const avail = productionSendAvailable(job, movements, opts);
    if (avail === null) return remainingAtDepartment(job, movements, "Production");
    return avail;
  }
  const sendAvail = process2SendAvailableQty(department, job, movements, opts);
  if (sendAvail !== null) return sendAvail;
  return remainingAtDepartment(job, movements, department);
}
