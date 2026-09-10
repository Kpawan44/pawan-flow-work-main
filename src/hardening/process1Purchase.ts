/**
 * Process 1 — Purchase receiving, classification, and initial routing.
 * Isolated helpers so tests can run without Firestore.
 */

export type PurchaseMaterialType = "Raw Material" | "Semi Finished Goods" | "Finished Goods";
export type RawMaterialKind = "Wire" | "Other";
export type PurchaseUnit = "KGS" | "PCS";

export const INCOMING_STORE = "Incoming Store";
export const RAW_MATERIAL_STORE = "Raw Material Store";

const SFG_DESTINATIONS = ["Production", "Heat Treatment", "Plating", INCOMING_STORE] as const;
const FG_DESTINATIONS = ["Dispatch", "Store"] as const;

export function normalizeDeptName(value: string | undefined | null): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeItemCode(value: string | undefined | null): string {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "-") return "-";
  return trimmed.toUpperCase();
}

export function codesEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizeItemCode(a);
  const nb = normalizeItemCode(b);
  if (na === "-" || nb === "-") return na === nb && na !== "-";
  return na === nb;
}

export function sanitizeDecimalInput(raw: string): string {
  const cleaned = String(raw || "").replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

export function parseDecimalQuantity(raw: unknown): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return NaN;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function preserveQuantity(n: number): number {
  return Number(n);
}

export function normalizeRawMaterialKind(value: unknown): RawMaterialKind | null {
  const s = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (s === "wire" || s === "iswire" || s === "true" || s === "rm wire") return "Wire";
  if (s === "other" || s === "other raw material" || s === "other rm" || s === "false" || s === "non wire" || s === "nonwire") {
    return "Other";
  }
  return null;
}

export function isWireRawMaterial(flags: {
  isWire?: unknown;
  rawMaterialKind?: unknown;
  processDetails?: any;
}): boolean {
  if (flags.isWire === true) return true;
  if (flags.isWire === false) return false;
  const nested = flags.processDetails || {};
  if (nested.isWire === true) return true;
  if (nested.isWire === false) return false;
  const kind = normalizeRawMaterialKind(flags.rawMaterialKind ?? nested.rawMaterialKind);
  return kind === "Wire";
}

export function unitForMaterialType(
  materialType: PurchaseMaterialType,
  selectedUnit?: string | null
): PurchaseUnit {
  if (materialType === "Finished Goods") {
    const u = String(selectedUnit || "KGS").trim().toUpperCase();
    if (u === "PCS" || u === "PC" || u === "PIECES") return "PCS";
    return "KGS";
  }
  return "KGS";
}

export function displayUnitLabel(unit?: string | null): string {
  const u = String(unit || "KGS").trim().toUpperCase();
  if (u === "PCS" || u === "PC" || u === "PIECES") return "PCS";
  return "KG";
}

export function isIncomingStoreDept(dept?: string | null): boolean {
  return normalizeDeptName(dept) === normalizeDeptName(INCOMING_STORE);
}

export function allowedInitialDestinations(
  materialType: PurchaseMaterialType,
  rawMaterialKind?: RawMaterialKind | null
): string[] {
  if (materialType === "Raw Material") {
    return rawMaterialKind === "Wire" ? [RAW_MATERIAL_STORE] : [INCOMING_STORE];
  }
  if (materialType === "Semi Finished Goods") return [...SFG_DESTINATIONS];
  return [...FG_DESTINATIONS];
}

export function isDirectDispatchAllowed(materialType: PurchaseMaterialType): boolean {
  return materialType === "Finished Goods";
}

function matchAllowed(selected: string | undefined | null, allowed: readonly string[]): string | null {
  const n = normalizeDeptName(selected);
  if (!n) return null;
  const hit = allowed.find((d) => normalizeDeptName(d) === n);
  return hit || null;
}

export interface ResolvePurchaseRouteInput {
  materialType: PurchaseMaterialType;
  rawMaterialKind?: unknown;
  isWire?: unknown;
  selectedDestination?: string | null;
}

export interface ResolvePurchaseRouteResult {
  destination: string;
  rawMaterialKind: RawMaterialKind | null;
  isWire: boolean;
  error?: string;
}

export function resolveInitialPurchaseRoute(input: ResolvePurchaseRouteInput): ResolvePurchaseRouteResult {
  const materialType = input.materialType;
  if (materialType === "Raw Material") {
    const kind =
      normalizeRawMaterialKind(input.rawMaterialKind) ||
      (input.isWire === true ? "Wire" : input.isWire === false ? "Other" : null);
    if (!kind) {
      return {
        destination: INCOMING_STORE,
        rawMaterialKind: null,
        isWire: false,
        error: "Select Wire or Other Raw Material."
      };
    }
    const destination = kind === "Wire" ? RAW_MATERIAL_STORE : INCOMING_STORE;
    const override = matchAllowed(input.selectedDestination, [destination]);
    return {
      destination: override || destination,
      rawMaterialKind: kind,
      isWire: kind === "Wire"
    };
  }

  if (materialType === "Semi Finished Goods") {
    const matched = matchAllowed(input.selectedDestination, SFG_DESTINATIONS);
    return {
      destination: matched || "Production",
      rawMaterialKind: null,
      isWire: false
    };
  }

  const matched = matchAllowed(input.selectedDestination, FG_DESTINATIONS);
  return {
    destination: matched || "Store",
    rawMaterialKind: null,
    isWire: false
  };
}

export function shouldCreateInitialMovement(fromDepartment: string, toDepartment: string): boolean {
  const from = normalizeDeptName(fromDepartment);
  const to = normalizeDeptName(toDepartment);
  if (!from || !to) return false;
  return from !== to;
}

export function purchaseNotificationDepartment(toDepartment: string): string {
  const to = String(toDepartment || "").trim();
  if (!to || isIncomingStoreDept(to)) return INCOMING_STORE;
  if (normalizeDeptName(to) === "completed") return "Dispatch";
  return to;
}

export interface PurchaseMovementContract {
  itemCode: string;
  itemName: string;
  materialType: PurchaseMaterialType;
  unit: PurchaseUnit;
  quantity: number;
  fromDepartment: string;
  toDepartment: string;
  accepted: boolean;
  jobCardNo: string;
  isWire?: boolean;
  rawMaterialKind?: RawMaterialKind;
  rawMaterialCode?: string;
  rawMaterialName?: string;
  supplierName?: string;
  billNo?: string;
  processDetails: Record<string, any>;
}

export function buildPurchaseMovementContract(input: {
  jobCardNo: string;
  itemCode?: string | null;
  itemName?: string | null;
  materialType: PurchaseMaterialType;
  unit?: string | null;
  quantity: number;
  fromDepartment?: string;
  toDepartment: string;
  accepted?: boolean;
  isWire?: boolean;
  rawMaterialKind?: RawMaterialKind | null;
  supplierName?: string;
  billNo?: string;
  extraProcessDetails?: Record<string, any>;
}): PurchaseMovementContract {
  const itemCode = normalizeItemCode(input.itemCode);
  const itemName = String(input.itemName || "").trim();
  const unit = unitForMaterialType(input.materialType, input.unit);
  const isWire = input.materialType === "Raw Material" ? Boolean(input.isWire) : false;
  const rawMaterialKind: RawMaterialKind | undefined =
    input.materialType === "Raw Material" ? (isWire ? "Wire" : "Other") : undefined;
  const processDetails: Record<string, any> = {
    ...(input.extraProcessDetails || {}),
    materialType: input.materialType,
    unit,
    itemCode,
    itemName
  };
  if (input.materialType === "Raw Material") {
    processDetails.isWire = isWire;
    processDetails.rawMaterialKind = rawMaterialKind;
    processDetails.rawMaterialCode = itemCode;
    processDetails.rawMaterialName = itemName;
  }
  if (input.supplierName) processDetails.supplierName = input.supplierName;
  if (input.billNo) processDetails.billNo = input.billNo;

  return {
    itemCode,
    itemName,
    materialType: input.materialType,
    unit,
    quantity: preserveQuantity(input.quantity),
    fromDepartment: input.fromDepartment || "Purchase",
    toDepartment: input.toDepartment,
    accepted: Boolean(input.accepted),
    jobCardNo: String(input.jobCardNo || "").trim(),
    isWire: input.materialType === "Raw Material" ? isWire : undefined,
    rawMaterialKind,
    rawMaterialCode: input.materialType === "Raw Material" ? itemCode : undefined,
    rawMaterialName: input.materialType === "Raw Material" ? itemName : undefined,
    supplierName: input.supplierName,
    billNo: input.billNo,
    processDetails
  };
}

export function isHeldInIncomingStore(job: {
  completed?: boolean;
  currentDepartment?: string;
  status?: string;
  materialType?: string;
  processType?: string;
}): boolean {
  if (job.completed) return false;
  if (!isIncomingStoreDept(job.currentDepartment)) return false;
  if (String(job.status || "") === "Pending Acceptance") return false;
  if (String(job.materialType || "") === "Finished Goods") return false;
  return true;
}

export function incomingStoreAvailableQty(
  jobs: Array<{ currentQty?: number; orderQty?: number; completed?: boolean; currentDepartment?: string; status?: string; materialType?: string }>
): number {
  // Display/cache helper only. Never inflate with orderQty. Transfer auth uses remainingAtDepartment / process2SendAvailableQty.
  return jobs.filter(isHeldInIncomingStore).reduce((sum, j) => sum + Number(j.currentQty || 0), 0);
}

export function isVisibleInProductionQueue(job: {
  completed?: boolean;
  currentDepartment?: string;
  status?: string;
  processType?: string;
}): boolean {
  if (job.completed) return false;
  if (String(job.status || "") === "Pending Acceptance") return false;
  return normalizeDeptName(job.currentDepartment) === "production";
}

export function isVisibleInDepartmentQueue(
  department: string,
  job: { completed?: boolean; currentDepartment?: string; status?: string }
): boolean {
  if (job.completed) return false;
  if (String(job.status || "") === "Pending Acceptance") return false;
  return normalizeDeptName(job.currentDepartment) === normalizeDeptName(department);
}

export function availableQtyFromAcceptedMovements(
  movements: Array<{ accepted?: boolean; quantity?: number; toDepartment?: string; fromDepartment?: string }>,
  toDepartment: string
): number {
  const dest = normalizeDeptName(toDepartment);
  return movements
    .filter((m) => m.accepted && normalizeDeptName(m.toDepartment) === dest)
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

export function unacceptedQtyDoesNotCount(
  movements: Array<{ accepted?: boolean; quantity?: number; toDepartment?: string }>,
  toDepartment: string
): number {
  return availableQtyFromAcceptedMovements(movements, toDepartment);
}

export function canPurchaseUserOperateIncomingStore(actor: {
  department?: string;
  role?: string;
  allowedDepartments?: string[];
  accessList?: string[];
}): boolean {
  const role = String(actor.role || "").toLowerCase();
  const dept = normalizeDeptName(actor.department);
  if (role === "super_admin" || role === "admin" || dept === "admin" || dept === "management") return true;
  if (dept === "purchase" || dept === "incoming store") return true;
  const allowed = [...(actor.allowedDepartments || []), ...(actor.accessList || [])].map((d) => normalizeDeptName(d));
  return allowed.includes("purchase") || allowed.includes("incoming store");
}

export function nextStatusOnPurchaseAccept(toDepartment: string): string {
  if (normalizeDeptName(toDepartment) === "production") return "Pending";
  if (normalizeDeptName(toDepartment) === "completed") return "Completed";
  if (isIncomingStoreDept(toDepartment)) return "Stored";
  return "In Process";
}

export function applyLocalAcceptance<T extends { accepted?: boolean; toDepartment?: string; quantity?: number }>(
  movement: T,
  job?: { currentDepartment?: string; status?: string; currentQty?: number } | null
): { movement: T; job?: any } {
  const acceptedMov = { ...movement, accepted: true };
  if (!job) return { movement: acceptedMov };
  return {
    movement: acceptedMov,
    job: {
      ...job,
      currentDepartment: movement.toDepartment,
      status: nextStatusOnPurchaseAccept(String(movement.toDepartment || "")),
      currentQty: Number(movement.quantity)
    }
  };
}

export function resolveJobCurrentQtyOnCreate(sentQty: unknown, orderQty: unknown): number {
  const sent = parseDecimalQuantity(sentQty);
  if (!isNaN(sent) && sent > 0) return sent;
  const order = parseDecimalQuantity(orderQty);
  return isNaN(order) ? 0 : order;
}

export interface PurchaseReceiptValidationResult {
  ok: boolean;
  receivedQty?: number;
  rejectionQty?: number;
  creditedQty?: number;
  sentQty?: number;
  error?: string;
}

export function validatePurchaseReceiptInput(job: {
  partyName?: unknown;
  itemName?: unknown;
  materialType?: unknown;
  currentQty?: unknown;
  purchaseDetails?: {
    supplierName?: unknown;
    receivedQty?: unknown;
    rejectionQty?: unknown;
  } | null;
}): PurchaseReceiptValidationResult {
  const details = job?.purchaseDetails;
  if (!details) return { ok: false, error: "Purchase receipt details are required." };
  if (!String(job.partyName || details.supplierName || "").trim()) {
    return { ok: false, error: "Supplier metadata is required for a purchase receipt." };
  }
  if (!String(job.itemName || "").trim() || !String(job.materialType || "").trim()) {
    return { ok: false, error: "Purchase item metadata is required for a purchase receipt." };
  }

  const receivedQty = parseDecimalQuantity(details.receivedQty);
  const rejectionQty = details.rejectionQty === undefined || details.rejectionQty === null || details.rejectionQty === ""
    ? 0
    : parseDecimalQuantity(details.rejectionQty);
  const sentQty = parseDecimalQuantity(job.currentQty);
  if (!Number.isFinite(receivedQty) || receivedQty <= 0) {
    return { ok: false, error: "receivedQty must be a positive finite quantity." };
  }
  if (!Number.isFinite(rejectionQty) || rejectionQty < 0) {
    return { ok: false, error: "rejectionQty must be a non-negative finite quantity." };
  }
  if (rejectionQty > receivedQty) {
    return { ok: false, error: "rejectionQty cannot exceed receivedQty." };
  }
  const creditedQty = receivedQty - rejectionQty;
  if (!(creditedQty > 0)) {
    return { ok: false, error: "Purchase receipt must credit a positive quantity." };
  }
  if (!Number.isFinite(sentQty) || sentQty <= 0 || sentQty > creditedQty) {
    return { ok: false, error: "Purchase transfer quantity must be positive and no greater than credited quantity." };
  }
  return { ok: true, receivedQty, rejectionQty, creditedQty, sentQty };
}

export function createPurchaseCreationFingerprint(job: {
  jobCardNo?: unknown;
  partyName?: unknown;
  itemName?: unknown;
  itemCode?: unknown;
  materialType?: unknown;
  isWire?: unknown;
  rawMaterialKind?: unknown;
  unit?: unknown;
  currentDepartment?: unknown;
  orderQty?: unknown;
  currentQty?: unknown;
  purchaseDetails?: {
    supplierName?: unknown;
    billNo?: unknown;
    receivedQty?: unknown;
    rejectionQty?: unknown;
  } | null;
}): string {
  const details = job.purchaseDetails || {};
  return JSON.stringify([
    String(job.jobCardNo || "").trim().toUpperCase(),
    String(job.partyName || "").trim().toLowerCase(),
    String(details.supplierName || job.partyName || "").trim().toLowerCase(),
    normalizeItemCode(String(job.itemCode || "")),
    String(job.itemName || "").trim().toLowerCase(),
    String(job.materialType || "").trim().toLowerCase(),
    Boolean(job.isWire),
    String(job.rawMaterialKind || "").trim().toLowerCase(),
    String(job.unit || "").trim().toUpperCase(),
    String(job.currentDepartment || "").trim().toLowerCase(),
    parseDecimalQuantity(job.orderQty),
    parseDecimalQuantity(job.currentQty),
    parseDecimalQuantity(details.receivedQty),
    details.rejectionQty === undefined || details.rejectionQty === null || details.rejectionQty === ""
      ? 0
      : parseDecimalQuantity(details.rejectionQty),
    String(details.billNo || "").trim().toLowerCase()
  ]);
}
