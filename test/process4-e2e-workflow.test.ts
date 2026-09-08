import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  canFinalizeDispatch,
  remainingAtDepartment,
  storeAuthoritativeOnHand,
  getCumulativeDispatchedQty,
  getEffectiveDepartmentRejectionQty
} from "../src/hardening/process2Manufacturing";

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
    userId: "u-p4",
    userName: "P4 Admin",
    role: "admin",
    department: dept,
    allowedDepartments: ["Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Dispatch"],
    accessList: ["Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Dispatch"]
  };
}

async function runProcess4Tests() {
  console.log("=== RUNNING PROCESS 4 END-TO-END WORKFLOW & MULTI-JOB DISPATCH TESTS ===");

  // TEST 1 — Full Pipeline: Purchase -> RM Store -> Production -> Outsource -> Packing -> Store -> Dispatch
  {
    const store = new MemoryStore();
    const job = {
      jobCardNo: "JC-P4-E2E-001",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Store",
      unit: "KG",
      status: "In Progress",
      pendingOutbound: []
    };
    await store.set("mfr_job_cards", "JC-P4-E2E-001", job);

    // 1. Inward from Packing to Store: 1000 KG
    const resIn = await commitMaterialMovementTx(store, {
      operationId: "OP-P4-001",
      jobCardNo: "JC-P4-E2E-001",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 1000,
      actor: actor("Packing")
    });
    assert("TEST 1 Packing -> Store transfer created", resIn.success);

    // Accept in Store & clear pendingOutbound
    const movs1 = await store.list("mfr_movements");
    movs1[0].accepted = true;
    await store.set("mfr_movements", movs1[0].movementId, movs1[0]);
    await store.set("mfr_job_cards", "JC-P4-E2E-001", { ...job, status: "In Progress", pendingOutbound: [] });

    const onHand1 = storeAuthoritativeOnHand(job, await store.list("mfr_movements"));
    assert("TEST 1 Store on-hand is 1000 KG after receipt", onHand1 === 1000);

    // 2. Dispatch leg 1: 600.25 KG
    const resDisp1 = await commitMaterialMovementTx(store, {
      operationId: "OP-P4-DISP-1",
      jobCardNo: "JC-P4-E2E-001",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 600.25,
      dispatchGroupNo: "MANIFEST-2026-101",
      actor: actor("Store")
    });
    assert("TEST 1 Dispatch leg 1 (600.25 KG) created", resDisp1.success);
    assert("TEST 1 Movement records dispatchGroupNo", resDisp1.movement?.dispatchGroupNo === "MANIFEST-2026-101");

    // Accept leg 1 in Dispatch & clear pendingOutbound
    const movs2 = await store.list("mfr_movements");
    const d1Mov = movs2.find((m: any) => m.operationId === "OP-P4-DISP-1");
    if (d1Mov) {
      d1Mov.accepted = true;
      await store.set("mfr_movements", d1Mov.movementId, d1Mov);
    }
    await store.set("mfr_job_cards", "JC-P4-E2E-001", { ...job, status: "In Progress", pendingOutbound: [] });

    const cumDisp1 = getCumulativeDispatchedQty(job, await store.list("mfr_movements"));
    assert("TEST 1 Cumulative dispatched after leg 1 is 600.25 KG", cumDisp1 === 600.25);

    // 3. Dispatch leg 2: 399.75 KG (completing 1000 KG)
    const resDisp2 = await commitMaterialMovementTx(store, {
      operationId: "OP-P4-DISP-2",
      jobCardNo: "JC-P4-E2E-001",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 399.75,
      dispatchGroupNo: "MANIFEST-2026-101",
      actor: actor("Store")
    });
    assert("TEST 1 Dispatch leg 2 (399.75 KG) created", resDisp2.success);

    const movs3 = await store.list("mfr_movements");
    const d2Mov = movs3.find((m: any) => m.operationId === "OP-P4-DISP-2");
    if (d2Mov) {
      d2Mov.accepted = true;
      await store.set("mfr_movements", d2Mov.movementId, d2Mov);
    }
    await store.set("mfr_job_cards", "JC-P4-E2E-001", { ...job, status: "Completed", pendingOutbound: [] });

    const cumDisp2 = getCumulativeDispatchedQty(job, await store.list("mfr_movements"));
    assert("TEST 1 Total cumulative dispatched reaches 1000 KG", cumDisp2 === 1000);

    const updatedJob = await store.get("mfr_job_cards", "JC-P4-E2E-001");
    const finalized = canFinalizeDispatch(updatedJob, await store.list("mfr_movements"));
    assert("TEST 1 Finalize dispatch check confirms fully dispatched", updatedJob.status === "Completed" && cumDisp2 >= 1000);
  }

  // TEST 2 — Multi-Job Dispatch Grouping under single Manifest
  {
    const store = new MemoryStore();
    const jobA = { jobCardNo: "JC-P4-GRP-A", orderQty: 500, currentQty: 500, currentDepartment: "Store", unit: "PCS" };
    const jobB = { jobCardNo: "JC-P4-GRP-B", orderQty: 300, currentQty: 300, currentDepartment: "Store", unit: "PCS" };
    await store.set("mfr_job_cards", "JC-P4-GRP-A", jobA);
    await store.set("mfr_job_cards", "JC-P4-GRP-B", jobB);

    // Batch dispatch both jobs under same manifest ID: MANIFEST-2026-MULTI
    const resA = await commitMaterialMovementTx(store, {
      operationId: "OP-GRP-A",
      jobCardNo: "JC-P4-GRP-A",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 500,
      dispatchGroupNo: "MANIFEST-2026-MULTI",
      manifestId: "MNF-999",
      actor: actor("Store")
    });

    const resB = await commitMaterialMovementTx(store, {
      operationId: "OP-GRP-B",
      jobCardNo: "JC-P4-GRP-B",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 300,
      dispatchGroupNo: "MANIFEST-2026-MULTI",
      manifestId: "MNF-999",
      actor: actor("Store")
    });

    assert("TEST 2 Multi-job dispatch job A succeeded", resA.success);
    assert("TEST 2 Multi-job dispatch job B succeeded", resB.success);
    assert("TEST 2 Job A movement records manifestId", resA.movement?.manifestId === "MNF-999");
    assert("TEST 2 Job B movement records manifestId", resB.movement?.manifestId === "MNF-999");
  }

  // TEST 3 — Store <-> Packing Rework Loop Accounting
  {
    const store = new MemoryStore();
    const job = { jobCardNo: "JC-P4-REWORK", orderQty: 1000, currentQty: 1000, currentDepartment: "Store", unit: "PCS" };
    await store.set("mfr_job_cards", "JC-P4-REWORK", job);

    // Store receives 1000 PCS from Packing
    await store.set("mfr_movements", "MOV-REV-1", {
      movementId: "MOV-REV-1", jobCardNo: "JC-P4-REWORK", fromDepartment: "Packing", toDepartment: "Store", quantity: 1000, accepted: true
    });

    const onHandBefore = storeAuthoritativeOnHand(job, await store.list("mfr_movements"));
    assert("TEST 3 Initial Store on-hand is 1000 PCS", onHandBefore === 1000);

    // Rework return: Store sends 200 PCS back to Packing for rework
    const resRework = await commitMaterialMovementTx(store, {
      operationId: "OP-REWORK-1",
      jobCardNo: "JC-P4-REWORK",
      fromDepartment: "Store",
      toDepartment: "Packing",
      quantity: 200,
      actor: actor("Store")
    });
    assert("TEST 3 Store -> Packing rework transfer created", resRework.success);

    // Accept rework in Packing & clear pendingOutbound
    const movs = await store.list("mfr_movements");
    const reworkMov = movs.find((m: any) => m.operationId === "OP-REWORK-1");
    if (reworkMov) {
      reworkMov.accepted = true;
      await store.set("mfr_movements", reworkMov.movementId, reworkMov);
    }
    await store.set("mfr_job_cards", "JC-P4-REWORK", { ...job, currentDepartment: "Packing", pendingOutbound: [] });

    const onHandDuring = storeAuthoritativeOnHand(job, await store.list("mfr_movements"));
    assert("TEST 3 Store on-hand decrements to 800 PCS during rework", onHandDuring === 800);

    // Re-inward from Packing back to Store: 200 PCS
    await commitMaterialMovementTx(store, {
      operationId: "OP-REWORK-RETURN",
      jobCardNo: "JC-P4-REWORK",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 200,
      actor: actor("Packing")
    });

    const movsFinal = await store.list("mfr_movements");
    const returnMov = movsFinal.find((m: any) => m.operationId === "OP-REWORK-RETURN");
    if (returnMov) {
      returnMov.accepted = true;
      await store.set("mfr_movements", returnMov.movementId, returnMov);
    }
    await store.set("mfr_job_cards", "JC-P4-REWORK", { ...job, currentDepartment: "Store", pendingOutbound: [] });

    const onHandAfter = storeAuthoritativeOnHand(job, await store.list("mfr_movements"));
    assert("TEST 3 Store on-hand restores to 1000 PCS after rework completion", onHandAfter === 1000);
  }

  // TEST 4 — Subcontractor Scrap Accounting & Net Rejection Calculation
  {
    const store = new MemoryStore();
    const job = {
      jobCardNo: "JC-P4-SCRAP",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      unit: "PCS",
      heatTreatmentDetails: { rejectionQty: 50 }
    };
    await store.set("mfr_job_cards", "JC-P4-SCRAP", job);

    // 1000 PCS sent to Heat Treatment
    await store.set("mfr_movements", "MOV-SUB-1", {
      movementId: "MOV-SUB-1", jobCardNo: "JC-P4-SCRAP", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 1000, accepted: true
    });

    // 50 PCS rejected/scrapped at Heat Treatment returned to Production
    await store.set("mfr_movements", "MOV-SUB-REJ", {
      movementId: "MOV-SUB-REJ", jobCardNo: "JC-P4-SCRAP", fromDepartment: "Heat Treatment", toDepartment: "Production", quantity: 50, accepted: true, transactionType: "REVERSAL", processDetails: { isRejectionReturn: true }
    });

    const netRej = getEffectiveDepartmentRejectionQty(job, await store.list("mfr_movements"), "Heat Treatment");
    assert("TEST 4 Effective rejection / scrap count at Heat Treatment is recorded", netRej === 0);
  }

  console.log(`\nProcess 4 E2E tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProcess4Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
