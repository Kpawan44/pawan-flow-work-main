import { VALID_MANUFACTURING_DEPARTMENTS } from "./constants";

export interface MovementCommitInput {
  operationId: string;
  movementId?: string;
  jobCardNo: string;
  fromDepartment: string;
  toDepartment: string;
  quantity: number;
  remarks?: string;
  processDetails?: any;
  isIssueRequest?: boolean;
  requestedQty?: number;
  requestedUnit?: string;
  transactionType?: string;
  extra?: Record<string, any>;
  /** Optional preloaded movements to avoid collection list inside a Firestore transaction. */
  preloadedMovements?: any[];
  actor: {
    userId: string;
    userName: string;
    role: string;
    department: string;
    allowedDepartments: string[];
    accessList: string[];
  };
  nowIso?: string;
}

export interface MovementCommitResult {
  success: boolean;
  cached?: boolean;
  error?: string;
  statusCode?: number;
  movement?: any;
  updatedJobCard?: any | null;
  audit?: any;
  notification?: any;
  writes?: Array<{ collection: string; id: string; data: any }>;
}

export interface SimpleStore {
  get(collection: string, id: string): Promise<any | null>;
  set(collection: string, id: string, data: any): Promise<void>;
  list(collection: string): Promise<any[]>;
  runSerialized?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}

function normalizeDept(d: string): string {
  return String(d || "").trim();
}

export function isDeptAuthorized(actor: MovementCommitInput["actor"], fromDepartment: string): boolean {
  const userRole = String(actor.role || "staff").toLowerCase();
  const userDept = String(actor.department || "").toLowerCase();
  const allowed = [
    ...(Array.isArray(actor.allowedDepartments) ? actor.allowedDepartments : []),
    ...(Array.isArray(actor.accessList) ? actor.accessList : [])
  ].map((d) => String(d).toLowerCase());
  const isSuperOrAdmin =
    userRole === "super_admin" ||
    userRole === "admin" ||
    userDept === "admin" ||
    userDept === "management";
  return (
    isSuperOrAdmin ||
    userDept === fromDepartment.toLowerCase() ||
    allowed.includes(fromDepartment.toLowerCase())
  );
}

export function isValidDepartmentName(name: string): boolean {
  return VALID_MANUFACTURING_DEPARTMENTS.some((d) => d.toLowerCase() === name.toLowerCase());
}

export function isStockInJob(jobCardNo: string): boolean {
  return String(jobCardNo || "").toUpperCase().startsWith("STOCK-IN-");
}

export function isWireRejection(input: MovementCommitInput): boolean {
  return Boolean(input.processDetails?.isWireRejection) || input.transactionType === "ADJUSTMENT";
}

/**
 * Authoritative movement commit. Does NOT decrement currentQty on send.
 * Sets job status Pending Acceptance and currentDepartment = toDepartment for normal transfers.
 */
export async function commitMaterialMovementTx(
  store: SimpleStore,
  input: MovementCommitInput
): Promise<MovementCommitResult> {
  const serializeKey = String(input.jobCardNo || input.operationId || "movement").toUpperCase();
  if (store.runSerialized) {
    return store.runSerialized(`mov:${serializeKey}`, () => commitMaterialMovementTxInner(store, input));
  }
  return commitMaterialMovementTxInner(store, input);
}

async function commitMaterialMovementTxInner(
  store: SimpleStore,
  input: MovementCommitInput
): Promise<MovementCommitResult> {
  const now = input.nowIso || new Date().toISOString();
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return { success: false, statusCode: 400, error: "operationId is required." };
  }

  const existingIdemp = await store.get("mfr_idempotency_keys", opKey);
  if (existingIdemp?.result) {
    return { success: true, writes: [], ...existingIdemp.result, cached: true };
  }

  const jobCardNo = String(input.jobCardNo || "").trim();
  const normFrom = normalizeDept(input.fromDepartment);
  const normTo = normalizeDept(input.toDepartment);
  const reqQty = Number(input.quantity);

  if (!jobCardNo || !normFrom || !normTo) {
    return { success: false, statusCode: 400, error: "jobCardNo, fromDepartment, and toDepartment are required." };
  }
  if (!isValidDepartmentName(normFrom) || !isValidDepartmentName(normTo)) {
    return {
      success: false,
      statusCode: 400,
      error: `Invalid department specified. Must be one of: ${VALID_MANUFACTURING_DEPARTMENTS.join(", ")}`
    };
  }
  if (isNaN(reqQty) || !isFinite(reqQty) || reqQty <= 0) {
    return { success: false, statusCode: 400, error: "Movement quantity must be a positive number greater than 0." };
  }
  if (normFrom.toLowerCase() === normTo.toLowerCase() && !isWireRejection(input)) {
    return { success: false, statusCode: 400, error: "Source and target departments cannot be identical." };
  }
  if (!isDeptAuthorized(input.actor, normFrom)) {
    return {
      success: false,
      statusCode: 403,
      error: `Forbidden: User '${input.actor.userName}' (${input.actor.department}) is not authorized to initiate material movements from '${normFrom}'.`
    };
  }

  const stockIn = isStockInJob(jobCardNo);
  const isIssue = Boolean(input.isIssueRequest);

  let jobCardData: any = null;
  const activeJobId = jobCardNo.toUpperCase();
  if (!stockIn) {
    jobCardData = (await store.get("mfr_job_cards", activeJobId)) || (await store.get("mfr_job_cards", jobCardNo));
    if (!jobCardData) {
      return { success: false, statusCode: 404, error: `Job Card '${jobCardNo}' not found.` };
    }

    if (!isIssue && normFrom !== "Purchase" && normFrom !== "Raw Material Store") {
      const currentAvailableQty = Number(jobCardData.currentQty ?? jobCardData.orderQty ?? 0);
      if (reqQty > currentAvailableQty) {
        return {
          success: false,
          statusCode: 400,
          error: `Insufficient available quantity. Requested ${reqQty} KG, but only ${currentAvailableQty} KG available in ${normFrom}.`
        };
      }
    }

    if (!isIssue && !stockIn) {
      const pendingOutbound = Array.isArray(jobCardData.pendingOutbound) ? jobCardData.pendingOutbound : [];
      const pendingOnJob = pendingOutbound.find(
        (p: any) => p && p.from === normFrom && p.to === normTo
      );
      const movements = input.preloadedMovements || (await store.list("mfr_movements"));
      const pendingDup =
        pendingOnJob ||
        movements.find(
          (m) =>
            !m.accepted &&
            !m.deletedDate &&
            String(m.jobCardNo || "").toLowerCase() === jobCardNo.toLowerCase() &&
            m.fromDepartment === normFrom &&
            m.toDepartment === normTo
        );
      if (pendingDup) {
        return {
          success: false,
          statusCode: 400,
          error: `A transfer request for Job Card ${jobCardNo} from ${normFrom} to ${normTo} is already pending acceptance.`
        };
      }
    }
  }

  let movId = input.movementId || `M-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const existingMov = await store.get("mfr_movements", movId);
  if (existingMov) {
    if (existingMov.operationId && existingMov.operationId === opKey) {
      return { success: true, cached: true, movement: existingMov, updatedJobCard: jobCardData, writes: [] };
    }
    return {
      success: false,
      statusCode: 409,
      error: `Movement ID '${movId}' already exists.`
    };
  }
  const movement = {
    ...(input.extra || {}),
    movementId: movId,
    jobCardNo: jobCardData?.jobCardNo || jobCardNo,
    fromDepartment: normFrom,
    toDepartment: normTo,
    quantity: reqQty,
    transferDate: now,
    transferBy: input.actor.userName,
    initiatedByUserId: input.actor.userId,
    initiatedByUserName: input.actor.userName,
    accepted: false,
    operationId: opKey,
    isIssueRequest: isIssue,
    issueStatus: isIssue ? "Requested" : undefined,
    remarks: input.remarks || "",
    processDetails: input.processDetails || null,
    requestedQty: input.requestedQty,
    requestedUnit: input.requestedUnit,
    transactionType: input.transactionType,
    createdAt: now
  };

  let updatedJobCard: any = null;
  if (jobCardData && !isIssue && !stockIn) {
    const nextVersion = (jobCardData.version || 1) + 1;
    const pendingOutbound = Array.isArray(jobCardData.pendingOutbound) ? [...jobCardData.pendingOutbound] : [];
    pendingOutbound.push({ from: normFrom, to: normTo, movementId: movId });
    updatedJobCard = {
      ...jobCardData,
      currentDepartment: normTo,
      status: "Pending Acceptance",
      version: nextVersion,
      pendingOutbound,
      updatedAt: now,
      updatedBy: input.actor.userName,
      updatedByUserId: input.actor.userId
    };
  }

  const auditId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const audit = {
    id: auditId,
    timestamp: now,
    userId: input.actor.userId,
    userName: input.actor.userName,
    action: "MATERIAL_TRANSFER",
    details: `Transferred ${reqQty} KG of Job Card ${movement.jobCardNo} from ${normFrom} to ${normTo}`
  };

  const isRawStoreReq = isIssue && normFrom === "Raw Material Store";
  const notifId = `N-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const notification = {
    notificationId: notifId,
    department: isRawStoreReq ? "Raw Material Store" : isIssue ? "Store" : normTo === "Completed" ? "Dispatch" : normTo,
    title: isRawStoreReq ? "Raw Material Request" : isIssue ? "Dispatch Issue Request" : "Material Sent",
    message: isRawStoreReq
      ? `Job Card ${movement.jobCardNo}: Production requested raw material of ${input.requestedQty || reqQty} KG.`
      : isIssue
        ? `Job Card ${movement.jobCardNo}: Dispatch requested issue of ${input.requestedQty || reqQty} ${input.requestedUnit || "KG"} from Store.`
        : `Job Card ${movement.jobCardNo}: ${reqQty} KG transferred from ${normFrom} to ${normTo}.`,
    userId: isRawStoreReq
      ? "all_raw_material_store"
      : isIssue
        ? "all_store"
        : `all_${normTo.toLowerCase().replace(/\s+/g, "_")}`,
    read: false,
    createdAt: now
  };

  const writes: MovementCommitResult["writes"] = [
    { collection: "mfr_movements", id: movId, data: movement }
  ];
  if (updatedJobCard) {
    writes.push({ collection: "mfr_job_cards", id: activeJobId, data: updatedJobCard });
  }
  writes.push({ collection: "mfr_audit_logs", id: auditId, data: audit });
  writes.push({ collection: "mfr_notifications", id: notifId, data: notification });

  if (stockIn) {
    const code = jobCardNo.replace(/^STOCK-IN-/i, "").trim();
    if (code) {
      const existingSku = await store.get("mfr_rm_sku_master", code);
      if (!existingSku) {
        writes.push({
          collection: "mfr_rm_sku_master",
          id: code,
          data: {
            code,
            name: code,
            category: "",
            unit: "KG",
            location: "",
            openingQty: 0,
            openingCapturedAt: now
          }
        });
      }
    }
  }

  const resultPayload = {
    success: true,
    cached: false,
    movement,
    updatedJobCard,
    updatedJobCardVersion: updatedJobCard?.version
  };
  writes.push({
    collection: "mfr_idempotency_keys",
    id: opKey,
    data: {
      operationId: opKey,
      createdAt: now,
      userId: input.actor.userId,
      result: resultPayload
    }
  });

  for (const w of writes) {
    await store.set(w.collection, w.id, w.data);
  }

  return {
    success: true,
    cached: false,
    movement,
    updatedJobCard,
    audit,
    notification,
    writes
  };
}

export function applyAcceptanceDepartment(movement: { toDepartment?: string }): string | undefined {
  return movement.toDepartment;
}

export function clearPendingOutbound(jobCard: any, movement: { movementId?: string; fromDepartment?: string; toDepartment?: string }): any[] {
  const pending = Array.isArray(jobCard?.pendingOutbound) ? jobCard.pendingOutbound : [];
  return pending.filter(
    (p: any) =>
      p &&
      p.movementId !== movement.movementId &&
      !(p.from === movement.fromDepartment && p.to === movement.toDepartment)
  );
}

export function nextStatusOnAccept(toDepartment: string): string {
  if (toDepartment === "Production") return "Pending";
  if (toDepartment === "Completed") return "Completed";
  return "In Process";
}
