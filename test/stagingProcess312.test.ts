/**
 * Process 312 — staging Firestore integration for Process 210 (KG-only Store→Plating)
 * and Process 248 (optional Other RM). Uses Firebase Admin / ADC like Process 147.
 * MemoryStore unit files are not this suite and must not be treated as staging evidence.
 */
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { assertNotProductionTarget } from "../src/hardening/envGuard";
import { STORE_PLATING_KG_ONLY_ERROR, STORE_PLATING_KG_REQUIRED_ERROR } from "../src/hardening/storePlatingKgOnly";
import { INCOMING_STORE, RAW_MATERIAL_STORE } from "../src/hardening/process1Purchase";
import { computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";
import {
  canStartProductionWithRm,
  getAcceptedRawMaterialIssuedQty,
  getTotalAcceptedProductionRawMaterialQty,
  productionSendAvailable,
  unproducedOrderQty
} from "../src/hardening/process2Manufacturing";
import {
  computeIncomingStoreOtherRmStock,
  getAcceptedOtherRawMaterialIssuedQty,
  netProductionQty,
  otherRawMaterialRowsOptionalValid,
  totalRawMaterialWeight
} from "../src/hardening/process248OtherRawMaterial";

const STAGING_PROJECT_ID = "pmw-tracker-staging-9ca72";
const STAGING_DATABASE_ID = "ai-studio-staging";
const STAGING_SERVICE_URL = "https://pmw-tracker-staging-he6d6xvtxq-el.a.run.app";

assertNotProductionTarget({
  projectId: STAGING_PROJECT_ID,
  databaseId: STAGING_DATABASE_ID,
  url: STAGING_SERVICE_URL
});

if (STAGING_PROJECT_ID !== "pmw-tracker-staging-9ca72") {
  throw new Error("FAIL-CLOSED: staging project constant mismatch; aborting before any write.");
}
if (STAGING_DATABASE_ID !== "ai-studio-staging") {
  throw new Error("FAIL-CLOSED: staging database constant mismatch; aborting before any write.");
}

const testPrefix = `P312-${Date.now()}`;

type TrackedDoc = { collection: string; id: string };

class FirestoreSimpleStore {
  private locks = new Map<string, Promise<any>>();
  created: TrackedDoc[] = [];
  constructor(private db: any) {}

  async runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let resolveLock: () => void;
    const next = new Promise<void>((r) => {
      resolveLock = r;
    });
    this.locks.set(key, prev.then(() => next));
    try {
      await prev;
      return await fn();
    } finally {
      resolveLock!();
    }
  }

  async get(collection: string, id: string): Promise<any | null> {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    this.created.push({ collection, id });
    await this.db.collection(collection).doc(id).set(data, { merge: true });
  }

  async list(collection: string): Promise<any[]> {
    const snap = await this.db.collection(collection).get();
    return snap.docs.map((doc) => doc.data());
  }
}

function actor(dept: string, extra: Partial<{ role: string; allowedDepartments: string[]; userId: string }> = {}) {
  const extraDepts =
    dept === "Purchase" ? ["Incoming Store"] : dept === "Incoming Store" ? ["Purchase"] : extra.allowedDepartments || [dept];
  const allowed = extra.allowedDepartments || [dept, ...extraDepts.filter((d) => d !== dept)];
  return {
    userId: extra.userId || `p312-${testPrefix}-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `P312 ${dept} User`,
    uid: extra.userId || `p312-${testPrefix}-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    email: `p312-${dept.replace(/\s+/g, "-").toLowerCase()}@pmw-staging.local`,
    role: extra.role || "staff",
    department: dept,
    allowedDepartments: allowed,
    accessList: allowed
  };
}

let passed = 0;
let failed = 0;
let passed210 = 0;
let failed210 = 0;
let passed248 = 0;
let failed248 = 0;
let section: "210" | "248" | "setup" = "setup";

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    if (section === "210") passed210++;
    if (section === "248") passed248++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    if (section === "210") failed210++;
    if (section === "248") failed248++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function isCredentialGap(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  return (
    msg.includes("Could not load the default credentials") ||
    msg.includes("default credentials") ||
    msg.includes("UNAUTHENTICATED") ||
    msg.includes("credential") ||
    msg.includes("Unable to detect a Project Id")
  );
}

async function prefixDocs(db: any, collection: string, field: string): Promise<any[]> {
  const snap = await db
    .collection(collection)
    .where(field, ">=", testPrefix)
    .where(field, "<", `${testPrefix}\uf8ff`)
    .get();
  return snap.docs;
}

async function cleanupP312(db: any, store: FirestoreSimpleStore): Promise<{
  created: number;
  removed: number;
  residual: number;
}> {
  const seen = new Set<string>();
  const queue: TrackedDoc[] = [...store.created];

  const extras = (
    await Promise.all([
      prefixDocs(db, "mfr_job_cards", "jobCardNo"),
      prefixDocs(db, "mfr_movements", "jobCardNo"),
      prefixDocs(db, "mfr_idempotency_keys", "operationId"),
      db
        .collection("mfr_movements")
        .where("jobCardNo", ">=", `STOCK-IN-${testPrefix}`)
        .where("jobCardNo", "<", `STOCK-IN-${testPrefix}\uf8ff`)
        .get()
        .then((s: any) => s.docs)
    ])
  ).flat();
  for (const doc of extras) {
    queue.push({ collection: doc.ref.parent.id, id: doc.id });
  }

  let removed = 0;
  for (const { collection, id } of queue) {
    const key = `${collection}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await db.collection(collection).doc(id).delete();
      removed++;
    } catch (err) {
      console.error(`CLEANUP delete failed ${key}:`, err);
    }
  }

  const leftover = (
    await Promise.all([
      prefixDocs(db, "mfr_job_cards", "jobCardNo"),
      prefixDocs(db, "mfr_movements", "jobCardNo"),
      prefixDocs(db, "mfr_idempotency_keys", "operationId"),
      db
        .collection("mfr_movements")
        .where("jobCardNo", ">=", `STOCK-IN-${testPrefix}`)
        .where("jobCardNo", "<", `STOCK-IN-${testPrefix}\uf8ff`)
        .get()
        .then((s: any) => s.docs)
    ])
  ).flat();
  return { created: store.created.length, removed, residual: leftover.length };
}

async function seedStoreJob(store: FirestoreSimpleStore, jobCardNo: string, qty = 1000) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty: qty,
    currentQty: qty,
    currentDepartment: "Store",
    currentDept: "Store",
    status: "In Process",
    unit: "PCS",
    itemName: "P312 Store Bolt",
    itemCode: `${jobCardNo}-BLT`,
    version: 1,
    createdAt: new Date().toISOString(),
    tags: ["PROCESS312_TEST_DATA"]
  });
}

async function seedProductionJob(store: FirestoreSimpleStore, jobCardNo: string, orderQty = 1000) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty,
    currentQty: orderQty,
    currentDepartment: "Production",
    currentDept: "Production",
    status: "Pending",
    processType: "Manufacturing",
    itemName: "P312 6x13 MS Double Washer Screw",
    unit: "KGS",
    version: 1,
    createdAt: new Date().toISOString(),
    tags: ["PROCESS312_TEST_DATA"]
  });
}

async function purchaseWire(store: FirestoreSimpleStore, code: string, qty: number, op: string, billNo: string) {
  return commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo: `STOCK-IN-${code}`,
    fromDepartment: "Purchase",
    toDepartment: RAW_MATERIAL_STORE,
    quantity: qty,
    processDetails: {
      rawMaterialCode: code,
      itemCode: code,
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "P312 Wire Mills",
      billNo
    },
    extra: { itemCode: code, itemName: "P312 Wire 8mm", isWire: true },
    actor: actor("Purchase")
  });
}

async function purchaseOtherRm(store: FirestoreSimpleStore, code: string, name: string, qty: number, op: string, billNo: string) {
  return commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo: `STOCK-IN-${code}`,
    fromDepartment: "Purchase",
    toDepartment: INCOMING_STORE,
    quantity: qty,
    processDetails: {
      rawMaterialCode: code,
      rawMaterialName: name,
      itemCode: code,
      isWire: false,
      rawMaterialKind: "Other",
      materialType: "Raw Material",
      supplierName: "P312 Washer Mill",
      billNo
    },
    extra: { itemCode: code, itemName: name, isWire: false },
    actor: actor("Purchase")
  });
}

async function issueWire(store: FirestoreSimpleStore, jobCardNo: string, code: string, qty: number, op: string) {
  const issue = await commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo,
    fromDepartment: RAW_MATERIAL_STORE,
    toDepartment: "Production",
    quantity: qty,
    isIssueRequest: true,
    requestedQty: qty,
    processDetails: { rawMaterialCode: code, isWire: true, rawMaterialKind: "Wire" },
    actor: actor("Raw Material Store")
  });
  if (!issue.success) return issue;
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-issued`,
    movementId: issue.movement.movementId,
    issueStatus: "Issued",
    actor: actor("Raw Material Store")
  });
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-custody`,
    movementId: issue.movement.movementId,
    actor: actor("Production")
  });
  return issue;
}

async function issueOtherRm(store: FirestoreSimpleStore, jobCardNo: string, code: string, name: string, qty: number, op: string) {
  const issue = await commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo,
    fromDepartment: INCOMING_STORE,
    toDepartment: "Production",
    quantity: qty,
    isIssueRequest: true,
    requestedQty: qty,
    unit: "KGS",
    processDetails: {
      isOtherRawMaterialIssue: true,
      isWire: false,
      rawMaterialKind: "Other",
      rawMaterialCode: code,
      rawMaterialName: name,
      unit: "KG"
    },
    actor: actor("Purchase")
  });
  if (!issue.success) return issue;
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-issued`,
    movementId: issue.movement.movementId,
    issueStatus: "Issued",
    actor: actor("Purchase")
  });
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-custody`,
    movementId: issue.movement.movementId,
    actor: actor("Production")
  });
  return issue;
}

function prefixedMoves(all: any[], jobCardNo: string) {
  return (all || []).filter((m) => String(m?.jobCardNo || "") === jobCardNo);
}

async function runProcess312() {
  const blockIfNoAdc = (reason: unknown) => {
    if (isCredentialGap(reason)) {
      printBlocked("Staging Firestore ADC/WIF unavailable; no further writes attempted.");
      printReport({ created: 0, removed: 0, residual: 0 }, "BLOCKED");
      process.exit(0);
    }
  };
  process.on("unhandledRejection", blockIfNoAdc);
  process.on("uncaughtException", blockIfNoAdc);

  console.log("=================================================");
  console.log("PROCESS 312 staging integration (210 + 248)");
  console.log(`Target project: ${STAGING_PROJECT_ID}`);
  console.log(`Target database: ${STAGING_DATABASE_ID}`);
  console.log(`Timestamp prefix: ${testPrefix}`);
  console.log("=================================================");

  let app;
  try {
    app =
      getApps().length === 0
        ? initializeApp({ projectId: STAGING_PROJECT_ID }, "stagingApp312")
        : getApp("stagingApp312");
  } catch (err: any) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCP_SA_KEY) {
      printBlocked("Firebase Admin did not initialize (ADC/WIF not configured).");
      process.exit(0);
    }
    throw err;
  }

  const db = getFirestore(app, STAGING_DATABASE_ID);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {}

  const store = new FirestoreSimpleStore(db);
  let cleanupStats = { created: 0, removed: 0, residual: -1 };
  let skipRemoteCleanup = false;

  try {
    const ping = await db.collection("mfr_job_cards").doc(`${testPrefix}-PING`).get();
    assert("setup Firestore reachable (read)", ping.exists === false || ping.exists === true);

    section = "210";
    const jcKg = `${testPrefix}-JC-210-KG`;
    await seedStoreJob(store, jcKg, 1000);
    const kgOk = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-kg`,
      jobCardNo: jcKg,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      unit: "KG",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("210 A Store → Plating KG succeeds", kgOk.success === true && kgOk.movement?.quantity === 200, kgOk.error);

    const jcKgs = `${testPrefix}-JC-210-KGS`;
    await seedStoreJob(store, jcKgs, 1000);
    const kgsOk = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-kgs`,
      jobCardNo: jcKgs,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 80,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("210 B Store → Plating KGS succeeds", kgsOk.success === true && kgsOk.movement?.unit === "KGS", kgsOk.error);

    const jcPcs = `${testPrefix}-JC-210-PCS`;
    await seedStoreJob(store, jcPcs, 1000);
    const beforePcs = (await store.list("mfr_movements")).filter((m) => String(m.jobCardNo || "") === jcPcs).length;
    const pcsBad = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-pcs`,
      jobCardNo: jcPcs,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      unit: "PCS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    const afterPcs = (await store.list("mfr_movements")).filter((m) => String(m.jobCardNo || "") === jcPcs);
    assert(
      "210 C Store → Plating PCS rejects",
      pcsBad.success === false && pcsBad.statusCode === 400 && String(pcsBad.error) === STORE_PLATING_KG_ONLY_ERROR,
      pcsBad.error
    );
    assert("210 D PCS rejection creates no ledger movement", afterPcs.length === beforePcs);

    const jcMissing = `${testPrefix}-JC-210-MISS`;
    await seedStoreJob(store, jcMissing, 1000);
    const missing = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-missing`,
      jobCardNo: jcMissing,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert(
      "210 E missing unit rejects",
      missing.success === false && String(missing.error) === STORE_PLATING_KG_REQUIRED_ERROR,
      missing.error
    );

    const jcReplate = `${testPrefix}-JC-210-REPL`;
    await seedStoreJob(store, jcReplate, 1000);
    const beforeRepl = prefixedMoves(await store.list("mfr_movements"), jcReplate).length;
    const replate = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-replating-pcs`,
      jobCardNo: jcReplate,
      fromDepartment: "Store",
      toDepartment: "Replating",
      quantity: 20,
      unit: "PCS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    const afterRepl = prefixedMoves(await store.list("mfr_movements"), jcReplate);
    assert("210 F Store → Replating PCS rejects", replate.success === false, replate.error);
    assert("210 F Replating PCS no ledger row", afterRepl.length === beforeRepl);

    const jcRepack = `${testPrefix}-JC-210-PACK`;
    await seedStoreJob(store, jcRepack, 1000);
    const repack = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-repacking-pcs`,
      jobCardNo: jcRepack,
      fromDepartment: "Store",
      toDepartment: "Packing",
      quantity: 10,
      unit: "PCS",
      extra: { unit: "PCS" },
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("210 G Store → Packing/Repacking PCS remains allowed", repack.success === true, repack.error);

    // Dedicated card: Store→Plating is locked to one pending handover per job.
    // Reusing jcKg (already has an unaccepted 200 KG send) would hit that lock,
    // not the operationId cache path. MemoryStore Process 210 uses a fresh job too.
    const jcIdemp = `${testPrefix}-JC-210-IDEMP`;
    await seedStoreJob(store, jcIdemp, 1000);
    const firstId = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-idemp`,
      jobCardNo: jcIdemp,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 15,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    const retryId = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-idemp`,
      jobCardNo: jcIdemp,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 15,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    const idempMoves = prefixedMoves(await store.list("mfr_movements"), jcIdemp).filter(
      (m) => String(m.fromDepartment || "") === "Store" && String(m.toDepartment || "") === "Plating"
    );
    assert(
      "210 duplicate operationId is cached",
      firstId.success === true &&
        retryId.success === true &&
        retryId.cached === true &&
        retryId.movement?.movementId === firstId.movement?.movementId &&
        idempMoves.length === 1,
      `first=${firstId.success} ${firstId.error || ""} retry=${retryId.success} cached=${retryId.cached} ${retryId.error || ""} moves=${idempMoves.length}`
    );

    const jcConc = `${testPrefix}-JC-210-CONC`;
    await seedStoreJob(store, jcConc, 200);
    await store.set("mfr_movements", `${testPrefix}-M-IN-200`, {
      movementId: `${testPrefix}-M-IN-200`,
      jobCardNo: jcConc,
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 200,
      accepted: true,
      unit: "KGS"
    });
    const [ca, cb] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-210-conc-a`,
        jobCardNo: jcConc,
        fromDepartment: "Store",
        toDepartment: "Plating",
        quantity: 150,
        unit: "KGS",
        requireRawMaterialForProduction: false,
        actor: actor("Store")
      }),
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-210-conc-b`,
        jobCardNo: jcConc,
        fromDepartment: "Store",
        toDepartment: "Plating",
        quantity: 150,
        unit: "KGS",
        requireRawMaterialForProduction: false,
        actor: actor("Store")
      })
    ]);
    const concOk = [ca, cb].filter((r) => r.success).length;
    const concBad = [ca, cb].filter((r) => !r.success).length;
    const concQty = prefixedMoves(await store.list("mfr_movements"), jcConc)
      .filter((m) => String(m.fromDepartment || "") === "Store")
      .reduce((s, m) => s + Number(m.quantity || 0), 0);
    assert("210 concurrent 150+150 cannot exceed 200", concOk === 1 && concBad === 1 && concQty <= 200, `ok=${concOk} bad=${concBad} qty=${concQty}`);

    const forbidden = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-210-rbac`,
      jobCardNo: jcKg,
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 5,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Packing")
    });
    assert("210 RBAC packing cannot send Store→Plating", forbidden.success === false && forbidden.statusCode === 403, forbidden.error);

    section = "248";
    assert("248 Other RM optional when empty", otherRawMaterialRowsOptionalValid([]).ok === true);
    assert("248 helper 500+100+50-5=645", netProductionQty(totalRawMaterialWeight([500, 100, 50]), 5) === 645);

    const wireCode = `${testPrefix}-RM-WIRE-8MM`;
    const plainCode = `${testPrefix}-PLAIN-WASHER`;
    const springCode = `${testPrefix}-SPRING-WASHER`;
    const jc248 = `${testPrefix}-JC-248`;
    await seedProductionJob(store, jc248, 1000);

    const wireIn = await purchaseWire(store, wireCode, 1000, `${testPrefix}-248-w`, `${testPrefix}-INV-W`);
    assert("248 wire purchase commit", wireIn.success === true, wireIn.error);
    await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-w-acc`,
      movementId: wireIn.movement!.movementId,
      actor: actor("Raw Material Store")
    });
    const plainIn = await purchaseOtherRm(store, plainCode, "Plain Washer", 400, `${testPrefix}-248-pw`, `${testPrefix}-INV-PW`);
    assert("248 plain washer purchase", plainIn.success === true, plainIn.error);
    await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-pw-acc`,
      movementId: plainIn.movement!.movementId,
      actor: actor("Purchase")
    });
    const springIn = await purchaseOtherRm(store, springCode, "Spring Washer", 200, `${testPrefix}-248-sw`, `${testPrefix}-INV-SW`);
    assert("248 spring washer purchase", springIn.success === true, springIn.error);
    await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-sw-acc`,
      movementId: springIn.movement!.movementId,
      actor: actor("Purchase")
    });

    let moves = await store.list("mfr_movements");
    assert("248 incoming plain stock 400", computeIncomingStoreOtherRmStock(0, moves, plainCode) === 400);
    assert("248 incoming spring stock 200", computeIncomingStoreOtherRmStock(0, moves, springCode) === 200);
    assert("248 wire RM stock 1000 before issue", computeRmRuntimeStock(0, moves, wireCode) === 1000);

    const wireIssue = await issueWire(store, jc248, wireCode, 500, `${testPrefix}-248-issue-wire`);
    assert("248 Wire issue 500 via RM Store", wireIssue.success === true, wireIssue.error);
    const plainIssue = await issueOtherRm(store, jc248, plainCode, "Plain Washer", 100, `${testPrefix}-248-issue-pw`);
    assert("248 Plain Washer issue 100 from Incoming Store", plainIssue.success === true, plainIssue.error);
    const springIssue = await issueOtherRm(store, jc248, springCode, "Spring Washer", 50, `${testPrefix}-248-issue-sw`);
    assert("248 Spring Washer issue 50 from Incoming Store", springIssue.success === true, springIssue.error);

    moves = await store.list("mfr_movements");
    const job248 = await store.get("mfr_job_cards", jc248);
    assert("248 accepted Wire = 500", getAcceptedRawMaterialIssuedQty(job248, moves) === 500);
    assert("248 accepted Other RM = 150", getAcceptedOtherRawMaterialIssuedQty(job248, moves) === 150);
    assert("248 total accepted RM = 650", getTotalAcceptedProductionRawMaterialQty(job248, moves) === 650);
    assert("248 send available 650", productionSendAvailable(job248, moves, { compulsory: true }) === 650);
    assert("248 wire start compulsory ok without requiring Other RM", canStartProductionWithRm(job248, moves, { compulsory: true }).ok === true);
    assert("248 plain stock 300 after issue", computeIncomingStoreOtherRmStock(0, moves, plainCode) === 300);
    assert("248 spring stock 150 after issue", computeIncomingStoreOtherRmStock(0, moves, springCode) === 150);
    assert("248 wire stock 500 after issue", computeRmRuntimeStock(0, moves, wireCode) === 500);

    const prod645 = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-prod-645`,
      jobCardNo: jc248,
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 645,
      requireRawMaterialForProduction: true,
      processDetails: { producedQty: 645, wireScrapQty: 5 },
      actor: actor("Production")
    });
    moves = await store.list("mfr_movements");
    const after645 = await store.get("mfr_job_cards", jc248);
    assert("248 produce net 645 (scrap 5)", prod645.success === true, prod645.error);
    assert("248 remaining order 355", unproducedOrderQty(after645, moves) === 355);
    assert("248 job stays Production (partial)", after645.currentDepartment === "Production");

    const over = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-over`,
      jobCardNo: jc248,
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("248 over-completion rejected", over.success === false, over.error);

    const rest = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-prod-5`,
      jobCardNo: jc248,
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 5,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("248 leftover RM 5 still producible", rest.success === true, rest.error);

    const firstDup = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-idemp`,
      jobCardNo: jc248,
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 10,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: plainCode },
      actor: actor("Purchase")
    });
    const secondDup = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-idemp`,
      jobCardNo: jc248,
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 10,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: plainCode },
      actor: actor("Purchase")
    });
    assert("248 duplicate operationId does not double-post", firstDup.success === true && secondDup.cached === true, secondDup.error);

    const jcA = `${testPrefix}-JC-CONC-A`;
    const jcB = `${testPrefix}-JC-CONC-B`;
    await seedProductionJob(store, jcA, 1000);
    await seedProductionJob(store, jcB, 1000);
    const concSku = `${testPrefix}-CONC-WASHER`;
    const concBuy = await purchaseOtherRm(store, concSku, "Conc Washer", 100, `${testPrefix}-conc-p`, `${testPrefix}-INV-CONC`);
    await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-conc-p-a`,
      movementId: concBuy.movement!.movementId,
      actor: actor("Purchase")
    });
    const [ia, ib] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-conc-a`,
        jobCardNo: jcA,
        fromDepartment: INCOMING_STORE,
        toDepartment: "Production",
        quantity: 80,
        isIssueRequest: true,
        processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: concSku },
        actor: actor("Purchase")
      }),
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-conc-b`,
        jobCardNo: jcB,
        fromDepartment: INCOMING_STORE,
        toDepartment: "Production",
        quantity: 80,
        isIssueRequest: true,
        processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: concSku },
        actor: actor("Purchase")
      })
    ]);
    const stockAfter = computeIncomingStoreOtherRmStock(0, await store.list("mfr_movements"), concSku);
    assert(
      "248 concurrent issue cannot overspend 100 stock",
      [ia, ib].filter((r) => r.success).length === 1 && [ia, ib].filter((r) => !r.success).length === 1 && stockAfter === 20,
      `ok=${[ia, ib].filter((r) => r.success).length} stock=${stockAfter}`
    );

    const unauth = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-248-unauth`,
      jobCardNo: jc248,
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 1,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: plainCode },
      actor: actor("Production")
    });
    assert("248 RBAC Production cannot issue Incoming Store Other RM", unauth.success === false && unauth.statusCode === 403, unauth.error);

    const jcWireOnly = `${testPrefix}-JC-WIRE-ONLY`;
    await seedProductionJob(store, jcWireOnly, 1000);
    const wOnlyIn = await purchaseWire(store, `${testPrefix}-WIRE-ONLY`, 600, `${testPrefix}-wo-w`, `${testPrefix}-INV-WO`);
    await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-wo-w-a`,
      movementId: wOnlyIn.movement!.movementId,
      actor: actor("Raw Material Store")
    });
    const wOnlyIss = await issueWire(store, jcWireOnly, `${testPrefix}-WIRE-ONLY`, 500, `${testPrefix}-wo-iss`);
    const woMoves = await store.list("mfr_movements");
    const woJob = await store.get("mfr_job_cards", jcWireOnly);
    assert("248 Wire path intact without Other RM", wOnlyIss.success === true && getAcceptedOtherRawMaterialIssuedQty(woJob, woMoves) === 0, wOnlyIss.error);
    assert("248 Wire-only can start", canStartProductionWithRm(woJob, woMoves, { compulsory: true }).ok === true);
  } catch (err: any) {
    if (isCredentialGap(err)) {
      skipRemoteCleanup = true;
      printBlocked("Staging Firestore ADC/WIF unavailable; no further writes attempted.");
      printReport(cleanupStats, "BLOCKED");
      process.exit(0);
    }
    failed++;
    console.error("PROCESS 312 suite error:", err);
  } finally {
    if (!skipRemoteCleanup) {
      try {
        cleanupStats = await cleanupP312(db, store);
        if (cleanupStats.residual > 0) {
          failed++;
          console.error(`CLEANUP residual P312 documents remain: ${cleanupStats.residual}`);
        } else {
          console.log(`CLEANUP ok created=${cleanupStats.created} removed=${cleanupStats.removed} residual=${cleanupStats.residual}`);
        }
      } catch (cleanErr) {
        failed++;
        console.error("CLEANUP FAILED:", cleanErr);
      }
    }
  }

  printReport(cleanupStats, failed > 0 ? "FAIL" : "PASS");
  if (failed > 0) process.exit(1);
}

function printBlocked(reason: string) {
  console.log(`PROCESS 312 RESULT: BLOCKED`);
  console.log(reason);
  console.log(`Target: project=${STAGING_PROJECT_ID} database=${STAGING_DATABASE_ID}`);
  console.log(`timestamp prefix: ${testPrefix}`);
}

function printReport(cleanup: { created: number; removed: number; residual: number }, result: string) {
  console.log("");
  console.log(`PROCESS 312 RESULT: ${result}`);
  console.log(`Target:`);
  console.log(`project ${STAGING_PROJECT_ID}`);
  console.log(`database ${STAGING_DATABASE_ID}`);
  console.log(`timestamp prefix ${testPrefix}`);
  console.log(`Process 210: passed ${passed210} / failed ${failed210}`);
  console.log(`Process 248: passed ${passed248} / failed ${failed248}`);
  console.log(`Cleanup: created ${cleanup.created} removed ${cleanup.removed} residual ${cleanup.residual}`);
  console.log(`Production safety: no production writes, no production deployment, no production traffic change, no production IAM/rules/secrets change, no Factory Reset`);
}

runProcess312().catch((err) => {
  if (isCredentialGap(err)) {
    printBlocked(String((err as any)?.message || err));
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
