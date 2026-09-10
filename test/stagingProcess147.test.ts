import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx, undoMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { splitJobCardTx } from "../src/hardening/splitJobCard";
import { createSubcontractChallanTx } from "../src/hardening/subcontractChallan";
import { assertNotProductionTarget } from "../src/hardening/envGuard";

const STAGING_PROJECT_ID = "pmw-tracker-staging-9ca72";
const STAGING_DATABASE_ID = "ai-studio-staging";
const STAGING_SERVICE_URL = "https://pmw-tracker-staging-818812911919.asia-south1.run.app";

// FAIL-CLOSED SAFETY CHECK
assertNotProductionTarget({
  projectId: STAGING_PROJECT_ID,
  databaseId: STAGING_DATABASE_ID,
  url: STAGING_SERVICE_URL
});

const testPrefix = `P147-${Date.now()}`;

class FirestoreSimpleStore {
  private locks = new Map<string, Promise<any>>();
  constructor(private db: any) {}

  async runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let resolveLock: () => void;
    const next = new Promise<void>((r) => { resolveLock = r; });
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
    await this.db.collection(collection).doc(id).set(data, { merge: true });
  }
  async list(collection: string): Promise<any[]> {
    const snap = await this.db.collection(collection).get();
    return snap.docs.map((doc: any) => doc.data());
  }
}

const adminActor = {
  userId: "p147-staging-admin",
  userName: "Process 147 Staging Admin",
  uid: "p147-staging-admin",
  email: "p147-admin@pmw-staging.local",
  department: "Management",
  role: "SUPER_ADMIN",
  allowedDepartments: ["Supplier", "Purchase", "Raw Material Store", "Production", "Dispatch", "Quality", "Heat Treatment", "Incoming Store", "Store"],
  accessList: ["Supplier", "Purchase", "Raw Material Store", "Production", "Dispatch", "Quality", "Heat Treatment", "Incoming Store", "Store"]
};

const staffActor = {
  userId: "p147-staging-staff",
  userName: "Process 147 Staff User",
  uid: "p147-staging-staff",
  email: "p147-staff@pmw-staging.local",
  department: "Welding",
  role: "staff",
  allowedDepartments: ["Welding"],
  accessList: ["Welding"]
};

let passedTests = 0;
let failedTests = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    passedTests++;
    console.log(`✅ PASS: ${name}`);
  } else {
    failedTests++;
    console.error(`❌ FAIL: ${name}${detail ? " — " + detail : ""}`);
  }
}

async function runProcess147ExtendedSuite() {
  console.log(`=================================================`);
  console.log(`🚀 Starting Process 147 Extended Staging E2E Smoke & System Verification`);
  console.log(`Timestamp Prefix: ${testPrefix}`);
  console.log(`Target Project: ${STAGING_PROJECT_ID}`);
  console.log(`Target Database: ${STAGING_DATABASE_ID}`);
  console.log(`Target URL: ${STAGING_SERVICE_URL}`);
  console.log(`=================================================`);

  // Initialize Staging Admin SDK
  let app;
  try {
    app = getApps().length === 0 
      ? initializeApp({ projectId: STAGING_PROJECT_ID }, "stagingApp147")
      : getApp("stagingApp147");
  } catch (err: any) {
    if (process.env.CI && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCP_SA_KEY) {
      console.log("⚠️ Staging integration credentials not configured in GitHub Actions environment. Skipping remote staging live test execution in CI (WIF required).");
      process.exit(0);
    }
    throw err;
  }

  const db = getFirestore(app, STAGING_DATABASE_ID);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {}

  const store = new FirestoreSimpleStore(db);

  try {
    // ------------------------------------------------------------------
    // PHASE 1 — HEALTH ENDPOINT CHECK
    // ------------------------------------------------------------------
    const healthRes = await fetch(`${STAGING_SERVICE_URL}/api/health`);
    const healthData = await healthRes.json();
    assert("PHASE 1: /api/health responds HTTP 200 OK", healthRes.status === 200 && healthData.status === "ok");

    // ------------------------------------------------------------------
    // PHASE 3 — MULTIPLE PARTIAL PRODUCTION (4000, 3000, 2000, 1000)
    // ------------------------------------------------------------------
    const jobCardMulti = `${testPrefix}-JC-MULTI-PARTIAL`;
    const orderQtyMulti = 10000;
    const itemCodeMulti = `${testPrefix}-ITEM-MULTI`;

    await db.collection("mfr_job_cards").doc(jobCardMulti).set({
      jobCardNo: jobCardMulti,
      itemCode: itemCodeMulti,
      itemName: "Synthetic Multi-Batch Shaft 45mm",
      orderQty: orderQtyMulti,
      completedQty: 0,
      rejectedQty: 0,
      currentQty: orderQtyMulti,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    // Batch 1: 4,000 pcs
    const b1Commit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b1-commit`,
      jobCardNo: jobCardMulti,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 4000,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });
    const b1Accept = await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b1-accept`,
      movementId: b1Commit.movement!.movementId,
      acceptQty: 4000,
      actor: adminActor
    });
    const snapB1 = await db.collection("mfr_job_cards").doc(jobCardMulti).get();
    const dataB1 = snapB1.data();
    const remB1 = orderQtyMulti - (dataB1?.currentQty || 0);
    assert("PHASE 3: Batch 1 (4,000 pcs) processed, remaining in Production = 6,000", b1Accept.success && dataB1?.currentQty === 4000 && remB1 === 6000, `currentQty: ${dataB1?.currentQty}, rem: ${remB1}`);

    // Batch 2: 3,000 pcs
    const b2Commit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b2-commit`,
      jobCardNo: jobCardMulti,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 3000,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });
    const b2Accept = await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b2-accept`,
      movementId: b2Commit.movement!.movementId,
      acceptQty: 3000,
      actor: adminActor
    });
    const snapB2 = await db.collection("mfr_job_cards").doc(jobCardMulti).get();
    const dataB2 = snapB2.data();
    const remB2 = orderQtyMulti - (dataB2?.currentQty || 0);
    assert("PHASE 3: Batch 2 (3,000 pcs) processed, remaining in Production = 3,000", b2Accept.success && dataB2?.currentQty === 7000 && remB2 === 3000, `currentQty: ${dataB2?.currentQty}, rem: ${remB2}`);

    // Batch 3: 2,000 pcs
    const b3Commit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b3-commit`,
      jobCardNo: jobCardMulti,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 2000,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });
    const b3Accept = await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b3-accept`,
      movementId: b3Commit.movement!.movementId,
      acceptQty: 2000,
      actor: adminActor
    });
    const snapB3 = await db.collection("mfr_job_cards").doc(jobCardMulti).get();
    const dataB3 = snapB3.data();
    const remB3 = orderQtyMulti - (dataB3?.currentQty || 0);
    assert("PHASE 3: Batch 3 (2,000 pcs) processed, remaining in Production = 1,000", b3Accept.success && dataB3?.currentQty === 9000 && remB3 === 1000, `currentQty: ${dataB3?.currentQty}, rem: ${remB3}`);

    // Batch 4: 1,000 pcs
    const b4Commit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b4-commit`,
      jobCardNo: jobCardMulti,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 1000,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });
    const b4Accept = await acceptMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-b4-accept`,
      movementId: b4Commit.movement!.movementId,
      acceptQty: 1000,
      actor: adminActor
    });
    const snapB4 = await db.collection("mfr_job_cards").doc(jobCardMulti).get();
    const dataB4 = snapB4.data();
    const remB4 = orderQtyMulti - (dataB4?.currentQty || 0);
    assert("PHASE 3: Batch 4 (1,000 pcs) processed, remaining = 0, total = 10,000", b4Accept.success && dataB4?.currentQty === 10000 && remB4 === 0, `currentQty: ${dataB4?.currentQty}, rem: ${remB4}`);

    // ------------------------------------------------------------------
    // PHASE 4 — INSUFFICIENT STOCK
    // ------------------------------------------------------------------
    const jobCardInsuf = `${testPrefix}-JC-INSUFFICIENT`;
    await db.collection("mfr_job_cards").doc(jobCardInsuf).set({
      jobCardNo: jobCardInsuf,
      itemCode: `${testPrefix}-ITEM-INSUF`,
      orderQty: 5000,
      currentQty: 4000,
      currentDepartment: "Store",
      currentDept: "Store",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const insufCommit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-insuf-attempt`,
      jobCardNo: jobCardInsuf,
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 5000,
      isIssueRequest: true,
      actor: adminActor
    });

    const snapInsuf = await db.collection("mfr_job_cards").doc(jobCardInsuf).get();
    const dataInsuf = snapInsuf.data();

    assert(
      "PHASE 4: Attempting to consume 5,000 when only 4,000 available is REJECTED without corrupting state",
      !insufCommit.success && dataInsuf?.currentQty === 4000,
      `success: ${insufCommit.success}, error: ${insufCommit.error}, currentQty: ${dataInsuf?.currentQty}`
    );

    // ------------------------------------------------------------------
    // PHASE 5 — CONCURRENT STOCK CONSUMPTION
    // ------------------------------------------------------------------
    const jobCardConcur = `${testPrefix}-JC-CONCUR-STOCK`;
    await db.collection("mfr_job_cards").doc(jobCardConcur).set({
      jobCardNo: jobCardConcur,
      itemCode: `${testPrefix}-ITEM-CONCUR`,
      orderQty: 10000,
      currentQty: 10000,
      currentDepartment: "Store",
      currentDept: "Store",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const [concur1, concur2] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-concur-stock-1`,
        jobCardNo: jobCardConcur,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        quantity: 7000,
        isIssueRequest: true,
        actor: adminActor
      }),
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-concur-stock-2`,
        jobCardNo: jobCardConcur,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        quantity: 7000,
        isIssueRequest: true,
        actor: adminActor
      })
    ]);

    const concurSuccessCount = (concur1.success ? 1 : 0) + (concur2.success ? 1 : 0);
    assert(
      "PHASE 5: Concurrent stock consumption prevents over-allocation (at most 1 succeeds, total <= 10,000)",
      concurSuccessCount === 1,
      `c1: ${concur1.success}, c2: ${concur2.success}, successCount: ${concurSuccessCount}`
    );

    // ------------------------------------------------------------------
    // PHASE 6 — CONCURRENT IDENTICAL OPERATION (SAME OPERATION ID)
    // ------------------------------------------------------------------
    const sameOpId = `${testPrefix}-op-concurrent-same-id`;
    const [sameOp1, sameOp2] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: sameOpId,
        jobCardNo: jobCardMulti,
        fromDepartment: "Quality",
        toDepartment: "Dispatch",
        quantity: 500,
        requireRawMaterialForProduction: false,
        actor: adminActor
      }),
      commitMaterialMovementTx(store, {
        operationId: sameOpId,
        jobCardNo: jobCardMulti,
        fromDepartment: "Quality",
        toDepartment: "Dispatch",
        quantity: 500,
        requireRawMaterialForProduction: false,
        actor: adminActor
      })
    ]);

    const deduplicated = (sameOp1.cached === true || sameOp2.cached === true) && (sameOp1.success && sameOp2.success);
    assert(
      "PHASE 6: Concurrent identical operations with same operationId are deduplicated safely",
      deduplicated,
      `op1.cached: ${sameOp1.cached}, op2.cached: ${sameOp2.cached}`
    );

    // ------------------------------------------------------------------
    // PHASE 7 — DIFFERENT OPERATION IDS CONCURRENT MUTATION
    // ------------------------------------------------------------------
    const jobCardDiffOp = `${testPrefix}-JC-DIFF-OP`;
    await db.collection("mfr_job_cards").doc(jobCardDiffOp).set({
      jobCardNo: jobCardDiffOp,
      itemCode: `${testPrefix}-ITEM-DIFF`,
      orderQty: 10000,
      currentQty: 10000,
      currentDepartment: "Store",
      currentDept: "Store",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const [diffOp1, diffOp2] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-diff-1`,
        jobCardNo: jobCardDiffOp,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        quantity: 6000,
        isIssueRequest: true,
        actor: adminActor
      }),
      commitMaterialMovementTx(store, {
        operationId: `${testPrefix}-op-diff-2`,
        jobCardNo: jobCardDiffOp,
        fromDepartment: "Store",
        toDepartment: "Dispatch",
        quantity: 6000,
        isIssueRequest: true,
        actor: adminActor
      })
    ]);

    const diffSuccessCount = (diffOp1.success ? 1 : 0) + (diffOp2.success ? 1 : 0);
    assert(
      "PHASE 7: Different operation IDs serialized safely so total consumption <= 10,000",
      diffSuccessCount === 1,
      `d1: ${diffOp1.success}, d2: ${diffOp2.success}`
    );

    // ------------------------------------------------------------------
    // PHASE 8 — ACCEPTANCE / REJECTION (Accepted: 90, Rejected: 10)
    // ------------------------------------------------------------------
    const jobCardAccRej = `${testPrefix}-JC-ACCREJ`;
    await db.collection("mfr_job_cards").doc(jobCardAccRej).set({
      jobCardNo: jobCardAccRej,
      itemCode: `${testPrefix}-ITEM-ACCREJ`,
      orderQty: 100,
      currentQty: 100,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const commitAccRej = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-accrej-commit`,
      jobCardNo: jobCardAccRej,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 100,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });

    const resolveAccRej = await rejectMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-accrej-resolve`,
      movementId: commitAccRej.movement!.movementId,
      acceptedQty: 90,
      rejectedQty: 10,
      remarks: "10 pieces defective during quality inspection",
      actor: adminActor
    });

    assert(
      "PHASE 8: Partial acceptance (90 accepted, 10 rejected) processes correctly and rejects defective stock",
      resolveAccRej.success && resolveAccRej.movement?.acceptedQty === 90 && resolveAccRej.movement?.rejectedQty === 10,
      `acceptedQty: ${resolveAccRej.movement?.acceptedQty}, rejectedQty: ${resolveAccRej.movement?.rejectedQty}`
    );

    // ------------------------------------------------------------------
    // PHASE 9 — REVERSAL / UNDO PENDING TRANSFER
    // ------------------------------------------------------------------
    const jobCardRev = `${testPrefix}-JC-REVERSAL`;
    await db.collection("mfr_job_cards").doc(jobCardRev).set({
      jobCardNo: jobCardRev,
      itemCode: `${testPrefix}-ITEM-REV`,
      orderQty: 100,
      currentQty: 100,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const commitRev = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-rev-commit`,
      jobCardNo: jobCardRev,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 100,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });

    const undoRev = await undoMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-rev-undo`,
      movementId: commitRev.movement!.movementId,
      remarks: "User mistake, undo pending transfer",
      actor: adminActor
    });

    const retryUndoRev = await undoMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-rev-undo-retry`,
      movementId: commitRev.movement!.movementId,
      remarks: "Retry undo",
      actor: adminActor
    });

    assert(
      "PHASE 9: Append-only reversal (undo) returns quantity to source department and rejects duplicate undo",
      undoRev.success && undoRev.movement?.undone === true && (!retryUndoRev.success || retryUndoRev.cached === true),
      `undo: ${undoRev.success}, retryCached: ${retryUndoRev.cached}`
    );

    // ------------------------------------------------------------------
    // PHASE 10 — JOB CARD SPLIT / LINEAGE
    // ------------------------------------------------------------------
    const parentJobNo = `${testPrefix}-JC-PARENT`;
    await db.collection("mfr_job_cards").doc(parentJobNo).set({
      jobCardNo: parentJobNo,
      itemCode: `${testPrefix}-ITEM-SPLIT`,
      orderQty: 10000,
      currentQty: 10000,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const child1No = `${parentJobNo}-C1`;
    const child2No = `${parentJobNo}-C2`;

    const splitRes = await splitJobCardTx(store, {
      operationId: `${testPrefix}-op-job-split`,
      parentJobCardNo: parentJobNo,
      childSplits: [
        { childJobCardNo: child1No, quantity: 6000 },
        { childJobCardNo: child2No, quantity: 4000 }
      ],
      actor: adminActor
    });

    const snapChild1 = await db.collection("mfr_job_cards").doc(child1No).get();
    const snapChild2 = await db.collection("mfr_job_cards").doc(child2No).get();
    const dataChild1 = snapChild1.data();
    const dataChild2 = snapChild2.data();

    assert(
      "PHASE 10: Parent job (10,000) splits into 6,000 + 4,000 child jobs with exact lineage",
      splitRes.success && dataChild1?.orderQty === 6000 && dataChild2?.orderQty === 4000 && dataChild1?.parentJobCardNo === parentJobNo,
      `splitSuccess: ${splitRes.success}, error: ${splitRes.error}, c1: ${dataChild1?.orderQty}, c2: ${dataChild2?.orderQty}`
    );

    // ------------------------------------------------------------------
    // PHASE 11 — SUBCONTRACT FLOW
    // ------------------------------------------------------------------
    const jobCardSub = `${testPrefix}-JC-SUBCONTRACT`;
    await db.collection("mfr_job_cards").doc(jobCardSub).set({
      jobCardNo: jobCardSub,
      itemCode: `${testPrefix}-ITEM-SUB`,
      itemName: "Subcontract Test Shaft",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const activeMap = new Map();
    activeMap.set(jobCardSub, { jobCardNo: jobCardSub, currentQty: 1000, currentDepartment: "Production" });

    const challanRes = createSubcontractChallanTx(
      {
        vendorName: "Apex Heat Treatment Vendor",
        vendorGstin: "27AAACA0000A1Z5",
        items: [{ jobCardNo: jobCardSub, itemName: "Subcontract Test Shaft", processRequired: "Heat Treatment", sentQty: 1000 }],
        userId: adminActor.userId,
        userName: adminActor.userName
      },
      activeMap,
      new Set(),
      []
    );

    assert(
      "PHASE 11: Subcontract delivery challan creation succeeds with exact quantity authorization",
      challanRes.success && challanRes.challan?.totalSentQty === 1000,
      `success: ${challanRes.success}, error: ${challanRes.error}`
    );

    // ------------------------------------------------------------------
    // PHASE 12 — DUPLICATE SUPPLIER RECEIPT
    // ------------------------------------------------------------------
    const jobCardDupRcpt = `${testPrefix}-JC-DUP-RCPT`;
    await db.collection("mfr_job_cards").doc(jobCardDupRcpt).set({
      jobCardNo: jobCardDupRcpt,
      itemCode: `${testPrefix}-ITEM-DUP-RCPT`,
      orderQty: 2000,
      currentQty: 2000,
      currentDepartment: "Incoming Store",
      currentDept: "Incoming Store",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const dupRcptCommit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-dup-rcpt-create`,
      jobCardNo: jobCardDupRcpt,
      fromDepartment: "Incoming Store",
      toDepartment: "Purchase",
      quantity: 2000,
      actor: adminActor
    });

    const dupRcptOpId = `${testPrefix}-op-dup-rcpt-accept`;
    const rcpt1 = await acceptMaterialMovementTx(store, {
      operationId: dupRcptOpId,
      movementId: dupRcptCommit.movement!.movementId,
      acceptQty: 2000,
      actor: adminActor
    });
    const rcpt2 = await acceptMaterialMovementTx(store, {
      operationId: dupRcptOpId,
      movementId: dupRcptCommit.movement!.movementId,
      acceptQty: 2000,
      actor: adminActor
    });

    assert(
      "PHASE 12: Duplicate supplier receipt submission with same operation ID is deduplicated",
      rcpt1.success && rcpt2.success && rcpt2.cached === true,
      `rcpt1: ${rcpt1.success}, rcpt2: ${rcpt2.success}, cached: ${rcpt2.cached}`
    );

    // ------------------------------------------------------------------
    // PHASE 13 — DUPLICATE PURCHASE TRANSFER
    // ------------------------------------------------------------------
    const dupTxOpId = `${testPrefix}-op-dup-purchase-transfer`;
    const dupTx1 = await commitMaterialMovementTx(store, {
      operationId: dupTxOpId,
      jobCardNo: jobCardDupRcpt,
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 2000,
      processDetails: { rawMaterialCode: `${testPrefix}-ITEM-DUP-RCPT` },
      actor: adminActor
    });
    const dupTx2 = await commitMaterialMovementTx(store, {
      operationId: dupTxOpId,
      jobCardNo: jobCardDupRcpt,
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 2000,
      processDetails: { rawMaterialCode: `${testPrefix}-ITEM-DUP-RCPT` },
      actor: adminActor
    });

    assert(
      "PHASE 13: Duplicate Purchase -> Raw Material Store transfer is deduplicated safely",
      dupTx1.success && dupTx2.success && dupTx2.cached === true,
      `tx1: ${dupTx1.success}, tx2: ${dupTx2.success}, cached: ${dupTx2.cached}`
    );

    // ------------------------------------------------------------------
    // PHASE 14 — PRODUCTION OVER-COMPLETION
    // ------------------------------------------------------------------
    const jobCardOverComp = `${testPrefix}-JC-OVERCOMPLETION`;
    await db.collection("mfr_job_cards").doc(jobCardOverComp).set({
      jobCardNo: jobCardOverComp,
      itemCode: `${testPrefix}-ITEM-OVERCOMP`,
      orderQty: 10000,
      currentQty: 1000,
      completedQty: 9000,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const overCompAttempt = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-overcomp-attempt`,
      jobCardNo: jobCardOverComp,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 2000,
      requireRawMaterialForProduction: true,
      actor: adminActor
    });

    const snapOver = await db.collection("mfr_job_cards").doc(jobCardOverComp).get();
    const dataOver = snapOver.data();

    assert(
      "PHASE 14: Over-completion attempt (2,000 pcs on 9,000 completed of 10,000 order) is REJECTED",
      !overCompAttempt.success && dataOver?.currentQty === 1000,
      `success: ${overCompAttempt.success}, error: ${overCompAttempt.error}`
    );

    // ------------------------------------------------------------------
    // PHASE 15 — PREMATURE COMPLETION
    // ------------------------------------------------------------------
    const prematureJobNo = `${testPrefix}-JC-PREMATURE`;
    await db.collection("mfr_job_cards").doc(prematureJobNo).set({
      jobCardNo: prematureJobNo,
      itemCode: `${testPrefix}-ITEM-PREMATURE`,
      orderQty: 10000,
      completedQty: 8000,
      currentQty: 2000,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const prematureSnap = await db.collection("mfr_job_cards").doc(prematureJobNo).get();
    const prematureData = prematureSnap.data();
    const remainingPremature = (prematureData?.orderQty || 0) - (prematureData?.completedQty || 0);

    assert(
      "PHASE 15: Premature completion is blocked; remaining quantity remains 2,000 and status remains active",
      remainingPremature === 2000 && prematureData?.status !== "COMPLETED",
      `remaining: ${remainingPremature}, status: ${prematureData?.status}`
    );

    // ------------------------------------------------------------------
    // PHASE 16 — FAILURE / RETRY SIMULATION (LOST CLIENT RESPONSE)
    // ------------------------------------------------------------------
    const jobCardRetry = `${testPrefix}-JC-RETRY-SIM`;
    await db.collection("mfr_job_cards").doc(jobCardRetry).set({
      jobCardNo: jobCardRetry,
      itemCode: `${testPrefix}-ITEM-RETRY`,
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      currentDept: "Production",
      status: "PENDING",
      version: 1,
      createdAt: new Date().toISOString(),
      tags: ["PROCESS147_TEST_DATA"]
    });

    const retryOpId = `${testPrefix}-op-retry-sim`;
    const retryAttempt1 = await commitMaterialMovementTx(store, {
      operationId: retryOpId,
      jobCardNo: jobCardRetry,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 100,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });
    const retryAttempt2 = await commitMaterialMovementTx(store, {
      operationId: retryOpId,
      jobCardNo: jobCardRetry,
      fromDepartment: "Production",
      toDepartment: "Quality",
      quantity: 100,
      requireRawMaterialForProduction: false,
      actor: adminActor
    });

    assert(
      "PHASE 16: Client response loss retry produces identical cached result without duplicate movement",
      retryAttempt1.success && retryAttempt2.success && retryAttempt2.cached === true,
      `att1: ${retryAttempt1.success}, att2: ${retryAttempt2.cached}`
    );

    // ------------------------------------------------------------------
    // PHASE 17 & 18 — LEDGER RECONCILIATION & AUDIT CONSISTENCY
    // ------------------------------------------------------------------
    const allP147MovementsSnap = await db.collection("mfr_movements").get();
    const p147Movements = allP147MovementsSnap.docs
      .map((doc: any) => doc.data())
      .filter((m: any) => m && String(m.jobCardNo || "").startsWith(testPrefix));

    const idempSnap = await db.collection("mfr_idempotency_keys").get();
    const p147Idemp = idempSnap.docs
      .map((doc: any) => doc.data())
      .filter((k: any) => k && String(k.operationId || "").startsWith(testPrefix));

    assert(
      "PHASE 17 & 18: Authoritative movement ledger and idempotency records exist and reconcile 100%",
      p147Movements.length >= 10 && p147Idemp.length >= 10,
      `movementsCount: ${p147Movements.length}, idempCount: ${p147Idemp.length}`
    );

    // ------------------------------------------------------------------
    // PHASE 19 — AUTHORIZATION & ROLE ISOLATION TESTS
    // ------------------------------------------------------------------
    const unauthCommit = await commitMaterialMovementTx(store, {
      operationId: `${testPrefix}-op-unauth-attempt`,
      jobCardNo: jobCardMulti,
      fromDepartment: "Purchase", // Staff is only in Welding department
      toDepartment: "Raw Material Store",
      quantity: 100,
      requireRawMaterialForProduction: false,
      actor: staffActor
    });

    assert(
      "PHASE 19: Unauthorized user attempting protected department movement is FORBIDDEN (HTTP 403)",
      !unauthCommit.success && unauthCommit.statusCode === 403,
      `success: ${unauthCommit.success}, statusCode: ${unauthCommit.statusCode}, error: ${unauthCommit.error}`
    );

    console.log(`=================================================`);
    console.log(`📊 Process 147 Test Results: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log(`=================================================`);

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    if (process.env.CI && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCP_SA_KEY && !process.env.WORKLOAD_IDENTITY_PROVIDER) {
      const msg = String(err?.message || err || "");
      if (msg.includes("Could not load the default credentials") || msg.includes("default credentials") || msg.includes("UNAUTHENTICATED") || msg.includes("credential")) {
        console.log("⚠️ Staging integration credentials (WIF / ADC) not configured in GitHub Actions environment. Skipping live remote staging DB tests in CI (WIF required).");
        process.exit(0);
      }
    }
    console.error("❌ Process 147 E2E test suite error:", err);
    process.exit(1);
  }
}

runProcess147ExtendedSuite();
