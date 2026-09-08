import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  canFinalizeDispatch,
  remainingAtDepartment,
  storeAuthoritativeOnHand,
  getCumulativeDispatchedQty
} from "../src/hardening/process2Manufacturing";
import { getJobCardProcessMetrics } from "../src/lib/metrics";
import { MaterialMovement, JobCard } from "../src/types";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function actor(dept = "Store") {
  return {
    userId: "u-p5",
    userName: "P5 Dispatcher",
    role: "admin",
    department: dept,
    allowedDepartments: ["Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Dispatch"],
    accessList: ["Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Dispatch"]
  };
}

async function runProcess5Tests() {
  console.log("=== RUNNING PROCESS 5 MULTI-JOB DISPATCH & MOBILE CONTRACT TESTS ===");

  // TEST 1 — Multi-job manifest creation with shared manifestId & dispatchGroupNo
  {
    const store = new MemoryStore();
    const manifestId = "MNF-20260909-1001";
    const dispatchGroupNo = "GRP-INV-8899";

    const jobA: JobCard = { jobCardNo: "JC-P5-001", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    const jobB: JobCard = { jobCardNo: "JC-P5-002", orderQty: 500, currentQty: 500, currentDepartment: "Store", unit: "PCS", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-P5-001", jobA);
    await store.set("mfr_job_cards", "JC-P5-002", jobB);

    // Initial store inward
    await store.set("mfr_movements", "MOV-IN-A", { movementId: "MOV-IN-A", jobCardNo: "JC-P5-001", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });
    await store.set("mfr_movements", "MOV-IN-B", { movementId: "MOV-IN-B", jobCardNo: "JC-P5-002", fromDepartment: "Packing", toDepartment: "Store", quantity: 500, accepted: true });

    // Multi-job dispatch creation under same manifest
    const resA = await commitMaterialMovementTx(store, {
      operationId: "OP-P5-DISP-A",
      jobCardNo: "JC-P5-001",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 600.50,
      dispatchGroupNo,
      manifestId,
      actor: actor("Store")
    });

    const resB = await commitMaterialMovementTx(store, {
      operationId: "OP-P5-DISP-B",
      jobCardNo: "JC-P5-002",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 200,
      dispatchGroupNo,
      manifestId,
      actor: actor("Store")
    });

    assert("TEST 1 Multi-job manifest Job A dispatch created", resA.success);
    assert("TEST 1 Multi-job manifest Job B dispatch created", resB.success);
    assert("TEST 2 Two jobs share exact manifestId", resA.movement?.manifestId === manifestId && resB.movement?.manifestId === manifestId);
    assert("TEST 2 Two jobs share exact dispatchGroupNo", resA.movement?.dispatchGroupNo === dispatchGroupNo && resB.movement?.dispatchGroupNo === dispatchGroupNo);
  }

  // TEST 3 — Independent per-job ledger quantities & limit enforcement
  {
    const store = new MemoryStore();
    const manifestId = "MNF-20260909-1002";

    const jobA: JobCard = { jobCardNo: "JC-IND-A", orderQty: 100, currentQty: 100, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    const jobB: JobCard = { jobCardNo: "JC-IND-B", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-IND-A", jobA);
    await store.set("mfr_job_cards", "JC-IND-B", jobB);

    await store.set("mfr_movements", "M-A", { movementId: "M-A", jobCardNo: "JC-IND-A", fromDepartment: "Packing", toDepartment: "Store", quantity: 100, accepted: true });
    await store.set("mfr_movements", "M-B", { movementId: "M-B", jobCardNo: "JC-IND-B", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });

    // TEST 5 — Job A cannot consume Job B stock (Job A dispatching 150 vs 100 available)
    const resOver = await commitMaterialMovementTx(store, {
      operationId: "OP-OVER-A",
      jobCardNo: "JC-IND-A",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 150,
      manifestId,
      actor: actor("Store")
    });
    assert("TEST 5 Job A cannot consume Job B stock (over-dispatch rejected)", !resOver.success && resOver.statusCode === 400);

    // TEST 4 — Independent dispatch limits: Job B dispatches valid 800 out of 1000
    const resB = await commitMaterialMovementTx(store, {
      operationId: "OP-VALID-B",
      jobCardNo: "JC-IND-B",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 800,
      manifestId,
      actor: actor("Store")
    });
    assert("TEST 4 Independent dispatch limit permits Job B valid quantity", resB.success);
    assert("TEST 3 Independent per-job ledger quantities maintained", getCumulativeDispatchedQty(jobA, await store.list("mfr_movements")) === 0);
  }

  // TEST 6 & 7 — Partial dispatches for Job A and Job B
  {
    const store = new MemoryStore();
    const jobA: JobCard = { jobCardNo: "JC-PART-A", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    const jobB: JobCard = { jobCardNo: "JC-PART-B", orderQty: 500, currentQty: 500, currentDepartment: "Store", unit: "PCS", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-PART-A", jobA);
    await store.set("mfr_job_cards", "JC-PART-B", jobB);

    await store.set("mfr_movements", "M-PART-A", { movementId: "M-PART-A", jobCardNo: "JC-PART-A", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });
    await store.set("mfr_movements", "M-PART-B", { movementId: "M-PART-B", jobCardNo: "JC-PART-B", fromDepartment: "Packing", toDepartment: "Store", quantity: 500, accepted: true });

    // Job A partial leg 1: 400 KG
    await commitMaterialMovementTx(store, { operationId: "OP-P-A1", jobCardNo: "JC-PART-A", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 400, actor: actor("Store") });
    // Accept A1
    const movs1 = await store.list("mfr_movements");
    const movA1 = movs1.find((m: any) => m.operationId === "OP-P-A1");
    if (movA1) { movA1.accepted = true; await store.set("mfr_movements", movA1.movementId, movA1); }
    await store.set("mfr_job_cards", "JC-PART-A", { ...jobA, pendingOutbound: [] });

    // Job B partial leg 1: 300 PCS
    await commitMaterialMovementTx(store, { operationId: "OP-P-B1", jobCardNo: "JC-PART-B", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 300, actor: actor("Store") });
    // Accept B1
    const movs2 = await store.list("mfr_movements");
    const movB1 = movs2.find((m: any) => m.operationId === "OP-P-B1");
    if (movB1) { movB1.accepted = true; await store.set("mfr_movements", movB1.movementId, movB1); }
    await store.set("mfr_job_cards", "JC-PART-B", { ...jobB, pendingOutbound: [] });

    assert("TEST 6 Partial dispatch Job A cumulative count is 400 KG", getCumulativeDispatchedQty(jobA, await store.list("mfr_movements")) === 400);
    assert("TEST 7 Partial dispatch Job B cumulative count is 300 PCS", getCumulativeDispatchedQty(jobB, await store.list("mfr_movements")) === 300);
  }

  // TEST 8, 9, 10 — Decimal & Unit Preservation (KG vs PCS)
  {
    const store = new MemoryStore();
    const jobKg: JobCard = { jobCardNo: "JC-KG-001", orderQty: 1000.75, currentQty: 1000.75, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    const jobPcs: JobCard = { jobCardNo: "JC-PCS-001", orderQty: 250, currentQty: 250, currentDepartment: "Store", unit: "PCS", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-KG-001", jobKg);
    await store.set("mfr_job_cards", "JC-PCS-001", jobPcs);

    await store.set("mfr_movements", "MKG", { movementId: "MKG", jobCardNo: "JC-KG-001", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000.75, accepted: true });
    await store.set("mfr_movements", "MPCS", { movementId: "MPCS", jobCardNo: "JC-PCS-001", fromDepartment: "Packing", toDepartment: "Store", quantity: 250, accepted: true });

    const resKg = await commitMaterialMovementTx(store, { operationId: "OP-DEC-KG", jobCardNo: "JC-KG-001", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 400.25, requestedUnit: "KG", actor: actor("Store") });
    const resPcs = await commitMaterialMovementTx(store, { operationId: "OP-DEC-PCS", jobCardNo: "JC-PCS-001", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 100, requestedUnit: "PCS", actor: actor("Store") });

    assert("TEST 8 Decimal dispatch quantity 400.25 KG preserved", resKg.movement?.quantity === 400.25);
    assert("TEST 9 PCS unit dispatch quantity preserved", resPcs.movement?.quantity === 100);
    assert("TEST 10 KG unit preserved explicitly", resKg.movement?.requestedUnit === "KG" || resKg.movement?.unit === "KG");
  }

  // TEST 11 & 12 — Idempotency & Pending Route Collision Locks
  {
    const store = new MemoryStore();
    const job: JobCard = { jobCardNo: "JC-LOCK", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-LOCK", job);
    await store.set("mfr_movements", "M-LOCK-IN", { movementId: "M-LOCK-IN", jobCardNo: "JC-LOCK", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });

    // First attempt
    const res1 = await commitMaterialMovementTx(store, { operationId: "OP-IDEM-001", jobCardNo: "JC-LOCK", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 500, actor: actor("Store") });
    // Duplicate operationId
    const resDup = await commitMaterialMovementTx(store, { operationId: "OP-IDEM-001", jobCardNo: "JC-LOCK", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 500, actor: actor("Store") });

    assert("TEST 11 Duplicate operationId returns cached original", resDup.cached === true && resDup.success === true);

    // Second pending movement on same route before accept
    const resPending = await commitMaterialMovementTx(store, { operationId: "OP-IDEM-002", jobCardNo: "JC-LOCK", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 200, actor: actor("Store") });
    assert("TEST 12 Pending duplicate route movement rejected", !resPending.success && (resPending.statusCode === 400 || resPending.statusCode === 409));
  }

  // TEST 13 & 14 — Exclude Completed Jobs & Insufficient Stock
  {
    const store = new MemoryStore();
    const jobComp: JobCard = { jobCardNo: "JC-COMP", orderQty: 500, currentQty: 0, currentDepartment: "Completed", unit: "PCS", status: "Completed", completed: true };
    const jobEmpty: JobCard = { jobCardNo: "JC-EMPTY", orderQty: 500, currentQty: 0, currentDepartment: "Store", unit: "PCS", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-COMP", jobComp);
    await store.set("mfr_job_cards", "JC-EMPTY", jobEmpty);

    const resComp = await commitMaterialMovementTx(store, { operationId: "OP-COMP", jobCardNo: "JC-COMP", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 100, actor: actor("Store") });
    const resEmpty = await commitMaterialMovementTx(store, { operationId: "OP-EMPTY", jobCardNo: "JC-EMPTY", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 100, actor: actor("Store") });

    assert("TEST 13 Completed job dispatch rejected", !resComp.success);
    assert("TEST 14 Job with insufficient store stock rejected", !resEmpty.success);
  }

  // TEST 15 & 16 — Mixed Success Isolation & Metadata Persistence
  {
    const store = new MemoryStore();
    const manifestId = "MNF-MIXED-99";
    const jobGood: JobCard = { jobCardNo: "JC-GOOD", orderQty: 500, currentQty: 500, currentDepartment: "Store", unit: "PCS", status: "In Progress" };
    const jobBad: JobCard = { jobCardNo: "JC-BAD", orderQty: 500, currentQty: 0, currentDepartment: "Completed", unit: "PCS", status: "Completed", completed: true };
    await store.set("mfr_job_cards", "JC-GOOD", jobGood);
    await store.set("mfr_job_cards", "JC-BAD", jobBad);
    await store.set("mfr_movements", "M-GOOD-IN", { movementId: "M-GOOD-IN", jobCardNo: "JC-GOOD", fromDepartment: "Packing", toDepartment: "Store", quantity: 500, accepted: true });

    const resGood = await commitMaterialMovementTx(store, { operationId: "OP-GOOD", jobCardNo: "JC-GOOD", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 200, manifestId, actor: actor("Store") });
    const resBad = await commitMaterialMovementTx(store, { operationId: "OP-BAD", jobCardNo: "JC-BAD", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 200, manifestId, actor: actor("Store") });

    assert("TEST 15 Mixed success isolation (good job succeeds, bad job fails independently)", resGood.success === true && resBad.success === false);
    assert("TEST 16 Manifest metadata persisted on successful movement", resGood.movement?.manifestId === manifestId);
  }

  // TEST 17 & 18 — Legacy Compatibility & Mobile/Desktop Parity
  {
    const store = new MemoryStore();
    const jobLegacy: JobCard = { jobCardNo: "JC-LEGACY", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "KG", status: "In Progress" };
    await store.set("mfr_job_cards", "JC-LEGACY", jobLegacy);

    // Legacy movement without manifestId or dispatchGroupNo
    const legacyMov: MaterialMovement = {
      movementId: "MOV-LEGACY-001",
      jobCardNo: "JC-LEGACY",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 1000,
      accepted: true,
      transferBy: "Legacy User",
      transferDate: new Date().toISOString()
    };
    await store.set("mfr_movements", "MOV-LEGACY-001", legacyMov);

    const onHand = storeAuthoritativeOnHand(jobLegacy, await store.list("mfr_movements"));
    assert("TEST 17 Legacy movements without manifest metadata remain fully operational", onHand === 1000);

    // Mobile contract invocation using same transaction engine contract
    const resMobile = await commitMaterialMovementTx(store, {
      operationId: "OP-MOBILE-001",
      jobCardNo: "JC-LEGACY",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 300,
      dispatchGroupNo: "MOB-GRP-100",
      actor: { userId: "m-user", userName: "Mobile Operator", role: "staff", department: "Store", allowedDepartments: ["Store", "Dispatch"], accessList: ["Store", "Dispatch"] }
    });
    assert("TEST 18 Mobile/Desktop transaction contract parity verified", resMobile.success === true && resMobile.movement?.dispatchGroupNo === "MOB-GRP-100");
  }

  console.log(`\nProcess 5 Integration tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProcess5Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
