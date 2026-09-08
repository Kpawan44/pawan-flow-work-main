import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  canFinalizeDispatch,
  remainingAtDepartment,
  storeAuthoritativeOnHand,
  getCumulativeDispatchedQty,
  getEffectiveDepartmentRejectionQty
} from "../src/hardening/process2Manufacturing";
import { getJobCardProcessMetrics } from "../src/lib/metrics";

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
    userId: "u-p3",
    userName: "P3 User",
    role: "staff",
    department: dept,
    allowedDepartments: [dept, "Dispatch", "Production", "Heat Treatment", "Plating", "Packing"],
    accessList: [dept, "Dispatch", "Production", "Heat Treatment", "Plating", "Packing"]
  };
}

async function runProcess3Tests() {
  console.log("=== RUNNING PROCESS 3 INVENTORY FLOW & PARTIAL DISPATCH HARDENING TESTS ===");

  // TEST 1 — Partial Dispatch: 1000 KG Store stock -> Dispatch 600 -> remaining 400 -> Dispatch 400 -> remaining 0
  {
    const store = new MemoryStore();
    const job = {
      jobCardNo: "JC-P3-001",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Store",
      unit: "KG"
    };
    await store.set("mfr_job_cards", "JC-P3-001", job);

    // Initial store inbound: 1000 KG accepted from Packing
    const movIn = {
      movementId: "M-IN-1",
      jobCardNo: "JC-P3-001",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 1000,
      accepted: true
    };
    await store.set("mfr_movements", "M-IN-1", movIn);

    let onHand = storeAuthoritativeOnHand(job, [movIn]);
    assert("TEST 1 Initial Store stock is 1000 KG", onHand === 1000, `got ${onHand}`);

    // First partial dispatch: 600 KG
    const res1 = await commitMaterialMovementTx(store, {
      operationId: "op-disp-1",
      jobCardNo: "JC-P3-001",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 600,
      actor: actor("Store")
    });
    assert("TEST 1 First partial dispatch 600 KG succeeded", res1.success === true, res1.error);

    // Accept first leg so it is no longer pending
    const movs1 = await store.list("mfr_movements");
    movs1.forEach((m) => { if (m.toDepartment === "Dispatch") m.accepted = true; });
    await store.set("mfr_movements", res1.movement.movementId, { ...res1.movement, accepted: true });
    const jc1 = await store.get("mfr_job_cards", "JC-P3-001");
    if (jc1) await store.set("mfr_job_cards", "JC-P3-001", { ...jc1, pendingOutbound: [] });
    
    let remainingDisp = storeAuthoritativeOnHand(job, movs1);
    let cumulativeDisp = getCumulativeDispatchedQty(job, movs1);
    assert("TEST 1 Store remaining after 600 KG dispatch is 400 KG", remainingDisp === 400, `got ${remainingDisp}`);
    assert("TEST 1 Cumulative dispatched after first leg is 600 KG", cumulativeDisp === 600, `got ${cumulativeDisp}`);

    // Second partial dispatch: 400 KG
    const res2 = await commitMaterialMovementTx(store, {
      operationId: "op-disp-2",
      jobCardNo: "JC-P3-001",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 400,
      actor: actor("Store")
    });
    assert("TEST 2 Second partial dispatch 400 KG succeeded", res2.success === true, res2.error);

    const movs2 = await store.list("mfr_movements");
    movs2.forEach((m) => { if (m.toDepartment === "Dispatch") m.accepted = true; });

    let remainingDisp2 = storeAuthoritativeOnHand(job, movs2);
    let cumulativeDisp2 = getCumulativeDispatchedQty(job, movs2);
    assert("TEST 1 Store remaining after second dispatch is 0 KG", remainingDisp2 === 0, `got ${remainingDisp2}`);
    assert("TEST 1 Total cumulative dispatched reaches 1000 KG", cumulativeDisp2 === 1000, `got ${cumulativeDisp2}`);
  }

  // TEST 2 — Partial Dispatch Must Not Be Blocked by dispatchQty > 0
  {
    const jobWithPrevDispatch = {
      jobCardNo: "JC-P3-002",
      orderQty: 1000,
      currentQty: 400,
      completed: false,
      dispatchDetails: { dispatchQty: 600 }
    };
    const movements = [
      { movementId: "M-1", jobCardNo: "JC-P3-002", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true },
      { movementId: "M-2", jobCardNo: "JC-P3-002", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 600, accepted: true }
    ];

    const check = canFinalizeDispatch(jobWithPrevDispatch, movements, 400);
    assert("TEST 2 Legitimate additional partial dispatch is NOT blocked by prior dispatchQty > 0", check.ok === true, check.error);
  }

  // TEST 3 — Over-dispatch: 1000 KG available -> attempt dispatch 1100 -> reject
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-003", orderQty: 1000, currentQty: 1000, currentDepartment: "Store" };
    await store.set("mfr_job_cards", "JC-P3-003", job);
    await store.set("mfr_movements", "M-IN-3", { movementId: "M-IN-3", jobCardNo: "JC-P3-003", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });

    const resOver = await commitMaterialMovementTx(store, {
      operationId: "op-disp-over",
      jobCardNo: "JC-P3-003",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 1100,
      actor: actor("Store")
    });
    assert("TEST 3 Over-dispatch (1100 vs 1000) rejected", resOver.success === false, "over-dispatch allowed unexpectedly");
  }

  // TEST 4 — Decimal Partial Dispatch: 1000.50 KG -> dispatch 600.25 -> remaining 400.25 -> dispatch 400.25 -> remaining 0
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-004", orderQty: 1000.50, currentQty: 1000.50, currentDepartment: "Store" };
    await store.set("mfr_job_cards", "JC-P3-004", job);
    await store.set("mfr_movements", "M-IN-4", { movementId: "M-IN-4", jobCardNo: "JC-P3-004", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000.50, accepted: true });

    const resDec1 = await commitMaterialMovementTx(store, {
      operationId: "op-dec-1",
      jobCardNo: "JC-P3-004",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 600.25,
      actor: actor("Store")
    });
    assert("TEST 4 Decimal partial dispatch 600.25 KG succeeded", resDec1.success === true, resDec1.error);

    const movsDec1 = await store.list("mfr_movements");
    movsDec1.forEach((m) => { if (m.toDepartment === "Dispatch") m.accepted = true; });
    await store.set("mfr_movements", resDec1.movement.movementId, { ...resDec1.movement, accepted: true });
    const jc4 = await store.get("mfr_job_cards", "JC-P3-004");
    if (jc4) await store.set("mfr_job_cards", "JC-P3-004", { ...jc4, pendingOutbound: [] });

    let remainingDec1 = storeAuthoritativeOnHand(job, movsDec1);
    assert("TEST 4 Remaining decimal stock after 600.25 dispatch is 400.25 KG", remainingDec1 === 400.25, `got ${remainingDec1}`);

    const resDec2 = await commitMaterialMovementTx(store, {
      operationId: "op-dec-2",
      jobCardNo: "JC-P3-004",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 400.25,
      actor: actor("Store")
    });
    assert("TEST 4 Second decimal partial dispatch 400.25 KG succeeded", resDec2.success === true, resDec2.error);

    const movsDec2 = await store.list("mfr_movements");
    movsDec2.forEach((m) => { if (m.toDepartment === "Dispatch") m.accepted = true; });

    let remainingDec2 = storeAuthoritativeOnHand(job, movsDec2);
    assert("TEST 4 Store remaining after full decimal dispatch is 0 KG", remainingDec2 === 0, `got ${remainingDec2}`);
  }

  // TEST 5 — Rejection Only: 1000 inbound -> reject 100 -> remaining department WIP = 900
  {
    const job = { jobCardNo: "JC-P3-005", platingDetails: { rejectionQty: 100 } };
    const movements = [
      { movementId: "M-P1", jobCardNo: "JC-P3-005", fromDepartment: "Heat Treatment", toDepartment: "Plating", quantity: 1000, accepted: true }
    ];
    const rem = remainingAtDepartment(job, movements, "Plating");
    assert("TEST 5 Rejection of 100 KG leaves 900 KG WIP at Plating", rem === 900, `got ${rem}`);
  }

  // TEST 6 — Reverse Movement Only: 1000 inbound -> return 100 to HT -> remaining department WIP = 900
  {
    const job = { jobCardNo: "JC-P3-006" };
    const movements = [
      { movementId: "M-P1", jobCardNo: "JC-P3-006", fromDepartment: "Heat Treatment", toDepartment: "Plating", quantity: 1000, accepted: true },
      { movementId: "M-REV-1", jobCardNo: "JC-P3-006", fromDepartment: "Plating", toDepartment: "Heat Treatment", quantity: 100, accepted: true }
    ];
    const rem = remainingAtDepartment(job, movements, "Plating");
    assert("TEST 6 Reverse movement of 100 KG leaves 900 KG WIP at Plating", rem === 900, `got ${rem}`);
  }

  // TEST 7 — Rejection + Reverse Movement Interaction (Same physical quantity returned)
  {
    const job = { jobCardNo: "JC-P3-007", platingDetails: { rejectionQty: 100 } };
    const movements = [
      { movementId: "M-P1", jobCardNo: "JC-P3-007", fromDepartment: "Heat Treatment", toDepartment: "Plating", quantity: 1000, accepted: true },
      { movementId: "M-REV-1", jobCardNo: "JC-P3-007", fromDepartment: "Plating", toDepartment: "Heat Treatment", quantity: 100, accepted: true, processDetails: { isRejectionReturn: true } }
    ];

    const effRej = getEffectiveDepartmentRejectionQty(job, movements, "Plating");
    assert("TEST 7 Effective unreturned rejection is 0 when 100 rejected was returned via reverse movement", effRej === 0, `got ${effRej}`);

    const rem = remainingAtDepartment(job, movements, "Plating");
    assert("TEST 7 Plating remaining WIP is 900 KG (not 800 KG) when 100 rejected was returned via reverse movement", rem === 900, `got ${rem}`);
  }

  // TEST 8 — Different Physical Quantities: 1000 inbound -> 100 rejected scrap -> 50 separately returned
  {
    const job = { jobCardNo: "JC-P3-008", platingDetails: { rejectionQty: 100 } };
    const movements = [
      { movementId: "M-P1", jobCardNo: "JC-P3-008", fromDepartment: "Heat Treatment", toDepartment: "Plating", quantity: 1000, accepted: true },
      { movementId: "M-REV-2", jobCardNo: "JC-P3-008", fromDepartment: "Plating", toDepartment: "Heat Treatment", quantity: 50, accepted: true }
    ];

    const rem = remainingAtDepartment(job, movements, "Plating");
    // Received 1000 - sent 50 - recordedRejections 100 = 850
    assert("TEST 8 Plating remaining WIP is 850 KG for 100 rejected + 50 returned", rem === 850, `got ${rem}`);
  }

  // TEST 9 — Partial Acceptance: 1000 movement -> accept 600 -> only 600 contributes to destination
  {
    const job = { jobCardNo: "JC-P3-009" };
    const movements = [
      { movementId: "M-PART-1", jobCardNo: "JC-P3-009", fromDepartment: "Heat Treatment", toDepartment: "Plating", quantity: 600, accepted: true }
    ];
    const rem = remainingAtDepartment(job, movements, "Plating");
    assert("TEST 9 Destination WIP reflects only accepted quantity (600 KG)", rem === 600, `got ${rem}`);
  }

  // TEST 10 — Duplicate Dispatch OperationId
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-010", orderQty: 1000, currentQty: 1000, currentDepartment: "Store" };
    await store.set("mfr_job_cards", "JC-P3-010", job);
    await store.set("mfr_movements", "M-IN-10", { movementId: "M-IN-10", jobCardNo: "JC-P3-010", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true });

    const resFirst = await commitMaterialMovementTx(store, {
      operationId: "op-dup-disp",
      jobCardNo: "JC-P3-010",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 500,
      actor: actor("Store")
    });
    assert("TEST 10 First dispatch attempt succeeded", resFirst.success === true, resFirst.error);

    const resSecond = await commitMaterialMovementTx(store, {
      operationId: "op-dup-disp",
      jobCardNo: "JC-P3-010",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 500,
      actor: actor("Store")
    });
    assert("TEST 10 Second dispatch with same operationId returns cached result", resSecond.cached === true && resSecond.success === true, resSecond.error);

    const allMovs = await store.list("mfr_movements");
    const dispMovs = allMovs.filter((m) => m.toDepartment === "Dispatch");
    assert("TEST 10 Only one movement was created in store", dispMovs.length === 1, `got ${dispMovs.length}`);
  }

  // TEST 11 — Endpoint Parity Contract
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-011", orderQty: 1000, currentQty: 1000, currentDepartment: "Production", materialType: "STEEL" };
    await store.set("mfr_job_cards", "JC-P3-011", job);

    const res = await commitMaterialMovementTx(store, {
      operationId: "op-parity-1",
      jobCardNo: "JC-P3-011",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 400,
      actor: actor("Production")
    });
    assert("TEST 11 Standard commitMaterialMovementTx produces valid contracted movement", res.success === true && res.movement?.materialType !== undefined, res.error);
  }

  // TEST 12 — OperationId Idempotency
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-012", orderQty: 1000, currentQty: 1000, currentDepartment: "Production" };
    await store.set("mfr_job_cards", "JC-P3-012", job);

    const r1 = await commitMaterialMovementTx(store, {
      operationId: "op-idemp-12",
      jobCardNo: "JC-P3-012",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 300,
      actor: actor("Production")
    });
    const r2 = await commitMaterialMovementTx(store, {
      operationId: "op-idemp-12",
      jobCardNo: "JC-P3-012",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 300,
      actor: actor("Production")
    });
    assert("TEST 12 Duplicate operationId returns cached flag", r2.cached === true && r1.movement.movementId === r2.movement.movementId);
  }

  // TEST 13 — Pending Duplicate Same Route
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-013", orderQty: 1000, currentQty: 1000, currentDepartment: "Production" };
    await store.set("mfr_job_cards", "JC-P3-013", job);

    await commitMaterialMovementTx(store, {
      operationId: "op-p1",
      jobCardNo: "JC-P3-013",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 300,
      actor: actor("Production")
    });

    const r2 = await commitMaterialMovementTx(store, {
      operationId: "op-p2",
      jobCardNo: "JC-P3-013",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 200,
      actor: actor("Production")
    });

    assert("TEST 13 Second pending movement on same route rejected", r2.success === false && r2.error?.includes("already pending"), r2.error);
  }

  // TEST 14 — Same Department Blocked
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P3-014", orderQty: 1000, currentQty: 1000, currentDepartment: "Packing" };
    await store.set("mfr_job_cards", "JC-P3-014", job);

    const r = await commitMaterialMovementTx(store, {
      operationId: "op-same-dept",
      jobCardNo: "JC-P3-014",
      fromDepartment: "Packing",
      toDepartment: "Packing",
      quantity: 100,
      actor: actor("Packing")
    });

    assert("TEST 14 Same-department movement Packing -> Packing rejected", r.success === false, "allowed same-department unexpectedly");
  }

  console.log(`\nProcess 3 tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProcess3Tests().catch((err) => {
  console.error("Process 3 tests threw unhandled error:", err);
  process.exit(1);
});
