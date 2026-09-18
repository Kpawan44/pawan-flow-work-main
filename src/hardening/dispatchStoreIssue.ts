import { runKeyedSerialized } from "./movementSerialize";
import type { SimpleStore } from "./commitMaterialMovement";
import { storeAuthoritativeOnHand, creditedInboundQty, isDeletedMovement } from "./process2Manufacturing";
import { normalizeDeptName } from "./process1Purchase";
import type { DispatchStoreIssueSourceAllocation, ProcessTransfer } from "../types";

export const DISPATCH_STORE_REQUIREMENT_COLLECTION = "mfr_dispatch_store_requirements";
export const DISPATCH_STORE_ISSUE_COLLECTION = "mfr_dispatch_store_issues";

export const STORE_PHYSICAL_UNITS = ["BAG", "PCS", "KG"] as const;
export type StorePhysicalUnit = (typeof STORE_PHYSICAL_UNITS)[number];
export type DispatchStoreRequirementStatus = "PENDING" | "PARTIALLY_ISSUED" | "COMPLETED";

export interface DispatchStoreActor {
  userId: string;
  userName: string;
  role: string;
  department: string;
  allowedDepartments: string[];
  accessList: string[];
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
  jobCardNo?: string;
  itemCode?: string;
  itemName: string;
  fromDepartment: "Store";
  toDepartment: "Dispatch";
  issuedBagQty: number;
  issuedPcsQty: number;
  issuedKgQty: number;
  issuedBy: string;
  issuedAt: string;
  remarks?: string;
  operationId?: string;
  movementId?: string;
  sourceAllocations?: DispatchStoreIssueSourceAllocation[];
  nativeUnit?: string;
  nativeDeductedQty?: number;
}

export interface DispatchStoreTxResult<T = unknown> {
  success: boolean;
  cached?: boolean;
  error?: string;
  statusCode?: number;
  data?: T;
}

type ActorLike = DispatchStoreActor;

export function normalizeJobCardNo(jobCardNo: string): string {
  return String(jobCardNo || "").trim().toUpperCase();
}

export function normalizeItemName(itemName: string): string {
  return String(itemName || "").trim().toLowerCase();
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

export function normalizeNativeUnit(unit?: string): "PCS" | "BAG" | "KG" {
  const u = String(unit || "").trim().toUpperCase();
  if (u === "PCS" || u === "PIECES" || u === "NOS" || u === "NUMBERS") return "PCS";
  if (u === "BAG" || u === "BAGS") return "BAG";
  return "KG";
}

export function getNativeIssuedQty(
  nativeUnit: "PCS" | "BAG" | "KG",
  issuedBagQty: number,
  issuedPcsQty: number,
  issuedKgQty: number
): number {
  if (nativeUnit === "PCS") return issuedPcsQty;
  if (nativeUnit === "BAG") return issuedBagQty;
  return issuedKgQty;
}

export function requirementStatus(issuedQty: number, requestedQty: number): DispatchStoreRequirementStatus {
  if (issuedQty <= 0) return "PENDING";
  if (issuedQty >= requestedQty) return "COMPLETED";
  return "PARTIALLY_ISSUED";
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

export function createDispatchStoreBatchIssueFingerprint(input: {
  items: Array<{
    jobCardNo?: string;
    itemName?: string;
    itemCode?: string;
    issuedBagQty?: unknown;
    issuedPcsQty?: unknown;
    issuedKgQty?: unknown;
  }>;
  remarks?: string;
}): string {
  const itemStrings = (input.items || []).map((it) =>
    [
      normalizeItemName(it.itemName || ""),
      normalizeJobCardNo(it.jobCardNo || ""),
      String(it.itemCode || "").trim().toUpperCase(),
      String(Number(it.issuedBagQty) || 0),
      String(Number(it.issuedPcsQty) || 0),
      String(Number(it.issuedKgQty) || 0)
    ].join("|")
  );
  return [String(input.remarks || "").trim(), ...itemStrings].join("::");
}

export function createDispatchStoreIssueFingerprint(input: {
  jobCardNo?: string;
  itemName?: string;
  itemCode?: string;
  issuedBagQty: number;
  issuedPcsQty: number;
  issuedKgQty: number;
  requirementId?: string;
}): string {
  return [
    String(input.requirementId || "").trim(),
    normalizeItemName(input.itemName || ""),
    normalizeJobCardNo(input.jobCardNo || ""),
    String(input.itemCode || "").trim().toUpperCase(),
    String(input.issuedBagQty),
    String(input.issuedPcsQty),
    String(input.issuedKgQty)
  ].join("|");
}

export function createStoreProcessTransferFingerprint(input: {
  toProcess: string;
  jobCardNo?: string;
  itemName?: string;
  itemCode?: string;
  issuedBagQty: number;
  issuedPcsQty: number;
  issuedKgQty: number;
}): string {
  return [
    String(input.toProcess || "").trim().toUpperCase(),
    normalizeItemName(input.itemName || ""),
    normalizeJobCardNo(input.jobCardNo || ""),
    String(input.itemCode || "").trim().toUpperCase(),
    String(input.issuedBagQty),
    String(input.issuedPcsQty),
    String(input.issuedKgQty)
  ].join("|");
}

function parseStrictPositiveKgQty(val: unknown): { ok: true; qty: number } | { ok: false; error: string } {
  if (val === undefined || val === null || val === "" || String(val).trim() === "") {
    return { ok: false, error: "KG to send is mandatory and must be greater than 0." };
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "KG to send must be a valid number greater than 0." };
  }
  return { ok: true, qty: n };
}

function parseOptionalNonNegativeQty(val: unknown): { ok: true; qty: number } | { ok: false; error: string } {
  if (val === undefined || val === null || val === "" || String(val).trim() === "") {
    return { ok: true, qty: 0 };
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Optional physical quantities (BAG, PCS) must be non-negative numbers (or left blank)." };
  }
  return { ok: true, qty: n };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

function dispatchStoreSerializeKey(itemOrJob: string): string {
  return `dsi:${String(itemOrJob || "").trim().toLowerCase()}`;
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

/**
 * Calculates authoritative available 3-unit stock (KG, Bags, PCS) for a single Job Card in Store.
 */
export function calculateStoreJobCardAvailableStock(
  job: any,
  movements: any[] = [],
  dispatchIssues: any[] = [],
  processTransfers: any[] = []
): { availableKg: number; availableBags: number; availablePcs: number; nativeUnit: string; onHandNative: number } {
  const jcNo = normalizeJobCardNo(job?.jobCardNo);
  const nativeUnit = normalizeNativeUnit(job?.unit);
  const onHandNative = storeAuthoritativeOnHand(job, movements);

  const inboundMoves = (movements || []).filter(
    (m) =>
      m &&
      normalizeJobCardNo(m.jobCardNo) === jcNo &&
      normalizeDeptName(m.toDepartment) === "store" &&
      !isDeletedMovement(m) &&
      creditedInboundQty(m) > 0
  );

  // Inbound physical quantities
  // Inbound Bags
  let inboundBags = 0;
  for (const m of inboundMoves) {
    if (m.processDetails?.boxCount !== undefined) {
      inboundBags += Number(m.processDetails.boxCount || 0);
    } else if (m.processDetails?.bags !== undefined) {
      inboundBags += Number(m.processDetails.bags || 0);
    } else if (m.processDetails?.issuedBagQty !== undefined) {
      inboundBags += Number(m.processDetails.issuedBagQty || 0);
    }
  }
  if (inboundBags === 0) {
    if (job?.packingDetails?.boxCount) {
      inboundBags = Number(job.packingDetails.boxCount || 0);
    } else if (job?.packingDetails?.bagLines && Array.isArray(job.packingDetails.bagLines)) {
      inboundBags = job.packingDetails.bagLines.reduce((s: number, l: any) => s + Number(l?.bags || 0), 0);
    } else if (nativeUnit === "BAG") {
      inboundBags = onHandNative;
    }
  }

  // Inbound PCS
  let inboundPcs = 0;
  for (const m of inboundMoves) {
    if (m.processDetails?.totalPcs !== undefined) {
      inboundPcs += Number(m.processDetails.totalPcs || 0);
    } else if (m.processDetails?.pcs !== undefined) {
      inboundPcs += Number(m.processDetails.pcs || 0);
    } else if (m.processDetails?.issuedPcsQty !== undefined) {
      inboundPcs += Number(m.processDetails.issuedPcsQty || 0);
    }
  }
  if (inboundPcs === 0) {
    if (job?.packingDetails?.totalPcs) {
      inboundPcs = Number(job.packingDetails.totalPcs || 0);
    } else if (job?.packingDetails?.bagLines && Array.isArray(job.packingDetails.bagLines)) {
      inboundPcs = job.packingDetails.bagLines.reduce((s: number, l: any) => s + Number(l?.lineTotal || 0), 0);
    } else if (nativeUnit === "PCS") {
      inboundPcs = onHandNative;
    }
  }

  // Inbound KG
  let inboundKg = onHandNative;
  if (nativeUnit !== "KG") {
    let recordedKg = 0;
    for (const m of inboundMoves) {
      if (m.processDetails?.issuedKgQty !== undefined) {
        recordedKg += Number(m.processDetails.issuedKgQty || 0);
      } else if (m.processDetails?.kgQty !== undefined) {
        recordedKg += Number(m.processDetails.kgQty || 0);
      }
    }
    inboundKg = recordedKg || Number(job?.orderQty || 0);
  }

  // Outbound deductions from direct dispatch store issues
  let outboundBags = 0;
  let outboundPcs = 0;
  let outboundKg = 0;

  for (const issue of dispatchIssues || []) {
    if (issue?.sourceAllocations && Array.isArray(issue.sourceAllocations) && issue.sourceAllocations.length > 0) {
      const match = issue.sourceAllocations.find((a: any) => normalizeJobCardNo(a?.jobCardNo) === jcNo);
      if (match) {
        outboundBags += Number(match.allocatedBagQty ?? match.allocatedBags ?? 0);
        outboundPcs += Number(match.allocatedPcsQty ?? match.allocatedPcs ?? 0);
        outboundKg += Number(match.allocatedKgQty ?? match.allocatedKg ?? 0);
      }
    } else if (normalizeJobCardNo(issue?.jobCardNo) === jcNo) {
      outboundBags += Number(issue.issuedBagQty || 0);
      outboundPcs += Number(issue.issuedPcsQty || 0);
      outboundKg += Number(issue.issuedKgQty || 0);
    }
  }

  for (const transfer of processTransfers || []) {
    if (transfer?.status === "Returned to Store" || transfer?.isDeleted) continue;
    if (transfer?.sourceAllocations && Array.isArray(transfer.sourceAllocations) && transfer.sourceAllocations.length > 0) {
      const match = transfer.sourceAllocations.find((a: any) => normalizeJobCardNo(a?.jobCardNo) === jcNo);
      if (match) {
        outboundBags += Number(match.allocatedBagQty ?? match.allocatedBags ?? 0);
        outboundPcs += Number(match.allocatedPcsQty ?? match.allocatedPcs ?? 0);
        outboundKg += Number(match.allocatedKgQty ?? match.allocatedKg ?? 0);
      }
    } else if (normalizeJobCardNo(transfer?.jobCardNo) === jcNo) {
      outboundBags += Number(transfer.issuedBagQty || 0);
      outboundPcs += Number(transfer.issuedPcsQty || 0);
      outboundKg += Number(transfer.issuedKgQty || 0);
    }
  }

  for (const m of movements || []) {
    if (
      m &&
      normalizeJobCardNo(m.jobCardNo) === jcNo &&
      normalizeDeptName(m.fromDepartment) === "store" &&
      !isDeletedMovement(m)
    ) {
      const isHandledByDoc =
        m.processDetails?.directStoreIssueId ||
        m.processDetails?.processTransferId;
      if (!isHandledByDoc) {
        if (m.processDetails?.issuedBagQty) outboundBags += Number(m.processDetails.issuedBagQty);
        if (m.processDetails?.issuedPcsQty) outboundPcs += Number(m.processDetails.issuedPcsQty);
        if (m.processDetails?.issuedKgQty) outboundKg += Number(m.processDetails.issuedKgQty);
      }
    }
  }

  let availableBags = Math.max(0, inboundBags - outboundBags);
  let availablePcs = Math.max(0, inboundPcs - outboundPcs);
  let availableKg = Math.max(0, inboundKg - outboundKg);

  if (nativeUnit === "KG") {
    availableKg = onHandNative;
  } else if (nativeUnit === "PCS") {
    availablePcs = Math.min(availablePcs, onHandNative);
  } else if (nativeUnit === "BAG") {
    availableBags = Math.min(availableBags, onHandNative);
  }

  return {
    availableKg,
    availableBags,
    availablePcs,
    nativeUnit: job?.unit || "KG",
    onHandNative
  };
}

export interface CandidateStoreJobCard {
  jobCardNo: string;
  itemCode?: string;
  itemName: string;
  partyName?: string;
  createdAt?: string;
  availableKg: number;
  availableBags: number;
  availablePcs: number;
  nativeUnit: string;
  onHandNative: number;
}

export interface AuthoritativeItemStockSummary {
  itemName: string;
  itemCode?: string;
  availableKg: number;
  availableBags: number;
  availablePcs: number;
  candidateJobCards: CandidateStoreJobCard[];
}

/**
 * Computes aggregated available 3-unit stock (KG, Bags, PCS) across all Store Job Cards matching Item Name.
 */
export function calculateStoreAuthoritativeItemStock(
  itemName: string,
  jobCards: any[] = [],
  movements: any[] = [],
  dispatchIssues: any[] = [],
  itemCodeFilter?: string,
  processTransfers: any[] = []
): AuthoritativeItemStockSummary {
  const targetItem = normalizeItemName(itemName);
  const targetCode = String(itemCodeFilter || "").trim().toUpperCase();

  const candidateJobCards: CandidateStoreJobCard[] = [];

  for (const job of jobCards || []) {
    if (!job || job.isDeleted || job.completed || job.status === "Completed" || job.currentDepartment === "Completed") {
      continue;
    }
    const jItem = normalizeItemName(job.itemName);
    if (jItem !== targetItem) continue;

    const jCode = String(job.itemCode || "").trim().toUpperCase();
    if (targetCode && jCode && jCode !== targetCode) continue;

    const stock = calculateStoreJobCardAvailableStock(job, movements, dispatchIssues, processTransfers);
    const inStore = normalizeDeptName(job.currentDepartment) === "store";

    if (stock.availableKg > 0 || stock.availableBags > 0 || stock.availablePcs > 0 || (inStore && stock.onHandNative > 0)) {
      candidateJobCards.push({
        jobCardNo: normalizeJobCardNo(job.jobCardNo),
        itemCode: job.itemCode ? String(job.itemCode) : undefined,
        itemName: String(job.itemName || ""),
        partyName: job.partyName ? String(job.partyName) : undefined,
        createdAt: job.createdAt ? String(job.createdAt) : undefined,
        availableKg: stock.availableKg,
        availableBags: stock.availableBags,
        availablePcs: stock.availablePcs,
        nativeUnit: stock.nativeUnit,
        onHandNative: stock.onHandNative
      });
    }
  }

  // Deterministic sorting (oldest first by createdAt ascending, then jobCardNo)
  candidateJobCards.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;
    return a.jobCardNo.localeCompare(b.jobCardNo);
  });

  const availableKg = candidateJobCards.reduce((s, c) => s + c.availableKg, 0);
  const availableBags = candidateJobCards.reduce((s, c) => s + c.availableBags, 0);
  const availablePcs = candidateJobCards.reduce((s, c) => s + c.availablePcs, 0);

  return {
    itemName,
    itemCode: targetCode || candidateJobCards[0]?.itemCode,
    availableKg,
    availableBags,
    availablePcs,
    candidateJobCards
  };
}

/**
 * Deterministic Multi-Job-Card FIFO allocation of requested physical units.
 * Decrements oldest Job Card first without any candidate balance becoming negative.
 */
export function allocateItemStockAcrossJobCards(
  candidateJobCards: CandidateStoreJobCard[],
  requestedKg: number,
  requestedBags: number,
  requestedPcs: number
): { success: true; allocations: DispatchStoreIssueSourceAllocation[] } | { success: false; error: string } {
  let remKg = requestedKg;
  let remBags = requestedBags;
  let remPcs = requestedPcs;

  const allocations: DispatchStoreIssueSourceAllocation[] = [];

  for (const candidate of candidateJobCards) {
    if (remKg <= 0 && remBags <= 0 && remPcs <= 0) break;

    const allocKg = Math.min(candidate.availableKg, remKg);
    const allocBags = Math.min(candidate.availableBags, remBags);
    const allocPcs = Math.min(candidate.availablePcs, remPcs);

    if (allocKg > 0 || allocBags > 0 || allocPcs > 0) {
      remKg -= allocKg;
      remBags -= allocBags;
      remPcs -= allocPcs;

      const native = normalizeNativeUnit(candidate.nativeUnit);
      const nativeDeducted = native === "PCS" ? allocPcs : native === "BAG" ? allocBags : allocKg;

      allocations.push({
        jobCardNo: candidate.jobCardNo,
        allocatedBagQty: allocBags,
        allocatedPcsQty: allocPcs,
        allocatedKgQty: allocKg,
        nativeUnit: candidate.nativeUnit,
        nativeDeductedQty: nativeDeducted,
        movementId: newId("MOV")
      });
    }
  }

  if (remKg > 1e-6 || remBags > 1e-6 || remPcs > 1e-6) {
    return {
      success: false,
      error: `Requested quantities exceed available stock across eligible Job Cards. Unfulfilled: ${remKg > 0 ? remKg + " KG " : ""}${remBags > 0 ? remBags + " BAG " : ""}${remPcs > 0 ? remPcs + " PCS" : ""}.`
    };
  }

  return { success: true, allocations };
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

/**
 * Server-side authoritative Item-Centric Store → Dispatch issue transaction.
 */
/**
 * Server-side authoritative Multi-Item Store → Dispatch batch issue transaction.
 * Executes in ONE single atomic transaction with complete rollback if even one item fails.
 */
export async function issueStoreBatchItemsToDispatchTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    items: Array<{
      itemName?: string;
      itemCode?: string;
      jobCardNo?: string;
      issuedBagQty?: unknown;
      issuedPcsQty?: unknown;
      issuedKgQty?: unknown;
      remarks?: string;
    }>;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ issues: DispatchStoreIssueRecord[]; movements: any[] }>> {
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return {
      success: false,
      statusCode: 400,
      error: "operationId is required. Retry the same issue with the identical operationId to avoid duplicate deductions."
    };
  }
  if (!store.runTransaction) {
    return { success: false, statusCode: 500, error: "Atomic transaction store is required for Store → Dispatch issue." };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { success: false, statusCode: 400, error: "items array must be non-empty for batch Store → Dispatch issue." };
  }

  if (!canIssueDispatchStoreStock(input.actor)) {
    return { success: false, statusCode: 403, error: "Only Store (or admin) can issue material to Dispatch." };
  }

  // Pre-validate parsed items
  const parsedItems: Array<{
    targetItemName: string;
    targetItemCode: string;
    jobCardNo?: string;
    bag: number;
    pcs: number;
    kg: number;
    remarks?: string;
  }> = [];

  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const bagRes = parseNonNegativeQty(item.issuedBagQty);
    const pcsRes = parseNonNegativeQty(item.issuedPcsQty);
    const kgRes = parseNonNegativeQty(item.issuedKgQty);

    if (bagRes.ok === false) return { success: false, statusCode: 400, error: `Item ${i + 1}: ${bagRes.error}` };
    if (pcsRes.ok === false) return { success: false, statusCode: 400, error: `Item ${i + 1}: ${pcsRes.error}` };
    if (kgRes.ok === false) return { success: false, statusCode: 400, error: `Item ${i + 1}: ${kgRes.error}` };

    if (!(bagRes.qty > 0 || pcsRes.qty > 0 || kgRes.qty > 0)) {
      return {
        success: false,
        statusCode: 400,
        error: `Item ${i + 1} ('${item.itemName || item.jobCardNo || "unnamed"}'): At least one of BAG, PCS, or KG must be greater than 0.`
      };
    }

    parsedItems.push({
      targetItemName: String(item.itemName || "").trim(),
      targetItemCode: String(item.itemCode || "").trim(),
      jobCardNo: item.jobCardNo ? String(item.jobCardNo).trim() : undefined,
      bag: bagRes.qty,
      pcs: pcsRes.qty,
      kg: kgRes.qty,
      remarks: item.remarks ? String(item.remarks) : undefined
    });
  }

  const serializeKey = dispatchStoreSerializeKey("batch_issue");

  return runSerialized(store, serializeKey, () =>
    store.runTransaction!(async (tx) => {
      const now = input.nowIso || new Date().toISOString();

      const allJobCards = await store.list("mfr_job_cards");
      const allMovements = await store.list("mfr_movements");
      const allIssues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
      const allProcessTransfers = await store.list("mfr_process_transfers");

      const requestFingerprint = createDispatchStoreBatchIssueFingerprint({
        items: input.items,
        remarks: input.remarks
      });

      const existing = await tx.get("mfr_idempotency_keys", opKey);
      if (existing?.requestFingerprint && existing.requestFingerprint !== requestFingerprint) {
        return {
          success: false,
          statusCode: 409,
          error: "operationId was already used for a different Store → Dispatch issue batch. Use a new operationId for a distinct issue."
        };
      }
      if (existing?.result?.issues && existing?.result?.movements) {
        return {
          success: true,
          cached: true,
          data: {
            issues: existing.result.issues,
            movements: existing.result.movements
          }
        };
      }

      // First pass: Validate every item in the batch against stock
      const currentIssues = [...allIssues];
      const batchPlannedAllocations: Array<{
        targetItemName: string;
        targetItemCode: string;
        bag: number;
        pcs: number;
        kg: number;
        remarks?: string;
        allocations: DispatchStoreIssueSourceAllocation[];
        itemStock: AuthoritativeItemStockSummary;
      }> = [];

      for (let i = 0; i < parsedItems.length; i++) {
        const pItem = parsedItems[i];
        let targetItemName = pItem.targetItemName;
        let targetItemCode = pItem.targetItemCode;

        if (!targetItemName && pItem.jobCardNo) {
          const jcNo = normalizeJobCardNo(pItem.jobCardNo);
          const j = allJobCards.find((card: any) => normalizeJobCardNo(card?.jobCardNo) === jcNo);
          if (j) {
            targetItemName = String(j.itemName || "");
            if (!targetItemCode && j.itemCode) targetItemCode = String(j.itemCode);
          } else {
            return { success: false, statusCode: 404, error: `Job Card '${pItem.jobCardNo}' not found.` };
          }
        }

        if (!targetItemName) {
          return { success: false, statusCode: 400, error: `Item ${i + 1}: Item Name (or Job Card) is required.` };
        }

        // Calculate authoritative stock taking into account prior issues and simulated batch issues
        let itemStock: AuthoritativeItemStockSummary;
        if (pItem.jobCardNo) {
          const jcNo = normalizeJobCardNo(pItem.jobCardNo);
          const singleJob = allJobCards.find((c: any) => normalizeJobCardNo(c?.jobCardNo) === jcNo);
          if (!singleJob) {
            return { success: false, statusCode: 404, error: `Job Card '${pItem.jobCardNo}' not found.` };
          }
          const singleStock = calculateStoreJobCardAvailableStock(singleJob, allMovements, currentIssues, allProcessTransfers);
          itemStock = {
            itemName: singleJob.itemName,
            itemCode: singleJob.itemCode,
            availableKg: singleStock.availableKg,
            availableBags: singleStock.availableBags,
            availablePcs: singleStock.availablePcs,
            candidateJobCards: [
              {
                jobCardNo: jcNo,
                itemCode: singleJob.itemCode,
                itemName: singleJob.itemName,
                partyName: singleJob.partyName,
                createdAt: singleJob.createdAt,
                availableKg: singleStock.availableKg,
                availableBags: singleStock.availableBags,
                availablePcs: singleStock.availablePcs,
                nativeUnit: singleStock.nativeUnit,
                onHandNative: singleStock.onHandNative
              }
            ]
          };
        } else {
          itemStock = calculateStoreAuthoritativeItemStock(
            targetItemName,
            allJobCards,
            allMovements,
            currentIssues,
            targetItemCode || undefined,
            allProcessTransfers
          );
        }

        // Strict validation: every unit requested must be <= available stock for that unit
        if (pItem.bag > itemStock.availableBags) {
          return {
            success: false,
            statusCode: 409,
            error: `Entered BAG quantity (${pItem.bag}) exceeds available Store stock (${itemStock.availableBags} BAG) for '${targetItemName}'.`
          };
        }
        if (pItem.pcs > itemStock.availablePcs) {
          return {
            success: false,
            statusCode: 409,
            error: `Entered PCS quantity (${pItem.pcs}) exceeds available Store stock (${itemStock.availablePcs} PCS) for '${targetItemName}'.`
          };
        }
        if (pItem.kg > itemStock.availableKg) {
          return {
            success: false,
            statusCode: 409,
            error: `Entered KG quantity (${pItem.kg}) exceeds available Store stock (${itemStock.availableKg} KG) for '${targetItemName}'.`
          };
        }

        // Allocate across candidate Job Cards
        const allocationResult = allocateItemStockAcrossJobCards(
          itemStock.candidateJobCards,
          pItem.kg,
          pItem.bag,
          pItem.pcs
        );
        if (!allocationResult.success) {
          return {
            success: false,
            statusCode: 409,
            error: (allocationResult as { success: false; error: string }).error
          };
        }

        // Simulate deduction in currentIssues
        const simIssue: any = {
          id: `sim-${i}`,
          itemName: targetItemName,
          itemCode: targetItemCode,
          issuedBagQty: pItem.bag,
          issuedPcsQty: pItem.pcs,
          issuedKgQty: pItem.kg,
          sourceAllocations: allocationResult.allocations
        };
        currentIssues.push(simIssue);

        batchPlannedAllocations.push({
          targetItemName,
          targetItemCode: targetItemCode || itemStock.itemCode || "",
          bag: pItem.bag,
          pcs: pItem.pcs,
          kg: pItem.kg,
          remarks: pItem.remarks,
          allocations: allocationResult.allocations,
          itemStock
        });
      }

      // If all items passed validation, commit all mutations atomically
      const createdIssues: DispatchStoreIssueRecord[] = [];
      const createdMovements: any[] = [];

      for (const planned of batchPlannedAllocations) {
        const issueId = newId("DSI");
        const primaryJobCardNo = planned.allocations[0]?.jobCardNo || "";
        const primaryMovementId = planned.allocations[0]?.movementId || newId("MOV");

        const issueRecord: DispatchStoreIssueRecord = {
          id: issueId,
          jobCardNo: primaryJobCardNo,
          itemName: planned.targetItemName,
          itemCode: planned.targetItemCode || planned.itemStock.itemCode,
          fromDepartment: "Store",
          toDepartment: "Dispatch",
          issuedBagQty: planned.bag,
          issuedPcsQty: planned.pcs,
          issuedKgQty: planned.kg,
          issuedBy: input.actor.userName || input.actor.userId,
          issuedAt: now,
          remarks: planned.remarks ? String(planned.remarks) : (input.remarks ? String(input.remarks) : undefined),
          operationId: opKey,
          movementId: primaryMovementId,
          sourceAllocations: planned.allocations,
          nativeUnit: planned.allocations[0]?.nativeUnit || "KG",
          nativeDeductedQty: planned.allocations.reduce((s, a) => s + (a.nativeDeductedQty || 0), 0)
        };

        for (const alloc of planned.allocations) {
          const mov = {
            movementId: alloc.movementId,
            jobCardNo: alloc.jobCardNo,
            fromDepartment: "Store",
            toDepartment: "Dispatch",
            quantity: alloc.nativeDeductedQty || 0,
            unit: alloc.nativeUnit || "KG",
            initiatedBy: input.actor.userId,
            initiatedByUserName: input.actor.userName || input.actor.userId,
            accepted: false,
            acceptedQty: 0,
            rejectedQty: 0,
            transactionType: "TRANSFER",
            operationId: opKey,
            isIssueRequest: false,
            remarks:
              planned.remarks ||
              input.remarks ||
              `Direct Store → Dispatch issue for ${planned.targetItemName}: ${alloc.allocatedBagQty} BAG, ${alloc.allocatedPcsQty} PCS, ${alloc.allocatedKgQty} KG`,
            processDetails: {
              directStoreIssueId: issueId,
              itemName: planned.targetItemName,
              itemCode: planned.targetItemCode || planned.itemStock.itemCode,
              issuedBagQty: alloc.allocatedBagQty,
              issuedPcsQty: alloc.allocatedPcsQty,
              issuedKgQty: alloc.allocatedKgQty,
              nativeUnit: alloc.nativeUnit || "KG",
              nativeDeductedQty: alloc.nativeDeductedQty || 0
            },
            createdAt: now
          };
          tx.set("mfr_movements", mov.movementId, mov);
          createdMovements.push(mov);
        }

        tx.set(DISPATCH_STORE_ISSUE_COLLECTION, issueRecord.id, issueRecord);
        createdIssues.push(issueRecord);
      }

      tx.set("mfr_idempotency_keys", opKey, {
        operationId: opKey,
        requestFingerprint,
        result: { issues: createdIssues, movements: createdMovements }
      });

      return { success: true, data: { issues: createdIssues, movements: createdMovements } };
    })
  ).then(async (result) => {
    if (result.success && !result.cached && result.data) {
      const { issues } = result.data;
      const itemListStr = issues.map((iss) => `'${iss.itemName}' (${iss.issuedKgQty} KG, ${iss.issuedPcsQty} PCS, ${iss.issuedBagQty} BAG)`).join("; ");
      await writeAudit(
        store,
        input.actor,
        "DISPATCH_STORE_BATCH_ISSUE",
        `Direct batch issue from Store to Dispatch for ${issues.length} item(s): ${itemListStr}.`,
        issues[0]?.issuedAt || new Date().toISOString()
      );
    }
    return result;
  });
}

export async function issueStoreItemToDispatchTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    itemName?: string;
    itemCode?: string;
    jobCardNo?: string;
    issuedBagQty?: unknown;
    issuedPcsQty?: unknown;
    issuedKgQty?: unknown;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ issue: DispatchStoreIssueRecord; movements: any[] }>> {
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return {
      success: false,
      statusCode: 400,
      error: "operationId is required. Retry the same issue with the identical operationId to avoid duplicate deductions."
    };
  }
  if (!store.runTransaction) {
    return { success: false, statusCode: 500, error: "Atomic transaction store is required for Store → Dispatch issue." };
  }

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
    return { success: false, statusCode: 403, error: "Only Store (or admin) can issue material to Dispatch." };
  }

  const serializeKey = dispatchStoreSerializeKey(input.itemName || input.jobCardNo || "global");

  return runSerialized(store, serializeKey, () =>
    store.runTransaction!(async (tx) => {
      const now = input.nowIso || new Date().toISOString();

      let targetItemName = String(input.itemName || "").trim();
      let targetItemCode = String(input.itemCode || "").trim();

      const allJobCards = await store.list("mfr_job_cards");
      const allMovements = await store.list("mfr_movements");
      const allIssues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);

      if (!targetItemName && input.jobCardNo) {
        const jcNo = normalizeJobCardNo(input.jobCardNo);
        const j = allJobCards.find((card: any) => normalizeJobCardNo(card?.jobCardNo) === jcNo);
        if (j) {
          targetItemName = String(j.itemName || "");
          if (!targetItemCode && j.itemCode) targetItemCode = String(j.itemCode);
        } else {
          return { success: false, statusCode: 404, error: `Job Card '${input.jobCardNo}' not found.` };
        }
      }

      if (!targetItemName) {
        return { success: false, statusCode: 400, error: "Item Name (or Job Card) is required." };
      }

      const requestFingerprint = createDispatchStoreIssueFingerprint({
        itemName: targetItemName,
        itemCode: targetItemCode,
        jobCardNo: input.jobCardNo,
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
      if (existing?.result?.issue && existing?.result?.movements) {
        return {
          success: true,
          cached: true,
          data: {
            issue: existing.result.issue,
            movements: existing.result.movements
          }
        };
      }

      // If specific jobCardNo was targeted, filter to that single Job Card; otherwise aggregate across all item Job Cards.
      let itemStock: AuthoritativeItemStockSummary;
      if (input.jobCardNo) {
        const jcNo = normalizeJobCardNo(input.jobCardNo);
        const singleJob = allJobCards.find((c: any) => normalizeJobCardNo(c?.jobCardNo) === jcNo);
        if (!singleJob) {
          return { success: false, statusCode: 404, error: `Job Card '${input.jobCardNo}' not found.` };
        }
        const singleStock = calculateStoreJobCardAvailableStock(singleJob, allMovements, allIssues);
        itemStock = {
          itemName: singleJob.itemName,
          itemCode: singleJob.itemCode,
          availableKg: singleStock.availableKg,
          availableBags: singleStock.availableBags,
          availablePcs: singleStock.availablePcs,
          candidateJobCards: [
            {
              jobCardNo: jcNo,
              itemCode: singleJob.itemCode,
              itemName: singleJob.itemName,
              partyName: singleJob.partyName,
              createdAt: singleJob.createdAt,
              availableKg: singleStock.availableKg,
              availableBags: singleStock.availableBags,
              availablePcs: singleStock.availablePcs,
              nativeUnit: singleStock.nativeUnit,
              onHandNative: singleStock.onHandNative
            }
          ]
        };
      } else {
        itemStock = calculateStoreAuthoritativeItemStock(
          targetItemName,
          allJobCards,
          allMovements,
          allIssues,
          targetItemCode
        );
      }

      // Strict validation: every unit requested must be <= available stock for that unit
      if (bag.qty > itemStock.availableBags) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered BAG quantity (${bag.qty}) exceeds available Store stock (${itemStock.availableBags} BAG) for '${targetItemName}'.`
        };
      }
      if (pcs.qty > itemStock.availablePcs) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered PCS quantity (${pcs.qty}) exceeds available Store stock (${itemStock.availablePcs} PCS) for '${targetItemName}'.`
        };
      }
      if (kg.qty > itemStock.availableKg) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered KG quantity (${kg.qty}) exceeds available Store stock (${itemStock.availableKg} KG) for '${targetItemName}'.`
        };
      }

      // Allocate across candidate Job Cards
      const allocationResult = allocateItemStockAcrossJobCards(
        itemStock.candidateJobCards,
        kg.qty,
        bag.qty,
        pcs.qty
      );
      if (!allocationResult.success) {
        return {
          success: false,
          statusCode: 409,
          error: (allocationResult as { success: false; error: string }).error
        };
      }

      const allocations = allocationResult.allocations;
      const issueId = newId("DSI");
      const primaryJobCardNo = allocations[0]?.jobCardNo || input.jobCardNo || "";
      const primaryMovementId = allocations[0]?.movementId || newId("MOV");

      const issueRecord: DispatchStoreIssueRecord = {
        id: issueId,
        jobCardNo: primaryJobCardNo,
        itemName: targetItemName,
        itemCode: targetItemCode || itemStock.itemCode,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        issuedBagQty: bag.qty,
        issuedPcsQty: pcs.qty,
        issuedKgQty: kg.qty,
        issuedBy: input.actor.userName || input.actor.userId,
        issuedAt: now,
        remarks: input.remarks ? String(input.remarks) : undefined,
        operationId: opKey,
        movementId: primaryMovementId,
        sourceAllocations: allocations,
        nativeUnit: allocations[0]?.nativeUnit || "KG",
        nativeDeductedQty: allocations.reduce((s, a) => s + (a.nativeDeductedQty || 0), 0)
      };

      const createdMovements: any[] = [];

      for (const alloc of allocations) {
        const mov = {
          movementId: alloc.movementId,
          jobCardNo: alloc.jobCardNo,
          fromDepartment: "Store",
          toDepartment: "Dispatch",
          quantity: alloc.nativeDeductedQty || 0,
          unit: alloc.nativeUnit || "KG",
          initiatedBy: input.actor.userId,
          initiatedByUserName: input.actor.userName || input.actor.userId,
          accepted: false,
          acceptedQty: 0,
          rejectedQty: 0,
          transactionType: "TRANSFER",
          operationId: opKey,
          isIssueRequest: false,
          remarks:
            input.remarks ||
            `Direct Store → Dispatch issue for ${targetItemName}: ${alloc.allocatedBagQty} BAG, ${alloc.allocatedPcsQty} PCS, ${alloc.allocatedKgQty} KG`,
          processDetails: {
            directStoreIssueId: issueId,
            itemName: targetItemName,
            itemCode: targetItemCode || itemStock.itemCode,
            issuedBagQty: alloc.allocatedBagQty,
            issuedPcsQty: alloc.allocatedPcsQty,
            issuedKgQty: alloc.allocatedKgQty,
            nativeUnit: alloc.nativeUnit || "KG",
            nativeDeductedQty: alloc.nativeDeductedQty || 0
          },
          createdAt: now
        };
        tx.set("mfr_movements", mov.movementId, mov);
        createdMovements.push(mov);
      }

      tx.set(DISPATCH_STORE_ISSUE_COLLECTION, issueRecord.id, issueRecord);
      tx.set("mfr_idempotency_keys", opKey, {
        operationId: opKey,
        requestFingerprint,
        result: { issue: issueRecord, movements: createdMovements }
      });

      return { success: true, data: { issue: issueRecord, movements: createdMovements } };
    })
  ).then(async (result) => {
    if (result.success && !result.cached && result.data) {
      const { issue } = result.data;
      const jobList = (issue.sourceAllocations || []).map((a) => a.jobCardNo).join(", ");
      await writeAudit(
        store,
        input.actor,
        "DISPATCH_STORE_ISSUE",
        `Direct issue from Store to Dispatch for item '${issue.itemName}' (Job Cards: ${jobList}): BAG ${issue.issuedBagQty}, PCS ${issue.issuedPcsQty}, KG ${issue.issuedKgQty}.`,
        issue.issuedAt
      );
    }
    return result;
  });
}

/**
 * Backward compatibility wrapper for single Job Card Store → Dispatch issue.
 */
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
): Promise<DispatchStoreTxResult<{ issue: DispatchStoreIssueRecord; movement: any }>> {
  const res = await issueStoreItemToDispatchTx(store, {
    operationId: input.operationId,
    jobCardNo: input.jobCardNo,
    issuedBagQty: input.issuedBagQty,
    issuedPcsQty: input.issuedPcsQty,
    issuedKgQty: input.issuedKgQty,
    remarks: input.remarks,
    actor: input.actor,
    nowIso: input.nowIso
  });
  if (!res.success) return res as any;
  return {
    success: true,
    cached: res.cached,
    data: {
      issue: res.data!.issue,
      movement: res.data!.movements[0]
    }
  };
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
): Promise<DispatchStoreTxResult<{ requirement?: DispatchStoreRequirementRecord; issue: DispatchStoreIssueRecord; movement: any }>> {
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
  return issueStoreToDispatchTx(store, {
    operationId: input.operationId,
    jobCardNo,
    issuedBagQty: input.issuedBagQty,
    issuedPcsQty: input.issuedPcsQty,
    issuedKgQty: input.issuedKgQty,
    remarks: input.remarks,
    actor: input.actor,
    nowIso: input.nowIso
  });
}

/**
 * Server-side authoritative Store → Process Transfer (Repacking & Replating) transaction.
 */
export async function issueStoreProcessTransferTx(
  store: SimpleStore,
  input: {
    operationId?: string;
    toProcess: "Repacking" | "Replating";
    itemName?: string;
    itemCode?: string;
    jobCardNo?: string;
    issuedKgQty: unknown;
    issuedPcsQty?: unknown;
    issuedBagQty?: unknown;
    remarks?: string;
    actor: ActorLike;
    nowIso?: string;
  }
): Promise<DispatchStoreTxResult<{ transfer: ProcessTransfer; movements: any[] }>> {
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return {
      success: false,
      statusCode: 400,
      error: "operationId is required. Retry with the identical operationId to avoid duplicate deductions."
    };
  }
  if (!store.runTransaction) {
    return { success: false, statusCode: 500, error: "Atomic transaction store is required for Store process transfer." };
  }

  const toProcess = input.toProcess;
  if (toProcess !== "Repacking" && toProcess !== "Replating") {
    return {
      success: false,
      statusCode: 400,
      error: "Process destination must be either 'Repacking' or 'Replating'."
    };
  }

  const kg = parseStrictPositiveKgQty(input.issuedKgQty);
  if (kg.ok === false) return { success: false, statusCode: 400, error: kg.error };

  const pcs = parseOptionalNonNegativeQty(input.issuedPcsQty);
  if (pcs.ok === false) return { success: false, statusCode: 400, error: pcs.error };

  const bag = parseOptionalNonNegativeQty(input.issuedBagQty);
  if (bag.ok === false) return { success: false, statusCode: 400, error: bag.error };

  if (!canIssueDispatchStoreStock(input.actor)) {
    return { success: false, statusCode: 403, error: "Only Store (or admin) can issue material for process transfers." };
  }

  const serializeKey = dispatchStoreSerializeKey(input.itemName || input.jobCardNo || `process_${toProcess.toLowerCase()}`);

  return runSerialized(store, serializeKey, () =>
    store.runTransaction!(async (tx) => {
      const now = input.nowIso || new Date().toISOString();

      let targetItemName = String(input.itemName || "").trim();
      let targetItemCode = String(input.itemCode || "").trim();

      const allJobCards = await store.list("mfr_job_cards");
      const allMovements = await store.list("mfr_movements");
      const allIssues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
      const allTransfers = await store.list("mfr_process_transfers");

      if (!targetItemName && input.jobCardNo) {
        const jcNo = normalizeJobCardNo(input.jobCardNo);
        const j = allJobCards.find((card: any) => normalizeJobCardNo(card?.jobCardNo) === jcNo);
        if (j) {
          targetItemName = String(j.itemName || "");
          if (!targetItemCode && j.itemCode) targetItemCode = String(j.itemCode);
        } else {
          return { success: false, statusCode: 404, error: `Job Card '${input.jobCardNo}' not found.` };
        }
      }

      if (!targetItemName) {
        return { success: false, statusCode: 400, error: "Item Name (or Job Card) is required." };
      }

      const requestFingerprint = createStoreProcessTransferFingerprint({
        toProcess,
        itemName: targetItemName,
        itemCode: targetItemCode,
        jobCardNo: input.jobCardNo,
        issuedBagQty: bag.qty,
        issuedPcsQty: pcs.qty,
        issuedKgQty: kg.qty
      });

      const existing = await tx.get("mfr_idempotency_keys", opKey);
      if (existing?.requestFingerprint && existing.requestFingerprint !== requestFingerprint) {
        return {
          success: false,
          statusCode: 409,
          error: "operationId was already used for a different Store process transfer. Use a new operationId for a distinct issue."
        };
      }
      if (existing?.result?.transfer && existing?.result?.movements) {
        return {
          success: true,
          cached: true,
          data: {
            transfer: existing.result.transfer,
            movements: existing.result.movements
          }
        };
      }

      let itemStock: AuthoritativeItemStockSummary;
      if (input.jobCardNo) {
        const jcNo = normalizeJobCardNo(input.jobCardNo);
        const singleJob = allJobCards.find((c: any) => normalizeJobCardNo(c?.jobCardNo) === jcNo);
        if (!singleJob) {
          return { success: false, statusCode: 404, error: `Job Card '${input.jobCardNo}' not found.` };
        }
        const singleStock = calculateStoreJobCardAvailableStock(singleJob, allMovements, allIssues, allTransfers);
        itemStock = {
          itemName: singleJob.itemName,
          itemCode: singleJob.itemCode,
          availableKg: singleStock.availableKg,
          availableBags: singleStock.availableBags,
          availablePcs: singleStock.availablePcs,
          candidateJobCards: [
            {
              jobCardNo: jcNo,
              itemCode: singleJob.itemCode,
              itemName: singleJob.itemName,
              partyName: singleJob.partyName,
              createdAt: singleJob.createdAt,
              availableKg: singleStock.availableKg,
              availableBags: singleStock.availableBags,
              availablePcs: singleStock.availablePcs,
              nativeUnit: singleStock.nativeUnit,
              onHandNative: singleStock.onHandNative
            }
          ]
        };
      } else {
        itemStock = calculateStoreAuthoritativeItemStock(
          targetItemName,
          allJobCards,
          allMovements,
          allIssues,
          targetItemCode,
          allTransfers
        );
      }

      // Strict validation: every unit requested must be <= available stock for that unit
      if (kg.qty > itemStock.availableKg) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered KG quantity (${kg.qty}) exceeds available Store stock (${itemStock.availableKg} KG) for '${targetItemName}'.`
        };
      }
      if (pcs.qty > itemStock.availablePcs) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered PCS quantity (${pcs.qty}) exceeds available Store stock (${itemStock.availablePcs} PCS) for '${targetItemName}'.`
        };
      }
      if (bag.qty > itemStock.availableBags) {
        return {
          success: false,
          statusCode: 409,
          error: `Entered BAG quantity (${bag.qty}) exceeds available Store stock (${itemStock.availableBags} BAG) for '${targetItemName}'.`
        };
      }

      // Allocate across candidate Job Cards
      const allocationResult = allocateItemStockAcrossJobCards(
        itemStock.candidateJobCards,
        kg.qty,
        bag.qty,
        pcs.qty
      );
      if (!allocationResult.success) {
        return {
          success: false,
          statusCode: 409,
          error: (allocationResult as { success: false; error: string }).error
        };
      }

      const allocations = allocationResult.allocations;
      const transferId = newId("STP");
      let nextNum = 1;
      for (const t of allTransfers || []) {
        if (t?.transferNo && typeof t.transferNo === "string" && t.transferNo.startsWith("STP-")) {
          const numPart = parseInt(t.transferNo.replace("STP-", ""), 10);
          if (!isNaN(numPart) && numPart >= nextNum) {
            nextNum = numPart + 1;
          }
        }
      }
      const transferNo = `STP-${String(nextNum).padStart(6, "0")}`;

      const primaryJobCardNo = allocations[0]?.jobCardNo || input.jobCardNo || "";
      const primaryPartyName = allocations[0]?.jobCardNo
        ? allJobCards.find((c: any) => normalizeJobCardNo(c?.jobCardNo) === normalizeJobCardNo(allocations[0].jobCardNo))?.partyName
        : "Internal Store Stock";

      const destinationDept = toProcess === "Repacking" ? "Packing" : "Plating";
      const initialStatus = toProcess === "Repacking" ? "Sent to Repacking" : "Sent to Replating";

      const createdMovements: any[] = [];
      for (const alloc of allocations) {
        const mov = {
          movementId: alloc.movementId,
          jobCardNo: alloc.jobCardNo,
          fromDepartment: "Store",
          toDepartment: destinationDept,
          quantity: alloc.allocatedKgQty,
          unit: "KG",
          initiatedBy: input.actor.userId,
          initiatedByUserName: input.actor.userName || input.actor.userId,
          accepted: false,
          acceptedQty: 0,
          rejectedQty: 0,
          transactionType: "TRANSFER",
          operationId: opKey,
          isIssueRequest: false,
          remarks:
            input.remarks ||
            `Store ${toProcess} transfer for ${targetItemName}: ${alloc.allocatedKgQty} KG (${alloc.allocatedBagQty} BAG, ${alloc.allocatedPcsQty} PCS)`,
          processDetails: {
            processTransferId: transferId,
            transferNo,
            toProcess,
            isProcessTransfer: true,
            itemName: targetItemName,
            itemCode: targetItemCode || itemStock.itemCode,
            issuedBagQty: alloc.allocatedBagQty,
            issuedPcsQty: alloc.allocatedPcsQty,
            issuedKgQty: alloc.allocatedKgQty,
            nativeUnit: alloc.nativeUnit || "KG",
            nativeDeductedQty: alloc.nativeDeductedQty || alloc.allocatedKgQty
          },
          createdAt: now
        };
        tx.set("mfr_movements", mov.movementId, mov);
        createdMovements.push(mov);
      }

      const transferRecord: ProcessTransfer = {
        transferId,
        transferNo,
        jobCardNo: primaryJobCardNo,
        customer: primaryPartyName || "Internal Store Stock",
        itemName: targetItemName,
        itemCode: targetItemCode || itemStock.itemCode,
        quantity: kg.qty,
        unit: "KGS",
        fromLocation: "Store",
        toProcess,
        status: initialStatus,
        transferDate: new Date(now).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
        transferTime: new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        createdBy: input.actor.userName || input.actor.userId,
        createdByUserId: input.actor.userId,
        remarks: input.remarks ? String(input.remarks) : undefined,
        idempotencyKey: opKey,
        issuedKgQty: kg.qty,
        issuedBagQty: bag.qty,
        issuedPcsQty: pcs.qty,
        sourceAllocations: allocations,
        createdAt: now,
        updatedAt: now
      };

      tx.set("mfr_process_transfers", transferRecord.transferId, transferRecord);
      tx.set("mfr_idempotency_keys", opKey, {
        operationId: opKey,
        requestFingerprint,
        result: { transfer: transferRecord, movements: createdMovements }
      });

      return { success: true, data: { transfer: transferRecord, movements: createdMovements } };
    })
  ).then(async (result) => {
    if (result.success && !result.cached && result.data) {
      const { transfer } = result.data;
      const jobList = (transfer.sourceAllocations || []).map((a) => a.jobCardNo).join(", ");
      await writeAudit(
        store,
        input.actor,
        "STORE_PROCESS_TRANSFER",
        `Store sent material to ${transfer.toProcess} for item '${transfer.itemName}' (Job Cards: ${jobList}): ${transfer.quantity} KG (Physical deductions: BAG ${transfer.issuedBagQty || 0}, PCS ${transfer.issuedPcsQty || 0}, KG ${transfer.issuedKgQty || 0}).`,
        transfer.createdAt
      );
    }
    return result;
  });
}
