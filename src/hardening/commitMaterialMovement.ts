import { VALID_MANUFACTURING_DEPARTMENTS } from "./constants";
import {
  canPurchaseUserOperateIncomingStore,
  createPurchaseInvoiceFingerprint,
  extractPurchaseInvoiceFields,
  isIncomingStoreDept,
  isPurchaseInwardRoute,
  PURCHASE_INVOICE_CLAIM_COLLECTION
} from "./process1Purchase";
import { computeRmRuntimeStock } from "./rmSkuMaster";
import {
  activeStatusWhileRemaining,
  assertHeatTreatmentRouting,
  attachProcess2MovementContract,
  process2SendAvailableQty,
  remainingAtDepartment,
  rmIssueAvailableQty,
  shouldBlockPendingDuplicateRoute,
  shouldRelocateJobOnQuantityMove,
  storeAuthoritativeOnHand
} from "./process2Manufacturing";
import { createMovementRequestFingerprint } from "./movementOperationId";
import { runKeyedSerialized } from "./movementSerialize";
import { assertStoreToPlatingKgOnly, isStoreToPlatingUnitRoute } from "./storePlatingKgOnly";
import {
  assertOtherRawMaterialIssueInput,
  canIssueOtherRawMaterialQty,
  computeIncomingStoreOtherRmStock,
  isOtherRawMaterialIssueMovement,
  otherRawMaterialSerializeKey
} from "./process248OtherRawMaterial";

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
  dispatchGroupNo?: string;
  manifestId?: string;
  extra?: Record<string, any>;
  unit?: string;
  /** Optional preloaded movements to avoid collection list inside a Firestore transaction. */
  preloadedMovements?: any[];
  requireRawMaterialForProduction?: boolean;
  /** Internal server-side supplier receipt; never accepted from client movement routes. */
  isSupplierReceipt?: boolean;
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
  const fromNorm = fromDepartment.toLowerCase();
  if (isIncomingStoreDept(fromDepartment) && canPurchaseUserOperateIncomingStore(actor)) {
    return true;
  }
  return (
    isSuperOrAdmin ||
    userDept === fromNorm ||
    allowed.includes(fromNorm)
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
 * Partial quantity keeps the job pending at the source department until the
 * order is fully produced/sent. Only a remaining-zero send relocates the card.
 */
function purchaseInvoiceClaimFromInput(input: MovementCommitInput, job?: any) {
  if (input.isSupplierReceipt) return null;
  if (!isPurchaseInwardRoute(input.fromDepartment, input.toDepartment, input.isIssueRequest)) return null;
  const fields = extractPurchaseInvoiceFields({
    jobCardNo: input.jobCardNo,
    processDetails: input.processDetails,
    extra: input.extra,
    job
  });
  return createPurchaseInvoiceFingerprint({
    ...fields,
    jobCardNo: input.jobCardNo
  });
}

export async function commitMaterialMovementTx(
  store: SimpleStore,
  input: MovementCommitInput
): Promise<MovementCommitResult> {
  const claim = purchaseInvoiceClaimFromInput(input);
  const otherRmKey =
    input.isIssueRequest && input.processDetails?.isOtherRawMaterialIssue
      ? otherRawMaterialSerializeKey(input.processDetails?.rawMaterialCode)
      : null;
  const serializeKey = otherRmKey
    ? otherRmKey
    : claim && claim.ok
    ? `pinv:${claim.claimId}`
    : `mov:${String(input.jobCardNo || input.operationId || "movement").toUpperCase()}`;
  const run = () => commitMaterialMovementTxInner(store, input);
  if (store.runSerialized) {
    return store.runSerialized(serializeKey, run);
  }
  return runKeyedSerialized(serializeKey, run);
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

  const requestFingerprint = createMovementRequestFingerprint({
    jobCardNo: input.jobCardNo,
    fromDepartment: input.fromDepartment,
    toDepartment: input.toDepartment,
    quantity: input.quantity
  });

  const existingIdemp = await store.get("mfr_idempotency_keys", opKey);
  if (existingIdemp?.result) {
    const storedFp = String(existingIdemp.requestFingerprint || existingIdemp.result?.requestFingerprint || "");
    if (storedFp && storedFp !== requestFingerprint) {
      return {
        success: false,
        statusCode: 409,
        error: "operationId was already used for a different movement request. Use a new operationId for a distinct transfer."
      };
    }
    return { success: true, writes: [], ...existingIdemp.result, cached: true };
  }

  const jobCardNo = String(input.jobCardNo || "").trim();
  const normFrom = normalizeDept(input.fromDepartment);
  const normTo = normalizeDept(input.toDepartment);
  const reqQty = Number(input.quantity);
  const isSupplierReceipt = Boolean(input.isSupplierReceipt);

  if (!jobCardNo || !normFrom || !normTo) {
    return { success: false, statusCode: 400, error: "jobCardNo, fromDepartment, and toDepartment are required." };
  }
  if ((!isSupplierReceipt && !isValidDepartmentName(normFrom)) || !isValidDepartmentName(normTo)) {
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
  if (isSupplierReceipt && (normFrom.toLowerCase() !== "supplier" || normTo.toLowerCase() !== "purchase")) {
    return { success: false, statusCode: 400, error: "Supplier receipts must credit Purchase from Supplier." };
  }
  if (isSupplierReceipt && !isDeptAuthorized(input.actor, "Purchase")) {
    return {
      success: false,
      statusCode: 403,
      error: "Forbidden: only an authorized Purchase user may record supplier receipts."
    };
  }
  if (!isSupplierReceipt && !isDeptAuthorized(input.actor, normFrom)) {
    return {
      success: false,
      statusCode: 403,
      error: `Forbidden: User '${input.actor.userName}' (${input.actor.department}) is not authorized to initiate material movements from '${normFrom}'.`
    };
  }

  const storePlatingUnit = assertStoreToPlatingKgOnly({
    fromDepartment: normFrom,
    toDepartment: normTo,
    unit: input.unit,
    requestedUnit: input.requestedUnit,
    extraUnit: input.extra?.unit ?? input.extra?.requestedUnit,
    processDetailsUnit: input.processDetails?.unit
  });
  if (storePlatingUnit.ok === false) {
    return { success: false, statusCode: 400, error: storePlatingUnit.error };
  }

  const stockIn = isStockInJob(jobCardNo);
  const isIssue = Boolean(input.isIssueRequest);

  let jobCardData: any = null;
  const activeJobId = jobCardNo.toUpperCase();
  let movementsForQty: any[] = input.preloadedMovements || [];
  if (!stockIn) {
    jobCardData = (await store.get("mfr_job_cards", activeJobId)) || (await store.get("mfr_job_cards", jobCardNo));
    if (!jobCardData) {
      return { success: false, statusCode: 404, error: `Job Card '${jobCardNo}' not found.` };
    }

    movementsForQty = input.preloadedMovements || (await store.list("mfr_movements"));
    if (!isIssue && !isSupplierReceipt && shouldBlockPendingDuplicateRoute(movementsForQty, { jobCardNo, fromDepartment: normFrom, toDepartment: normTo, isIssueRequest: isIssue })) {
      return {
        success: false,
        statusCode: 400,
        error: `A transfer request for Job Card ${jobCardNo} from ${normFrom} to ${normTo} is already pending acceptance.`
      };
    }
    if (isSupplierReceipt) {
      if (jobCardData.processType !== "Purchase") {
        return { success: false, statusCode: 400, error: "Supplier receipts require a Purchase job card." };
      }
    } else if (isIssue) {
      const otherRmGate = assertOtherRawMaterialIssueInput({
        fromDepartment: normFrom,
        toDepartment: normTo,
        isIssueRequest: isIssue,
        quantity: reqQty,
        unit: input.unit,
        requestedUnit: input.requestedUnit,
        processDetails: input.processDetails
      });
      if (otherRmGate.ok === false) {
        return { success: false, statusCode: 400, error: otherRmGate.error };
      }
      let issueAvail = 0;
      if (normFrom === "Raw Material Store") {
        const skuCode = String(
          input.processDetails?.rawMaterialCode ||
            input.extra?.processDetails?.rawMaterialCode ||
            jobCardData?.itemCode ||
            ""
        ).trim();
        let opening = 0;
        if (skuCode) {
          const sku =
            (await store.get("mfr_rm_sku_master", skuCode.toUpperCase())) ||
            (await store.get("mfr_rm_sku_master", skuCode));
          opening = Number(sku?.openingQty || 0);
        }
        issueAvail = rmIssueAvailableQty(jobCardData, movementsForQty, skuCode, opening);
      } else if (isOtherRawMaterialIssueMovement({ ...input, fromDepartment: normFrom, toDepartment: normTo })) {
        const skuCode = String(input.processDetails?.rawMaterialCode || "").trim();
        let opening = 0;
        if (skuCode) {
          const sku =
            (await store.get("mfr_rm_sku_master", skuCode.toUpperCase())) ||
            (await store.get("mfr_rm_sku_master", skuCode));
          opening = Number(sku?.openingQty || 0);
        }
        issueAvail = computeIncomingStoreOtherRmStock(opening, movementsForQty, skuCode);
        const stockGate = canIssueOtherRawMaterialQty(issueAvail, reqQty, input.unit || input.requestedUnit || input.processDetails?.unit);
        if (!stockGate.ok) {
          return { success: false, statusCode: 400, error: stockGate.error };
        }
      } else if (normFrom === "Store") {
        issueAvail = storeAuthoritativeOnHand(jobCardData, movementsForQty);
      } else {
        issueAvail = remainingAtDepartment(jobCardData, movementsForQty, normFrom);
      }
      if (reqQty > issueAvail) {
        return {
          success: false,
          statusCode: 400,
          error: `Insufficient available quantity. Requested ${reqQty}, but only ${issueAvail} remaining for issue from ${normFrom}.`
        };
      }
    } else {
      const sendAvail = process2SendAvailableQty(normFrom, jobCardData, movementsForQty, {
        compulsory: input.requireRawMaterialForProduction
      });
      if (sendAvail !== null && reqQty > sendAvail) {
        return {
          success: false,
          statusCode: 400,
          error: `Insufficient available quantity. Requested ${reqQty}, but only ${sendAvail} remaining in ${normFrom}.`
        };
      }
    }

    const htGate = assertHeatTreatmentRouting(jobCardData, normFrom, normTo, {
      isIssueRequest: isIssue,
      isRejectionReturn: Boolean(input.processDetails?.isRejectionReturn)
    });
    if (!htGate.ok) {
      return { success: false, statusCode: 400, error: htGate.error };
    }
  }

  const invoiceClaim = purchaseInvoiceClaimFromInput(input, jobCardData);
  if (isPurchaseInwardRoute(normFrom, normTo, isIssue) && !isSupplierReceipt) {
    if (!invoiceClaim || !invoiceClaim.ok) {
      return {
        success: false,
        statusCode: 400,
        error: invoiceClaim && "error" in invoiceClaim ? invoiceClaim.error : "Purchase invoice identity is required."
      };
    }
    const existingClaim = await store.get(PURCHASE_INVOICE_CLAIM_COLLECTION, invoiceClaim.claimId);
    if (existingClaim) {
      if (String(existingClaim.operationId || "") === opKey) {
        const claimedMov =
          (await store.get("mfr_movements", existingClaim.movementId)) || existingClaim.movement || null;
        return {
          success: true,
          cached: true,
          movement: claimedMov,
          updatedJobCard: jobCardData,
          writes: []
        };
      }
      return {
        success: false,
        statusCode: 409,
        error: "Duplicate purchase invoice/receipt. This invoice was already credited."
      };
    }
  }

  let movId = input.movementId || (isSupplierReceipt
    ? `M-SUPPLIER-RECEIPT-${opKey}`
    : `M-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
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
  const contracted = attachProcess2MovementContract(
    {
      ...(input.extra || {}),
      jobCardNo: jobCardData?.jobCardNo || jobCardNo,
      fromDepartment: normFrom,
      toDepartment: normTo,
      quantity: reqQty,
      processDetails: input.processDetails || {}
    },
    jobCardData
  );
  const movement = {
    ...contracted,
    movementId: movId,
    jobCardNo: jobCardData?.jobCardNo || jobCardNo,
    fromDepartment: normFrom,
    toDepartment: normTo,
    quantity: reqQty,
    transferDate: now,
    transferBy: input.actor.userName,
    initiatedByUserId: input.actor.userId,
    initiatedByUserName: input.actor.userName,
    accepted: isSupplierReceipt,
    acceptedQty: isSupplierReceipt ? reqQty : 0,
    rejectedQty: 0,
    unit: isStoreToPlatingUnitRoute(normFrom, normTo)
      ? storePlatingUnit.unit
      : contracted.unit || jobCardData?.unit || input.requestedUnit || "KGS",
    transactionType: input.transactionType || (isSupplierReceipt ? "PURCHASE_RECEIPT" : isIssue ? "ISSUE_REQUEST" : "TRANSFER"),
    operationId: opKey,
    isIssueRequest: isIssue,
    issueStatus: isIssue ? "Requested" : undefined,
    remarks: input.remarks || "",
    processDetails: {
      ...(contracted.processDetails || input.processDetails || {}),
      ...(isSupplierReceipt ? { isSupplierReceipt: true } : {}),
      ...(invoiceClaim && invoiceClaim.ok
        ? { purchaseInvoiceFingerprint: invoiceClaim.fingerprint, purchaseInvoiceClaimId: invoiceClaim.claimId }
        : {})
    },
    requestedQty: input.requestedQty,
    requestedUnit: input.requestedUnit,
    dispatchGroupNo: input.dispatchGroupNo || (input.extra?.dispatchGroupNo as string) || undefined,
    manifestId: input.manifestId || (input.extra?.manifestId as string) || undefined,
    createdAt: now
  };

  let updatedJobCard: any = null;
  if (jobCardData && !isIssue && !stockIn && !isSupplierReceipt) {
    const nextVersion = (jobCardData.version || 1) + 1;
    const pendingOutbound = Array.isArray(jobCardData.pendingOutbound) ? [...jobCardData.pendingOutbound] : [];
    pendingOutbound.push({ from: normFrom, to: normTo, movementId: movId });
    const projectedMoves = [...movementsForQty, movement];
    const relocate = shouldRelocateJobOnQuantityMove(jobCardData, projectedMoves, normFrom, {
      compulsory: input.requireRawMaterialForProduction
    });
    // Do not decrement currentQty on send. Partial qty keeps the job pending at source.
    updatedJobCard = relocate
      ? {
          ...jobCardData,
          currentDepartment: normTo,
          status: "Pending Acceptance",
          version: nextVersion,
          pendingOutbound,
          updatedAt: now,
          updatedBy: input.actor.userName,
          updatedByUserId: input.actor.userId
        }
      : {
          ...jobCardData,
          currentDepartment: jobCardData.currentDepartment || normFrom,
          status: activeStatusWhileRemaining(jobCardData, normFrom),
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
      requestFingerprint,
      createdAt: now,
      userId: input.actor.userId,
      result: resultPayload
    }
  });
  if (invoiceClaim && invoiceClaim.ok) {
    writes.push({
      collection: PURCHASE_INVOICE_CLAIM_COLLECTION,
      id: invoiceClaim.claimId,
      data: {
        claimId: invoiceClaim.claimId,
        fingerprint: invoiceClaim.fingerprint,
        operationId: opKey,
        movementId: movId,
        jobCardNo: movement.jobCardNo,
        quantity: reqQty,
        createdAt: now,
        userId: input.actor.userId
      }
    });
  }

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
  if (toDepartment === "Incoming Store") return "Stored";
  return "In Process";
}
