import {
  applyAcceptanceDepartment,
  clearPendingOutbound,
  isDeptAuthorized,
  isStockInJob,
  MovementCommitInput,
  nextStatusOnAccept,
  SimpleStore
} from "./commitMaterialMovement";
import {
  creditedInboundQty,
  deriveCachedCurrentQty,
  isFullyRejectedMovement,
  isPendingAcceptanceMovement,
  isRejectionReturnMovement,
  isUndoneMovement,
  unresolvedPendingQty
} from "./process2Manufacturing";

export type MovementActor = MovementCommitInput["actor"];

export interface AcceptMovementInput {
  operationId: string;
  movementId: string;
  acceptQty?: number;
  remarks?: string;
  allottedLocation?: string;
  rackNo?: string;
  issueStatus?: string;
  actor: MovementActor;
  nowIso?: string;
  requireRawMaterialForProduction?: boolean;
}

export interface RejectMovementInput {
  operationId: string;
  movementId: string;
  remarks: string;
  rejectedQty?: number;
  acceptedQty?: number;
  actor: MovementActor;
  nowIso?: string;
  requireRawMaterialForProduction?: boolean;
}

export interface ResolveMovementResult {
  success: boolean;
  cached?: boolean;
  error?: string;
  statusCode?: number;
  movement?: any;
  returnMovement?: any;
  updatedJobCard?: any | null;
  audit?: any;
  notification?: any;
  writes?: Array<{ collection: string; id: string; data: any }>;
}

function isReceiverAuthorized(actor: MovementActor, toDepartment: string): boolean {
  return isDeptAuthorized(actor, toDepartment);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

async function loadCachedResult(store: SimpleStore, opKey: string): Promise<ResolveMovementResult | null> {
  if (!opKey) return null;
  const existing = await store.get("mfr_idempotency_keys", opKey);
  if (existing?.result) {
    return { success: true, writes: [], ...existing.result, cached: true };
  }
  return null;
}

function persistIdempotency(writes: ResolveMovementResult["writes"], opKey: string, now: string, userId: string, resultPayload: any) {
  writes!.push({
    collection: "mfr_idempotency_keys",
    id: opKey,
    data: { operationId: opKey, createdAt: now, userId, result: resultPayload }
  });
}

export async function acceptMaterialMovementTx(
  store: SimpleStore,
  input: AcceptMovementInput
): Promise<ResolveMovementResult> {
  const serializeKey = String(input.movementId || input.operationId || "accept").toUpperCase();
  if (store.runSerialized) {
    return store.runSerialized(`acc:${serializeKey}`, () => acceptMaterialMovementTxInner(store, input));
  }
  return acceptMaterialMovementTxInner(store, input);
}

async function acceptMaterialMovementTxInner(
  store: SimpleStore,
  input: AcceptMovementInput
): Promise<ResolveMovementResult> {
  const now = input.nowIso || new Date().toISOString();
  const opKey = String(input.operationId || "").trim();
  if (!opKey) return { success: false, statusCode: 400, error: "operationId is required." };

  const cached = await loadCachedResult(store, opKey);
  if (cached) return cached;

  const movement = await store.get("mfr_movements", input.movementId);
  if (!movement) return { success: false, statusCode: 404, error: `Movement ${input.movementId} not found.` };
  if (movement.deletedDate || movement.status === "deleted") {
    return { success: false, statusCode: 400, error: `Movement ${input.movementId} has been cancelled or deleted.` };
  }

  if (!isReceiverAuthorized(input.actor, String(movement.toDepartment || ""))) {
    return {
      success: false,
      statusCode: 403,
      error: `Forbidden: User '${input.actor.userName}' (${input.actor.department}) is not authorized to accept material transfers for '${movement.toDepartment}'.`
    };
  }

  const originalQty = Number(movement.quantity || 0);
  const alreadyAccepted = Number(movement.acceptedQty || 0);
  const alreadyRejected = Number(movement.rejectedQty || 0);
  const pending = Math.max(0, originalQty - alreadyAccepted - alreadyRejected);
  const requestedAccept = input.acceptQty === undefined || input.acceptQty === null ? pending : Number(input.acceptQty);

  if (movement.accepted && movement.issueStatus !== "Rejected" && pending <= 0) {
    const payload = { success: true, cached: true, movement, updatedJobCard: null };
    return payload;
  }

  if (isFullyRejectedMovement(movement) && pending <= 0) {
    return { success: false, statusCode: 400, error: "This movement has already been fully rejected." };
  }

  if (!Number.isFinite(requestedAccept) || requestedAccept <= 0) {
    return { success: false, statusCode: 400, error: "Accepted quantity must be a positive number." };
  }
  if (requestedAccept > pending + 1e-9) {
    return {
      success: false,
      statusCode: 400,
      error: `Cannot accept ${requestedAccept}; only ${pending} remains unresolved on this movement.`
    };
  }

  const isRawMaterialStoreIssuing =
    movement.isIssueRequest &&
    movement.fromDepartment === "Raw Material Store" &&
    movement.toDepartment === "Production" &&
    (input.issueStatus === "Issued" || movement.issueStatus === "Issued");

  const nextAcceptedQty = alreadyAccepted + requestedAccept;
  const remainingAfter = Math.max(0, originalQty - nextAcceptedQty - alreadyRejected);
  const fullyAccepted = remainingAfter <= 1e-9 && alreadyRejected <= 1e-9;

  const updatedMov: any = {
    ...movement,
    quantity: originalQty,
    acceptedQty: nextAcceptedQty,
    rejectedQty: alreadyRejected,
    accepted: isRawMaterialStoreIssuing ? false : remainingAfter <= 1e-9 && alreadyRejected <= 1e-9 ? true : nextAcceptedQty > 0 && remainingAfter <= 1e-9,
    acceptedBy: isRawMaterialStoreIssuing ? movement.acceptedBy : input.actor.userName,
    acceptedByUserId: isRawMaterialStoreIssuing ? movement.acceptedByUserId : input.actor.userId,
    acceptedDate: isRawMaterialStoreIssuing ? movement.acceptedDate : now,
    resolutionStatus: remainingAfter > 1e-9 ? "PARTIAL" : alreadyRejected > 0 ? "SPLIT" : "ACCEPTED",
    issueStatus: isRawMaterialStoreIssuing
      ? input.issueStatus || movement.issueStatus || "Issued"
      : remainingAfter > 1e-9
        ? movement.issueStatus
        : alreadyRejected > 0
          ? "Resolved"
          : movement.isIssueRequest
            ? input.issueStatus || "Issued"
            : movement.issueStatus,
    remarks: input.remarks || movement.remarks,
    allottedLocation: input.allottedLocation !== undefined ? input.allottedLocation : movement.allottedLocation,
    rackNo: input.rackNo !== undefined ? input.rackNo : movement.rackNo,
    modifiedByUserId: input.actor.userId,
    modifiedByUserName: input.actor.userName,
    modifiedDate: now,
    modifiedAction: "ACCEPT"
  };

  if (!isRawMaterialStoreIssuing && remainingAfter <= 1e-9 && alreadyRejected <= 1e-9) {
    updatedMov.accepted = true;
  } else if (!isRawMaterialStoreIssuing && nextAcceptedQty > 0 && remainingAfter <= 1e-9) {
    updatedMov.accepted = true;
  } else if (!isRawMaterialStoreIssuing) {
    updatedMov.accepted = false;
  }

  const writes: NonNullable<ResolveMovementResult["writes"]> = [
    { collection: "mfr_movements", id: input.movementId, data: updatedMov }
  ];

  let updatedJobCard: any = null;
  const jobCardNo = String(movement.jobCardNo || "");
  if (jobCardNo && !isStockInJob(jobCardNo) && !isRawMaterialStoreIssuing) {
    const jobId = jobCardNo.toUpperCase();
    const job = (await store.get("mfr_job_cards", jobId)) || (await store.get("mfr_job_cards", jobCardNo));
    if (job) {
      const allMovements = await store.list("mfr_movements");
      const nextMovements = allMovements.map((m) => (m.movementId === input.movementId ? updatedMov : m));
      const dest = applyAcceptanceDepartment(updatedMov) || updatedMov.toDepartment;
      const cachedQty = deriveCachedCurrentQty(
        { ...job, currentDepartment: dest },
        nextMovements,
        dest,
        { compulsory: input.requireRawMaterialForProduction }
      );
      updatedJobCard = {
        ...job,
        currentDepartment: dest,
        status: nextStatusOnAccept(String(dest)),
        currentQty: cachedQty,
        pendingOutbound: clearPendingOutbound(job, updatedMov),
        version: (job.version || 1) + 1,
        updatedAt: now,
        updatedBy: input.actor.userName,
        updatedByUserId: input.actor.userId
      };
      writes.push({ collection: "mfr_job_cards", id: jobId, data: updatedJobCard });
    }
  }

  const auditId = newId("AL");
  const audit = {
    id: auditId,
    timestamp: now,
    userId: input.actor.userId,
    userName: input.actor.userName,
    action: "ACCEPT_MATERIAL",
    details: `User ${input.actor.userName} accepted ${requestedAccept} of ${originalQty} for ${movement.jobCardNo} at ${movement.toDepartment} (movement ${input.movementId}).`
  };
  writes.push({ collection: "mfr_audit_logs", id: auditId, data: audit });

  const notifId = newId("N");
  const notification = {
    notificationId: notifId,
    department: movement.fromDepartment,
    title: "Material Accepted",
    message: `${input.actor.userName} accepted ${requestedAccept} for Job Card ${movement.jobCardNo} at ${movement.toDepartment}.`,
    userId: `all_${String(movement.fromDepartment || "").toLowerCase().replace(/\s+/g, "_")}`,
    read: false,
    createdAt: now
  };
  writes.push({ collection: "mfr_notifications", id: notifId, data: notification });

  const resultPayload = { success: true, cached: false, movement: updatedMov, updatedJobCard };
  persistIdempotency(writes, opKey, now, input.actor.userId, resultPayload);
  for (const w of writes) await store.set(w.collection, w.id, w.data);
  return { success: true, cached: false, movement: updatedMov, updatedJobCard, audit, notification, writes };
}

export async function rejectMaterialMovementTx(
  store: SimpleStore,
  input: RejectMovementInput
): Promise<ResolveMovementResult> {
  const serializeKey = String(input.movementId || input.operationId || "reject").toUpperCase();
  if (store.runSerialized) {
    return store.runSerialized(`rej:${serializeKey}`, () => rejectMaterialMovementTxInner(store, input));
  }
  return rejectMaterialMovementTxInner(store, input);
}

async function rejectMaterialMovementTxInner(
  store: SimpleStore,
  input: RejectMovementInput
): Promise<ResolveMovementResult> {
  const now = input.nowIso || new Date().toISOString();
  const opKey = String(input.operationId || "").trim();
  if (!opKey) return { success: false, statusCode: 400, error: "operationId is required." };

  const cached = await loadCachedResult(store, opKey);
  if (cached) return cached;

  const remarks = String(input.remarks || "").trim();
  if (!remarks) {
    return { success: false, statusCode: 400, error: "Rejection reason is required." };
  }

  const movement = await store.get("mfr_movements", input.movementId);
  if (!movement) return { success: false, statusCode: 404, error: `Movement ${input.movementId} not found.` };
  if (movement.deletedDate || movement.status === "deleted") {
    return { success: false, statusCode: 400, error: `Movement ${input.movementId} has been cancelled or deleted.` };
  }
  if (isRejectionReturnMovement(movement)) {
    return { success: false, statusCode: 400, error: "Rejection-return movements cannot be rejected again." };
  }

  if (!isReceiverAuthorized(input.actor, String(movement.toDepartment || ""))) {
    return {
      success: false,
      statusCode: 403,
      error: `Forbidden: User '${input.actor.userName}' (${input.actor.department}) is not authorized to reject material transfers for '${movement.toDepartment}'.`
    };
  }

  const originalQty = Number(movement.quantity || 0);
  const alreadyAccepted = Number(movement.acceptedQty || (movement.accepted ? originalQty : 0));
  const alreadyRejected = Number(movement.rejectedQty || 0);
  const pending = Math.max(0, originalQty - alreadyAccepted - alreadyRejected);

  if (isFullyRejectedMovement(movement) && pending <= 0) {
    const payload = { success: true, cached: true, movement, updatedJobCard: null };
    return payload;
  }
  if (pending <= 0 && movement.accepted) {
    return { success: false, statusCode: 400, error: "This movement has already been fully accepted." };
  }

  let acceptNow = input.acceptedQty === undefined || input.acceptedQty === null ? 0 : Number(input.acceptedQty);
  let rejectNow = input.rejectedQty === undefined || input.rejectedQty === null ? pending - acceptNow : Number(input.rejectedQty);
  if (!Number.isFinite(acceptNow) || acceptNow < 0) {
    return { success: false, statusCode: 400, error: "Accepted quantity must be a non-negative number." };
  }
  if (!Number.isFinite(rejectNow) || rejectNow <= 0) {
    return { success: false, statusCode: 400, error: "Rejected quantity must be a positive number." };
  }
  if (acceptNow + rejectNow > pending + 1e-9) {
    return {
      success: false,
      statusCode: 400,
      error: `Accepted (${acceptNow}) plus rejected (${rejectNow}) cannot exceed remaining ${pending}.`
    };
  }

  const nextAcceptedQty = alreadyAccepted + acceptNow;
  const nextRejectedQty = alreadyRejected + rejectNow;
  const remainingAfter = Math.max(0, originalQty - nextAcceptedQty - nextRejectedQty);
  const returnId = newId("M-RET");
  const existingReturn = await store.get("mfr_movements", returnId);
  if (existingReturn) {
    return { success: false, statusCode: 409, error: `Return movement ID '${returnId}' already exists.` };
  }

  const rejectCycle = Number(movement.rejectionCycle || 0) + 1;
  const updatedMov: any = {
    ...movement,
    quantity: originalQty,
    acceptedQty: nextAcceptedQty,
    rejectedQty: nextRejectedQty,
    accepted: remainingAfter <= 1e-9 && nextAcceptedQty > 0,
    issueStatus: remainingAfter <= 1e-9 ? (nextAcceptedQty > 0 ? "Resolved" : "Rejected") : movement.issueStatus,
    resolutionStatus: remainingAfter > 1e-9 ? "PARTIAL" : nextAcceptedQty > 0 ? "SPLIT" : "REJECTED",
    rejectionRemarks: remarks,
    rejectedBy: input.actor.userName,
    rejectedByUserId: input.actor.userId,
    rejectedDate: now,
    rejectionCycle: rejectCycle,
    returnMovementId: returnId,
    returnMovementIds: [...(Array.isArray(movement.returnMovementIds) ? movement.returnMovementIds : movement.returnMovementId ? [movement.returnMovementId] : []), returnId],
    parentMovementId: movement.parentMovementId || movement.movementId,
    modifiedByUserId: input.actor.userId,
    modifiedByUserName: input.actor.userName,
    modifiedDate: now,
    modifiedAction: "REJECT"
  };

  const returnMovement: any = {
    movementId: returnId,
    jobCardNo: movement.jobCardNo,
    fromDepartment: movement.toDepartment,
    toDepartment: movement.fromDepartment,
    quantity: rejectNow,
    unit: movement.unit,
    itemCode: movement.itemCode,
    itemName: movement.itemName,
    materialType: movement.materialType,
    transferDate: now,
    transferBy: input.actor.userName,
    initiatedByUserId: input.actor.userId,
    initiatedByUserName: input.actor.userName,
    accepted: true,
    acceptedQty: rejectNow,
    acceptedBy: input.actor.userName,
    acceptedByUserId: input.actor.userId,
    acceptedDate: now,
    operationId: `${opKey}:return`,
    transactionType: "REVERSAL",
    reversalOfMovementId: movement.movementId,
    parentMovementId: movement.movementId,
    rejectionCycle: rejectCycle,
    processDetails: {
      ...(movement.processDetails || {}),
      isRejectionReturn: true,
      originalMovementId: movement.movementId,
      originalFromDepartment: movement.fromDepartment,
      rejectingDepartment: movement.toDepartment,
      rejectedQty: rejectNow,
      rejectionReason: remarks,
      rejectionCycle: rejectCycle
    },
    remarks: `Rejection return: ${rejectNow} sent back to ${movement.fromDepartment}. Reason: ${remarks}`,
    createdAt: now
  };

  const writes: NonNullable<ResolveMovementResult["writes"]> = [
    { collection: "mfr_movements", id: input.movementId, data: updatedMov },
    { collection: "mfr_movements", id: returnId, data: returnMovement }
  ];

  let updatedJobCard: any = null;
  const jobCardNo = String(movement.jobCardNo || "");
  if (jobCardNo && !isStockInJob(jobCardNo)) {
    const jobId = jobCardNo.toUpperCase();
    const job = (await store.get("mfr_job_cards", jobId)) || (await store.get("mfr_job_cards", jobCardNo));
    if (job) {
      const allMovements = await store.list("mfr_movements");
      const nextMovements = allMovements
        .filter((m) => m.movementId !== input.movementId && m.movementId !== returnId)
        .concat([updatedMov, returnMovement]);
      const restoreDept = nextAcceptedQty > 0 ? movement.toDepartment : movement.fromDepartment;
      const status =
        remainingAfter > 0
          ? "Pending Acceptance"
          : nextAcceptedQty > 0
            ? nextStatusOnAccept(String(movement.toDepartment))
            : String(restoreDept) === "Production"
              ? "Pending"
              : "In Process";
      const cachedQty = deriveCachedCurrentQty(
        { ...job, currentDepartment: restoreDept },
        nextMovements,
        restoreDept,
        { compulsory: input.requireRawMaterialForProduction }
      );
      updatedJobCard = {
        ...job,
        currentDepartment: restoreDept,
        status,
        currentQty: cachedQty,
        pendingOutbound: remainingAfter > 0 ? job.pendingOutbound : clearPendingOutbound(job, updatedMov),
        version: (job.version || 1) + 1,
        remarks: `Transfer rejected from ${movement.fromDepartment} to ${movement.toDepartment}. Reason: ${remarks}`,
        updatedAt: now,
        updatedBy: input.actor.userName,
        updatedByUserId: input.actor.userId
      };
      writes.push({ collection: "mfr_job_cards", id: jobId, data: updatedJobCard });
    }
  }

  const auditId = newId("AL");
  const audit = {
    id: auditId,
    timestamp: now,
    userId: input.actor.userId,
    userName: input.actor.userName,
    action: "REJECT_MATERIAL",
    details: `User ${input.actor.userName} rejected ${rejectNow} of movement ${input.movementId} for ${movement.jobCardNo}. Returned to ${movement.fromDepartment}. Reason: ${remarks}`
  };
  writes.push({ collection: "mfr_audit_logs", id: auditId, data: audit });

  const notifId = newId("N");
  const notification = {
    notificationId: notifId,
    department: movement.fromDepartment,
    title: "Material Transfer Rejected",
    message: `${input.actor.userName} rejected ${rejectNow} for Job Card ${movement.jobCardNo} and returned it to ${movement.fromDepartment}. Reason: ${remarks}`,
    userId: `all_${String(movement.fromDepartment || "").toLowerCase().replace(/\s+/g, "_")}`,
    read: false,
    createdAt: now
  };
  writes.push({ collection: "mfr_notifications", id: notifId, data: notification });

  const resultPayload = {
    success: true,
    cached: false,
    movement: updatedMov,
    returnMovement,
    updatedJobCard
  };
  persistIdempotency(writes, opKey, now, input.actor.userId, resultPayload);
  for (const w of writes) await store.set(w.collection, w.id, w.data);
  return {
    success: true,
    cached: false,
    movement: updatedMov,
    returnMovement,
    updatedJobCard,
    audit,
    notification,
    writes
  };
}

export async function undoMaterialMovementTx(
  store: SimpleStore,
  input: { operationId: string; movementId: string; actor: MovementActor; nowIso?: string; remarks?: string; requireRawMaterialForProduction?: boolean }
): Promise<ResolveMovementResult> {
  const serializeKey = String(input.movementId || input.operationId || "undo").toUpperCase();
  if (store.runSerialized) {
    return store.runSerialized(`undo:${serializeKey}`, () => undoMaterialMovementTxInner(store, input));
  }
  return undoMaterialMovementTxInner(store, input);
}

async function undoMaterialMovementTxInner(
  store: SimpleStore,
  input: { operationId: string; movementId: string; actor: MovementActor; nowIso?: string; remarks?: string; requireRawMaterialForProduction?: boolean }
): Promise<ResolveMovementResult> {
  const now = input.nowIso || new Date().toISOString();
  const opKey = String(input.operationId || "").trim();
  if (!opKey) return { success: false, statusCode: 400, error: "operationId is required." };

  const cached = await loadCachedResult(store, opKey);
  if (cached) return cached;

  const movement = await store.get("mfr_movements", input.movementId);
  if (!movement) return { success: false, statusCode: 404, error: `Movement ${input.movementId} not found.` };
  if (movement.deletedDate || movement.status === "deleted") {
    return { success: false, statusCode: 400, error: "Movement has been cancelled." };
  }
  if (isUndoneMovement(movement)) {
    const payload = { success: true, cached: true, movement, updatedJobCard: null };
    return payload;
  }
  if (isRejectionReturnMovement(movement) || movement.processDetails?.isUndoReversal) {
    return { success: false, statusCode: 400, error: "Reversal movements cannot be undone." };
  }
  if (movement.accepted === true || Number(movement.acceptedQty || 0) > 0) {
    return {
      success: false,
      statusCode: 400,
      error: "Accepted movements cannot be undone. The receiving department must reject to return material."
    };
  }
  if (!isDeptAuthorized(input.actor, String(movement.fromDepartment || ""))) {
    return {
      success: false,
      statusCode: 403,
      error: `Forbidden: User '${input.actor.userName}' is not authorized to undo a transfer from '${movement.fromDepartment}'.`
    };
  }

  const originalQty = Number(movement.quantity || 0);
  const returnId = newId("M-UNDO");
  const updatedMov: any = {
    ...movement,
    quantity: originalQty,
    undone: true,
    resolutionStatus: "UNDONE",
    issueStatus: "Cancelled",
    accepted: false,
    modifiedByUserId: input.actor.userId,
    modifiedByUserName: input.actor.userName,
    modifiedDate: now,
    modifiedAction: "UNDO",
    undoMovementId: returnId
  };

  const returnMovement: any = {
    movementId: returnId,
    jobCardNo: movement.jobCardNo,
    fromDepartment: movement.toDepartment,
    toDepartment: movement.fromDepartment,
    quantity: originalQty,
    unit: movement.unit,
    transferDate: now,
    transferBy: input.actor.userName,
    initiatedByUserId: input.actor.userId,
    initiatedByUserName: input.actor.userName,
    accepted: true,
    acceptedQty: 0,
    operationId: `${opKey}:undo-return`,
    transactionType: "REVERSAL",
    reversalOfMovementId: movement.movementId,
    parentMovementId: movement.movementId,
    processDetails: {
      isUndoReversal: true,
      isRejectionReturn: false,
      originalMovementId: movement.movementId,
      originalFromDepartment: movement.fromDepartment,
      undoReason: input.remarks || "Sender undo of pending transfer"
    },
    remarks: input.remarks || `Undo of pending transfer ${movement.movementId}`,
    createdAt: now
  };

  const writes: NonNullable<ResolveMovementResult["writes"]> = [
    { collection: "mfr_movements", id: input.movementId, data: updatedMov },
    { collection: "mfr_movements", id: returnId, data: returnMovement }
  ];

  let updatedJobCard: any = null;
  const jobCardNo = String(movement.jobCardNo || "");
  if (jobCardNo && !isStockInJob(jobCardNo)) {
    const jobId = jobCardNo.toUpperCase();
    const job = (await store.get("mfr_job_cards", jobId)) || (await store.get("mfr_job_cards", jobCardNo));
    if (job) {
      const allMovements = await store.list("mfr_movements");
      const nextMovements = allMovements
        .filter((m) => m.movementId !== input.movementId && m.movementId !== returnId)
        .concat([updatedMov, returnMovement]);
      const restoreDept = movement.fromDepartment;
      const cachedQty = deriveCachedCurrentQty(
        { ...job, currentDepartment: restoreDept },
        nextMovements,
        restoreDept,
        { compulsory: input.requireRawMaterialForProduction }
      );
      updatedJobCard = {
        ...job,
        currentDepartment: restoreDept,
        status: String(restoreDept) === "Production" ? "Pending" : "In Process",
        currentQty: cachedQty,
        pendingOutbound: clearPendingOutbound(job, updatedMov),
        version: (job.version || 1) + 1,
        updatedAt: now,
        updatedBy: input.actor.userName,
        updatedByUserId: input.actor.userId
      };
      writes.push({ collection: "mfr_job_cards", id: jobId, data: updatedJobCard });
    }
  }

  const auditId = newId("AL");
  const audit = {
    id: auditId,
    timestamp: now,
    userId: input.actor.userId,
    userName: input.actor.userName,
    action: "UNDO_MATERIAL_TRANSFER",
    details: `Undid pending movement ${input.movementId} (${originalQty}) from ${movement.fromDepartment} to ${movement.toDepartment} without deleting history.`
  };
  writes.push({ collection: "mfr_audit_logs", id: auditId, data: audit });

  const resultPayload = { success: true, cached: false, movement: updatedMov, returnMovement, updatedJobCard };
  persistIdempotency(writes, opKey, now, input.actor.userId, resultPayload);
  for (const w of writes) await store.set(w.collection, w.id, w.data);
  return { success: true, cached: false, movement: updatedMov, returnMovement, updatedJobCard, audit, writes };
}

export function movementStillInReceiverInbox(movement: any, department: string): boolean {
  if (!movement) return false;
  if (String(movement.toDepartment || "") !== department && String(movement.toDepartment || "").toLowerCase() !== String(department || "").toLowerCase()) {
    return false;
  }
  return isPendingAcceptanceMovement(movement);
}

void creditedInboundQty;
void unresolvedPendingQty;
