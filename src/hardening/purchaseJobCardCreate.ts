import { commitMaterialMovementTx, SimpleStore } from "./commitMaterialMovement";
import {
  createPurchaseCreationFingerprint,
  RAW_MATERIAL_STORE,
  resolveInitialPurchaseRoute,
  resolveJobCurrentQtyOnCreate,
  shouldCreateInitialMovement,
  validatePurchaseReceiptInput
} from "./process1Purchase";

export async function createPurchaseJobInwardTx(
  store: SimpleStore,
  input: {
    jobCard: any;
    actor: {
      userId: string;
      userName: string;
      role: string;
      department: string;
      allowedDepartments: string[];
      accessList: string[];
    };
    operationId?: string;
    nowIso?: string;
  }
): Promise<{
  success: boolean;
  cached?: boolean;
  statusCode?: number;
  error?: string;
  jobCard?: any;
  movement?: any | null;
}> {
  const jobCard = input.jobCard || {};
  const validation = validatePurchaseReceiptInput(jobCard);
  if (!validation.ok) {
    return { success: false, statusCode: 400, error: validation.error };
  }

  const materialType = jobCard.materialType;
  if (materialType !== "Raw Material" && materialType !== "Semi Finished Goods" && materialType !== "Finished Goods") {
    return { success: false, statusCode: 400, error: "Purchase materialType must be Raw Material, Semi Finished Goods, or Finished Goods." };
  }

  const route = resolveInitialPurchaseRoute({
    materialType,
    rawMaterialKind: jobCard.rawMaterialKind ?? jobCard.purchaseDetails?.rawMaterialKind,
    isWire: jobCard.isWire ?? jobCard.purchaseDetails?.isWire,
    selectedDestination: jobCard.currentDepartment
  });
  if (route.error) {
    return { success: false, statusCode: 400, error: route.error };
  }

  const upperJobNo = String(jobCard.jobCardNo || "").toUpperCase().trim();
  if (!upperJobNo) {
    return { success: false, statusCode: 400, error: "jobCardNo is required." };
  }

  const destDept = route.destination;
  const fingerprint = createPurchaseCreationFingerprint({
    ...jobCard,
    jobCardNo: upperJobNo,
    isWire: route.isWire,
    rawMaterialKind: route.rawMaterialKind,
    currentDepartment: destDept
  });

  const existingJob = (await store.get("mfr_job_cards", upperJobNo)) || (await store.get("mfr_job_cards", jobCard.jobCardNo));
  if (existingJob) {
    const existingFingerprint = String(existingJob.purchaseCreationFingerprint || createPurchaseCreationFingerprint(existingJob));
    if (existingFingerprint !== fingerprint) {
      return {
        success: false,
        statusCode: 409,
        error: "Purchase job already exists with different immutable receipt data."
      };
    }
    const movements = await store.list("mfr_movements");
    const existingMov = movements.find(
      (m) =>
        String(m.jobCardNo || "").toUpperCase() === upperJobNo &&
        String(m.fromDepartment || "").toLowerCase() === "purchase"
    );
    return { success: true, cached: true, jobCard: existingJob, movement: existingMov || null };
  }

  const now = input.nowIso || new Date().toISOString();
  const numOrderQty = Number(jobCard.orderQty);
  const sentQty = resolveJobCurrentQtyOnCreate(jobCard.currentQty, numOrderQty);
  const newJob = {
    ...jobCard,
    jobCardNo: upperJobNo,
    orderQty: numOrderQty,
    currentQty: sentQty,
    currentDepartment: destDept,
    status: jobCard.status || "Pending Acceptance",
    isWire: materialType === "Raw Material" ? route.isWire : undefined,
    rawMaterialKind: route.rawMaterialKind || undefined,
    materialType,
    version: 1,
    createdAt: now,
    completed: false,
    purchaseCreationFingerprint: fingerprint
  };

  await store.set("mfr_job_cards", upperJobNo, newJob);

  const fromDept = "Purchase";
  const createInitialMov = shouldCreateInitialMovement(fromDept, destDept);
  if (!createInitialMov) {
    return { success: true, cached: false, jobCard: newJob, movement: null };
  }

  const opKey = String(input.operationId || "").trim() || `purchase-inward-${upperJobNo}`;
  const result = await commitMaterialMovementTx(store, {
    operationId: opKey,
    movementId: `M-PURCHASE-INITIAL-${upperJobNo}`,
    jobCardNo: upperJobNo,
    fromDepartment: fromDept,
    toDepartment: destDept,
    quantity: sentQty,
    processDetails: {
      materialType,
      unit: jobCard.unit,
      isWire: route.isWire,
      rawMaterialKind: route.rawMaterialKind,
      rawMaterialCode: jobCard.itemCode,
      rawMaterialName: jobCard.itemName,
      supplierName: jobCard.purchaseDetails?.supplierName || jobCard.partyName,
      billNo: jobCard.purchaseDetails?.billNo
    },
    extra: {
      itemCode: jobCard.itemCode,
      itemName: jobCard.itemName,
      materialType,
      isWire: route.isWire,
      unit: jobCard.unit
    },
    actor: input.actor,
    nowIso: now
  });

  if (!result.success) {
    return { success: false, statusCode: result.statusCode || 400, error: result.error };
  }

  const refreshed = (await store.get("mfr_job_cards", upperJobNo)) || newJob;
  return {
    success: true,
    cached: Boolean(result.cached),
    jobCard: result.updatedJobCard || refreshed,
    movement: result.movement
  };
}

export function purchaseJobRoutesToRawMaterialStore(isWire: boolean): string {
  return isWire ? RAW_MATERIAL_STORE : "Incoming Store";
}
