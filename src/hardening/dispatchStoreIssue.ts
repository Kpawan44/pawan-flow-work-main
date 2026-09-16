import { runKeyedSerialized } from "./movementSerialize";
import type { SimpleStore } from "./commitMaterialMovement";

export const STORE_UNIT_STOCK_COLLECTION = "mfr_store_unit_stock";
export const DISPATCH_STORE_REQUIREMENT_COLLECTION = "mfr_dispatch_store_requirements";
export const DISPATCH_STORE_ISSUE_COLLECTION = "mfr_dispatch_store_issues";
export const STORE_UNIT_OPENING_COLLECTION = "mfr_store_unit_openings";

export const STORE_PHYSICAL_UNITS = ["BAG", "PCS", "KG"] as const;
export type StorePhysicalUnit = (typeof STORE_PHYSICAL_UNITS)[number];
export type DispatchStoreRequirementStatus = "PENDING" | "PARTIALLY_ISSUED" | "COMPLETED";

export type DispatchStoreActor = {
  userId: string;
  userName: string;
  role: string;
  department: string;
  allowedDepartments: string[];
  accessList: string[];
};

export interface StoreUnitStockRecord {
  jobCardNo: string;
  itemCode?: string;
  itemName?: string;
  bagQty: number;
  pcsQty: number;
  kgQty: number;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface DispatchStoreRequirementRecord {
  id: string;
  jobCardNo: string;
  itemCode?: string;
  itemName?: string;
  requestedQty: number;
  requestedUnit: StorePhysicalUnit;
  issuedQty: number;
  remainingQty: number;
  status: DispatchStoreRequirementStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  remarks?: string;
  version: number;
}

export interface DispatchStoreIssueRecord {
  id: string;
  jobCardNo: string;
  itemCode?: string;
  itemName?: string;
  fromDepartment: "Store";
  toDepartment: "Dispatch";
  issuedBagQty: number;
  issuedPcsQty: number;
  issuedKgQty: number;
  issuedBy: string;
  issuedAt: string;
  remarks?: string;
  operationId?: string;
  requirementId?: string;
  controllingUnit?: StorePhysicalUnit;
  controllingQty?: number;
}

export interface StoreUnitOpeningRecord {
  id: string;
  jobCardNo: string;
  bagQty: number;
  pcsQty: number;
  kgQty: number;
  kind: "OPENING" | "RECEIPT";
  createdBy: string;
  createdAt: string;
  remarks?: string;
}

export interface DispatchStoreTxResult<T = unknown> {
  success: boolean;
  cached?: boolean;
  error?: string;
  statusCode?: number;
  data?: T;
}

type ActorLike = DispatchStoreActor;

function normalizeJobCardNo(jobCardNo: string): string {
  return String(jobCardNo || "").trim().toUpperCase();
}

function isAdminRole(actor: ActorLike): boolean {
  const role = String(actor.role || "").toLowerCase();
  const dept = String(actor.department || "").toLowerCase();
  return role === "super_admin" || role === "admin" || dept === "admin" || dept === "management";
}

function actorHasDepartment(actor: ActorLike, department: string): boolean {
  if (isAdminRole(actor)) return true;
  const want = department.toLowerCase();
  const userDept = String(actor.department || "").toLowerCase();
  const allowed = [
    ...(Array.isArray(actor.allowedDepartments) ? actor.allowedDepartments : []),
    ...(Array.isArray(actor.accessList) ? actor.accessList : [])
  ].map((d) => String(d).toLowerCase());
  return userDept === want || allowed.includes(want);
}

export function canCreateDispatchStoreRequirement(_actor: ActorLike): boolean {
  return false;
}

export function canIssueDispatchStoreStock(actor: ActorLike): boolean {
  return actorHasDepartment(actor, "Store");
}

export function isStorePhysicalUnit(value: unknown): value is StorePhysicalUnit {
  return STORE_PHYSICAL_UNITS.includes(String(value || "").toUpperCase() as StorePhysicalUnit);
}

export function parseNonNegativeQty(value: unknown): { ok: true; qty: number } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, qty: 0 };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, error: "Quantities must be finite numbers." };
  }
  if (n < 0) {
    return { ok: false, error: "Quantities cannot be negative." };
  }
  return { ok: true, qty: n };
}

export function emptyStoreUnitStock(jobCardNo: string, nowIso: string, updatedBy: string): StoreUnitStockRecord {
  return {
    jobCardNo: normalizeJobCardNo(jobCardNo),
    bagQty: 0,
    pcsQty: 0,
    kgQty: 0,
    version: 0,
    updatedAt: nowIso,
    updatedBy
  };
}

export function requirementStatus(issuedQty: number, requestedQty: number): DispatchStoreRequirementStatus {
  if (issuedQty <= 0) return "PENDING";
  if (issuedQty >= requestedQty) return "COMPLETED";
  return "PARTIALLY_ISSUED";
}

export function controllingIssuedQty(
  unit: StorePhysicalUnit,
  issuedBagQty: number,
  issuedPcsQty: number,
  issuedKgQty: number
): number {
  if (unit === "BAG") return issuedBagQty;
  if (unit === "PCS") return issuedPcsQty;
  return issuedKgQty;
}

export function ensureDispatchStoreIssueOperationId(payload: { operationId?: string } | null | undefined): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("operationId is required.");
  }
  const existing = String(payload.operationId || "").trim();
  if (existing) return existing;
  const minted =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `dsi-${crypto.randomUUID()}`
      : `dsi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  payload.operationId = minted;
  return minted;
}

export function createDispatchStoreIssueFingerprint(input: {
  jobCardNo: string;
  issuedBagQty: number;
  issuedPcsQty: number;
  issuedKgQty: number;
  requirementId?: string;
}): string {
  return [
    String(input.requirementId || "").trim(),
    normalizeJobCardNo(input.jobCardNo),
    String(input.issuedBagQty),
    String(input.issuedPcsQty),
    String(input.issuedKgQty)
  ].join("|");
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

function storeUnitSerializeKey(jobCardNo: string): string {
  return `store-unit:${normalizeJobCardNo(jobCardNo)}`;
}

async function runSerialized<T>(store: SimpleStore, key: string, fn: () => Promise<T>): Promise<T> {
  if (store.runSerialized) return store.runSerialized(key, fn);
  return runKeyedSerialized(key, fn);
}

async function writeAudit(
  store: SimpleStore,
  actor: ActorLike,
  action: string,
  details: string,
  nowIso: string
): Promise<void> {
  const id = `AL-DS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await store.set("mfr_audit_logs", id, {
    id,
    timestamp: nowIso,
    userId: actor.userId,
    userName: actor.userName,
    action,
    details
  });
}

export async function createDispatchStoreRequirementTx(
  _store: SimpleStore,
  _input: {
    operationId?: string;
    jobCardNo: string;
    requestedQty: unknown;
    requestedUnit: unknown;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ requirement: DispatchStoreRequirementRecord }>> {
  return {
    success: false,
    statusCode: 410,
    error: "Dispatch → Store requirement creation has been removed. Use direct Store → Dispatch issue."
  };
}

export async function applyStoreUnitOpeningTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    jobCardNo: string;
    bagQty?: unknown;
    pcsQty?: unknown;
    kgQty?: unknown;
    kind?: "OPENING" | "RECEIPT";
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ stock: StoreUnitStockRecord; opening: StoreUnitOpeningRecord }>> {
  const jobCardNo = normalizeJobCardNo(input.jobCardNo);
  return runSerialized(store, storeUnitSerializeKey(jobCardNo || "opening"), async () => {
    const now = input.nowIso || new Date().toISOString();
    const opKey = String(input.operationId || "").trim();
    if (opKey) {
      const existing = await store.get("mfr_idempotency_keys", opKey);
      if (existing?.result?.stock && existing?.result?.opening) {
        return { success: true, cached: true, data: { stock: existing.result.stock, opening: existing.result.opening } };
      }
    }
    if (!canIssueDispatchStoreStock(input.actor)) {
      return { success: false, statusCode: 403, error: "Only Store (or admin) can enter independent unit opening balances." };
    }
    if (!jobCardNo) {
      return { success: false, statusCode: 400, error: "jobCardNo is required." };
    }
    const bag = parseNonNegativeQty(input.bagQty);
    const pcs = parseNonNegativeQty(input.pcsQty);
    const kg = parseNonNegativeQty(input.kgQty);
    if (bag.ok === false) return { success: false, statusCode: 400, error: bag.error };
    if (pcs.ok === false) return { success: false, statusCode: 400, error: pcs.error };
    if (kg.ok === false) return { success: false, statusCode: 400, error: kg.error };
    if (!(bag.qty > 0 || pcs.qty > 0 || kg.qty > 0)) {
      return { success: false, statusCode: 400, error: "Enter at least one of BAG, PCS, or KG greater than 0." };
    }

    const job = await store.get("mfr_job_cards", jobCardNo);
    if (!job) {
      return { success: false, statusCode: 404, error: "jobCardNo was not found. Independent unit opening requires an existing job card." };
    }
    const existingStock = (await store.get(STORE_UNIT_STOCK_COLLECTION, jobCardNo)) as StoreUnitStockRecord | null;
    const current = existingStock || emptyStoreUnitStock(jobCardNo, now, input.actor.userName || input.actor.userId);
    const next: StoreUnitStockRecord = {
      ...current,
      jobCardNo,
      itemCode: current.itemCode || (job?.itemCode ? String(job.itemCode) : undefined),
      itemName: current.itemName || (job?.itemName ? String(job.itemName) : undefined),
      bagQty: current.bagQty + bag.qty,
      pcsQty: current.pcsQty + pcs.qty,
      kgQty: current.kgQty + kg.qty,
      version: Number(current.version || 0) + 1,
      updatedAt: now,
      updatedBy: input.actor.userName || input.actor.userId
    };
    const opening: StoreUnitOpeningRecord = {
      id: newId("DSO"),
      jobCardNo,
      bagQty: bag.qty,
      pcsQty: pcs.qty,
      kgQty: kg.qty,
      kind: input.kind === "RECEIPT" ? "RECEIPT" : "OPENING",
      createdBy: input.actor.userName || input.actor.userId,
      createdAt: now,
      remarks: input.remarks ? String(input.remarks) : undefined
    };
    await store.set(STORE_UNIT_STOCK_COLLECTION, jobCardNo, next);
    await store.set(STORE_UNIT_OPENING_COLLECTION, opening.id, opening);
    if (opKey) {
      await store.set("mfr_idempotency_keys", opKey, { operationId: opKey, result: { stock: next, opening } });
    }
    await writeAudit(
      store,
      input.actor,
      "STORE_UNIT_OPENING",
      `Independent unit ${opening.kind.toLowerCase()} for ${jobCardNo}: BAG ${bag.qty}, PCS ${pcs.qty}, KG ${kg.qty}. Not derived from storeAuthoritativeOnHand or packing.`,
      now
    );
    return { success: true, data: { stock: next, opening } };
  });
}

export async function issueStoreToDispatchTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    jobCardNo: string;
    issuedBagQty?: unknown;
    issuedPcsQty?: unknown;
    issuedKgQty?: unknown;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ issue: DispatchStoreIssueRecord; stock: StoreUnitStockRecord }>> {
  const jobCardNo = normalizeJobCardNo(input.jobCardNo);
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return { success: false, statusCode: 400, error: "operationId is required. Retry the same issue with the identical operationId to avoid duplicate deductions." };
  }
  if (!store.runTransaction) {
    return { success: false, statusCode: 500, error: "Atomic transaction store is required for Store → Dispatch issue." };
  }
  if (!jobCardNo) {
    return { success: false, statusCode: 400, error: "jobCardNo is required." };
  }

  return runSerialized(store, storeUnitSerializeKey(jobCardNo), () =>
    store.runTransaction!(async (tx) => {
      const now = input.nowIso || new Date().toISOString();
      const bag = parseNonNegativeQty(input.issuedBagQty);
      const pcs = parseNonNegativeQty(input.issuedPcsQty);
      const kg = parseNonNegativeQty(input.issuedKgQty);
      if (bag.ok === false) return { success: false, statusCode: 400, error: bag.error };
      if (pcs.ok === false) return { success: false, statusCode: 400, error: pcs.error };
      if (kg.ok === false) return { success: false, statusCode: 400, error: kg.error };
      if (!(bag.qty > 0 || pcs.qty > 0 || kg.qty > 0)) {
        return { success: false, statusCode: 400, error: "At least one of BAG, PCS, or KG must be greater than 0." };
      }

      if (!canIssueDispatchStoreStock(input.actor)) {
        return { success: false, statusCode: 403, error: "Only Store (or admin) can issue independent unit stock to Dispatch." };
      }

      const requestFingerprint = createDispatchStoreIssueFingerprint({
        jobCardNo,
        issuedBagQty: bag.qty,
        issuedPcsQty: pcs.qty,
        issuedKgQty: kg.qty
      });

      const existing = await tx.get("mfr_idempotency_keys", opKey);
      if (existing?.requestFingerprint && existing.requestFingerprint !== requestFingerprint) {
        return {
          success: false,
          statusCode: 409,
          error: "operationId was already used for a different Store → Dispatch issue. Use a new operationId for a distinct issue."
        };
      }
      if (existing?.result?.issue && existing?.result?.stock) {
        return {
          success: true,
          cached: true,
          data: {
            issue: existing.result.issue,
            stock: existing.result.stock
          }
        };
      }

      const job = await tx.get("mfr_job_cards", jobCardNo);
      if (!job) {
        return { success: false, statusCode: 404, error: "jobCardNo was not found. Direct Store → Dispatch issue requires an existing job card." };
      }

      const existingStock = (await tx.get(STORE_UNIT_STOCK_COLLECTION, jobCardNo)) as StoreUnitStockRecord | null;
      const current = existingStock || emptyStoreUnitStock(jobCardNo, now, input.actor.userName || input.actor.userId);

      if (bag.qty > current.bagQty) {
        return { success: false, statusCode: 409, error: `BAG stock is insufficient (available ${current.bagQty}, requested ${bag.qty}).` };
      }
      if (pcs.qty > current.pcsQty) {
        return { success: false, statusCode: 409, error: `PCS stock is insufficient (available ${current.pcsQty}, requested ${pcs.qty}).` };
      }
      if (kg.qty > current.kgQty) {
        return { success: false, statusCode: 409, error: `KG stock is insufficient (available ${current.kgQty}, requested ${kg.qty}).` };
      }

      const nextStock: StoreUnitStockRecord = {
        ...current,
        jobCardNo,
        itemCode: current.itemCode || (job?.itemCode ? String(job.itemCode) : undefined),
        itemName: current.itemName || (job?.itemName ? String(job.itemName) : undefined),
        bagQty: current.bagQty - bag.qty,
        pcsQty: current.pcsQty - pcs.qty,
        kgQty: current.kgQty - kg.qty,
        version: Number(current.version || 0) + 1,
        updatedAt: now,
        updatedBy: input.actor.userName || input.actor.userId
      };

      const issue: DispatchStoreIssueRecord = {
        id: newId("DSI"),
        jobCardNo,
        itemCode: nextStock.itemCode,
        itemName: nextStock.itemName,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        issuedBagQty: bag.qty,
        issuedPcsQty: pcs.qty,
        issuedKgQty: kg.qty,
        issuedBy: input.actor.userName || input.actor.userId,
        issuedAt: now,
        remarks: input.remarks ? String(input.remarks) : undefined,
        operationId: opKey
      };

      tx.set(STORE_UNIT_STOCK_COLLECTION, jobCardNo, nextStock);
      tx.set(DISPATCH_STORE_ISSUE_COLLECTION, issue.id, issue);
      tx.set("mfr_idempotency_keys", opKey, {
        operationId: opKey,
        requestFingerprint,
        result: { issue, stock: nextStock }
      });
      return { success: true, data: { issue, stock: nextStock } };
    })
  ).then(async (result) => {
    if (result.success && !result.cached && result.data) {
      await writeAudit(
        store,
        input.actor,
        "DISPATCH_STORE_ISSUE",
        `Direct issue from Store to Dispatch for ${result.data.issue.jobCardNo}: BAG ${result.data.issue.issuedBagQty}, PCS ${result.data.issue.issuedPcsQty}, KG ${result.data.issue.issuedKgQty}. No unit conversion applied.`,
        result.data.issue.issuedAt
      );
    }
    return result;
  });
}

/** Legacy adapter for requirement-based issue, routing directly through Store → Dispatch issue */
export async function issueDispatchStoreRequirementTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    requirementId?: string;
    jobCardNo?: string;
    issuedBagQty?: unknown;
    issuedPcsQty?: unknown;
    issuedKgQty?: unknown;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ requirement?: DispatchStoreRequirementRecord; issue: DispatchStoreIssueRecord; stock: StoreUnitStockRecord }>> {
  let jobCardNo = input.jobCardNo ? normalizeJobCardNo(input.jobCardNo) : "";
  if (!jobCardNo && input.requirementId) {
    const req = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, input.requirementId);
    if (req?.jobCardNo) {
      jobCardNo = normalizeJobCardNo(req.jobCardNo);
    }
  }
  if (!jobCardNo && input.requirementId) {
    return { success: false, statusCode: 404, error: "Dispatch → Store requirement was not found." };
  }
  const result = await issueStoreToDispatchTx(store, {
    operationId: input.operationId,
    jobCardNo,
    issuedBagQty: input.issuedBagQty,
    issuedPcsQty: input.issuedPcsQty,
    issuedKgQty: input.issuedKgQty,
    remarks: input.remarks,
    actor: input.actor,
    nowIso: input.nowIso
  });
  if (!result.success) return result as any;
  return {
    success: true,
    cached: result.cached,
    data: {
      issue: result.data!.issue,
      stock: result.data!.stock
    }
  };
}
