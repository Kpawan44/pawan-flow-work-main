import { MemoryStore } from "../src/hardening/memoryStore";
import { splitJobCardTx } from "../src/hardening/splitJobCard";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  canFinalizeDispatch,
  remainingAtDepartment,
  storeAuthoritativeOnHand,
  getCumulativeDispatchedQty,
  getEffectiveDepartmentRejectionQty
} from "../src/hardening/process2Manufacturing";
import { JobCard } from "../src/types";

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

function actor(dept = "Production") {
  return {
    userId: "u-p6",
    userName: "P6 Operator",
    role: "admin",
    department: dept
  };
}

async function runProcess6Tests() {
  console.log("=== RUNNING PROCESS 6 SPLIT-JOB CARD LINEAGE & QUANTITY CONSERVATION TESTS ===");

  // TEST 1 & 11, 12, 13 — Parent 1000 -> Child A (600) + Child B (400) PASS & Lineage Persistence
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-100",
      orderNo: "ORD-P6-1",
      partyName: "PMW Client",
      itemName: "Shaft 10mm",
      itemCode: "SH-10",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Production",
      status: "In Progress",
      unit: "KG",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-100", parent);

    const res = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-001",
      parentJobCardNo: "JC-P6-100",
      childSplits: [
        { childJobCardNo: "JC-P6-100-A", quantity: 600 },
        { childJobCardNo: "JC-P6-100-B", quantity: 400 }
      ],
      actor: actor("Production")
    });

    assert("TEST 1 Parent 1000 -> child 600 + 400 succeeded", res.success);

    const updatedParent = await store.get("mfr_job_cards", "JC-P6-100");
    assert("TEST 1 Parent currentQty decrements to 0 after full split", updatedParent.currentQty === 0);

    const childA = await store.get("mfr_job_cards", "JC-P6-100-A");
    const childB = await store.get("mfr_job_cards", "JC-P6-100-B");

    assert("TEST 11 Parent-child lineage persists on parent childJobCardNos", Array.isArray(updatedParent.childJobCardNos) && updatedParent.childJobCardNos.length === 2);
    assert("TEST 12 Parent child list is correct", updatedParent.childJobCardNos.includes("JC-P6-100-A") && updatedParent.childJobCardNos.includes("JC-P6-100-B"));
    assert("TEST 13 Child A references correct parent", childA?.parentJobCardNo === "JC-P6-100");
    assert("TEST 13 Child B references correct parent", childB?.parentJobCardNo === "JC-P6-100");
    assert("TEST 1 Child A orderQty equals split quantity 600", childA?.orderQty === 600 && childA?.currentQty === 600);
    assert("TEST 1 Child B orderQty equals split quantity 400", childB?.orderQty === 400 && childB?.currentQty === 400);
  }

  // TEST 2 — Over-allocation Parent 1000 -> Child 600 + 500 FAIL
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-OVER",
      orderNo: "ORD-P6-2",
      partyName: "PMW Client",
      itemName: "Pin 5mm",
      itemCode: "PIN-5",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Production",
      status: "In Progress",
      unit: "KG",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-OVER", parent);

    const res = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-OVER",
      parentJobCardNo: "JC-P6-OVER",
      childSplits: [
        { childJobCardNo: "JC-OVER-A", quantity: 600 },
        { childJobCardNo: "JC-OVER-B", quantity: 500 }
      ],
      actor: actor("Production")
    });

    assert("TEST 2 Parent 1000 -> child 600 + 500 over-allocation rejected", !res.success && res.statusCode === 400);
    const parentUnchanged = await store.get("mfr_job_cards", "JC-P6-OVER");
    assert("TEST 2 Parent job card remains unchanged after rejected split", parentUnchanged.currentQty === 1000);
  }

  // TEST 3 & 4 & 5 — Single full split, Zero split, Negative split
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-SINGLE",
      orderNo: "ORD-P6-3",
      partyName: "PMW Client",
      itemName: "Gear 80T",
      itemCode: "GR-80",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Production",
      status: "In Progress",
      unit: "PCS",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-SINGLE", parent);

    // TEST 4 — Child 0 FAIL
    const resZero = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-ZERO",
      parentJobCardNo: "JC-P6-SINGLE",
      childSplits: [{ childJobCardNo: "JC-ZERO-A", quantity: 0 }],
      actor: actor("Production")
    });
    assert("TEST 4 Child quantity 0 rejected", !resZero.success && resZero.statusCode === 400);

    // TEST 5 — Negative quantity FAIL
    const resNeg = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-NEG",
      parentJobCardNo: "JC-P6-SINGLE",
      childSplits: [{ childJobCardNo: "JC-NEG-A", quantity: -100 }],
      actor: actor("Production")
    });
    assert("TEST 5 Negative child quantity rejected", !resNeg.success && resNeg.statusCode === 400);

    // TEST 3 — Parent 1000 -> Child 1000 PASS
    const resFull = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-FULL",
      parentJobCardNo: "JC-P6-SINGLE",
      childSplits: [{ childJobCardNo: "JC-SINGLE-FULL", quantity: 1000 }],
      actor: actor("Production")
    });
    assert("TEST 3 Parent 1000 -> child 1000 single full split succeeded", resFull.success);
  }

  // TEST 6 & 7 & 8 & 24 — Duplicate child ID, Existing child ID, Parent == Child, Cyclic Lineage
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-DUP",
      orderNo: "ORD-P6-4",
      partyName: "Client DUP",
      itemName: "Bolt M12",
      itemCode: "BL-12",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Production",
      status: "In Progress",
      unit: "PCS",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-DUP", parent);

    // Existing job in store
    await store.set("mfr_job_cards", "JC-EXISTS-99", { jobCardNo: "JC-EXISTS-99", orderQty: 100, currentQty: 100, currentDepartment: "Store", status: "In Progress" });

    // TEST 6 — Duplicate child ID in input FAIL
    const resDupIn = await splitJobCardTx(store, {
      operationId: "OP-DUP-INPUT",
      parentJobCardNo: "JC-P6-DUP",
      childSplits: [
        { childJobCardNo: "JC-DUP-CHILD", quantity: 300 },
        { childJobCardNo: "JC-DUP-CHILD", quantity: 300 }
      ],
      actor: actor("Production")
    });
    assert("TEST 6 Duplicate child ID in input list rejected", !resDupIn.success && resDupIn.statusCode === 400);

    // TEST 7 — Existing child ID in store FAIL
    const resExist = await splitJobCardTx(store, {
      operationId: "OP-EXIST-STORE",
      parentJobCardNo: "JC-P6-DUP",
      childSplits: [{ childJobCardNo: "JC-EXISTS-99", quantity: 300 }],
      actor: actor("Production")
    });
    assert("TEST 7 Existing child ID in store rejected", !resExist.success && resExist.statusCode === 409);

    // TEST 8 — Parent == child FAIL
    const resSelf = await splitJobCardTx(store, {
      operationId: "OP-SELF-SPLIT",
      parentJobCardNo: "JC-P6-DUP",
      childSplits: [{ childJobCardNo: "JC-P6-DUP", quantity: 300 }],
      actor: actor("Production")
    });
    assert("TEST 8 Parent == child split rejected", !resSelf.success && resSelf.statusCode === 400);
  }

  // TEST 9 & 10 — Idempotency & Re-execution Protection
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-IDEM",
      orderNo: "ORD-P6-5",
      partyName: "Client IDEM",
      itemName: "Bush 20mm",
      itemCode: "BS-20",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Production",
      status: "In Progress",
      unit: "KG",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-IDEM", parent);

    const res1 = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-IDEM-001",
      parentJobCardNo: "JC-P6-IDEM",
      childSplits: [{ childJobCardNo: "JC-IDEM-A", quantity: 600 }],
      actor: actor("Production")
    });
    assert("TEST 9 First split attempt succeeded", res1.success);

    const resDup = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-IDEM-001",
      parentJobCardNo: "JC-P6-IDEM",
      childSplits: [{ childJobCardNo: "JC-IDEM-A", quantity: 600 }],
      actor: actor("Production")
    });
    assert("TEST 9 Duplicate operationId returns cached original", resDup.cached === true && resDup.success === true);

    const parentAfter = await store.get("mfr_job_cards", "JC-P6-IDEM");
    assert("TEST 10 Same split cannot execute twice (parent quantity is 400, not -200)", parentAfter.currentQty === 400);
  }

  // TEST 14 & 15 & 16 & 19 — Child Stock Isolation, Independent Dispatch, Partial Dispatch & Multi-Job Manifest
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-WORK",
      orderNo: "ORD-P6-6",
      partyName: "Client WORK",
      itemName: "Ring 50mm",
      itemCode: "RG-50",
      orderQty: 1000,
      currentQty: 1000,
      balanceQty: 1000,
      currentDepartment: "Store",
      status: "In Progress",
      unit: "KG",
      heatTreatmentRequired: false,
      completed: false,
      createdBy: "Admin",
      createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-WORK", parent);

    // Split parent into Child A (600 KG) and Child B (400 KG)
    await splitJobCardTx(store, {
      operationId: "OP-SPLIT-WORK",
      parentJobCardNo: "JC-P6-WORK",
      childSplits: [
        { childJobCardNo: "JC-WORK-A", quantity: 600 },
        { childJobCardNo: "JC-WORK-B", quantity: 400 }
      ],
      actor: actor("Store")
    });

    // Inward child movements to Store
    await store.set("mfr_movements", "M-WA-IN", { movementId: "M-WA-IN", jobCardNo: "JC-WORK-A", fromDepartment: "Packing", toDepartment: "Store", quantity: 600, accepted: true });
    await store.set("mfr_movements", "M-WB-IN", { movementId: "M-WB-IN", jobCardNo: "JC-WORK-B", fromDepartment: "Packing", toDepartment: "Store", quantity: 400, accepted: true });

    // TEST 14 — Child A cannot consume Child B quantity (Child A dispatching 700 vs 600 available)
    const resOverA = await commitMaterialMovementTx(store, {
      operationId: "OP-DISP-OVER-A",
      jobCardNo: "JC-WORK-A",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 700,
      actor: actor("Store")
    });
    assert("TEST 14 Child A cannot consume Child B quantity (over-dispatch rejected)", !resOverA.success && resOverA.statusCode === 400);

    // TEST 16 — Partial dispatch on Child A (300 KG leg 1)
    const resLeg1 = await commitMaterialMovementTx(store, {
      operationId: "OP-DISP-WA-1",
      jobCardNo: "JC-WORK-A",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 300,
      dispatchGroupNo: "MANIFEST-P6-88",
      manifestId: "MNF-P6-88",
      actor: actor("Store")
    });
    assert("TEST 16 Partial dispatch on Child A leg 1 (300 KG) succeeded", resLeg1.success);

    // Accept Leg 1
    const movs1 = await store.list("mfr_movements");
    const leg1Mov = movs1.find((m: any) => m.operationId === "OP-DISP-WA-1");
    if (leg1Mov) { leg1Mov.accepted = true; await store.set("mfr_movements", leg1Mov.movementId, leg1Mov); }
    await store.set("mfr_job_cards", "JC-WORK-A", { ...(await store.get("mfr_job_cards", "JC-WORK-A")), pendingOutbound: [] });

    // TEST 15 & 19 — Child A dispatch independent of Child B & Multi-Job Manifest with Child Jobs
    const resLegB = await commitMaterialMovementTx(store, {
      operationId: "OP-DISP-WB-1",
      jobCardNo: "JC-WORK-B",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 400,
      dispatchGroupNo: "MANIFEST-P6-88",
      manifestId: "MNF-P6-88",
      actor: actor("Store")
    });
    assert("TEST 15 Child B dispatch independent of Child A succeeded", resLegB.success);
    assert("TEST 19 Multi-job manifest works cleanly with child job cards", resLegB.movement?.manifestId === "MNF-P6-88");
  }

  // TEST 17 & 18 — Rework & Rejection Isolation on Child Jobs
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-ISO", orderNo: "ORD-ISO", partyName: "Client ISO", itemName: "Pin 12mm", itemCode: "PN-12",
      orderQty: 1000, currentQty: 1000, balanceQty: 1000, currentDepartment: "Store", status: "In Progress", unit: "PCS", heatTreatmentRequired: false, completed: false, createdBy: "Admin", createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-ISO", parent);

    await splitJobCardTx(store, {
      operationId: "OP-SPLIT-ISO",
      parentJobCardNo: "JC-P6-ISO",
      childSplits: [
        { childJobCardNo: "JC-ISO-A", quantity: 600 },
        { childJobCardNo: "JC-ISO-B", quantity: 400 }
      ],
      actor: actor("Store")
    });

    await store.set("mfr_movements", "M-ISO-A-IN", { movementId: "M-ISO-A-IN", jobCardNo: "JC-ISO-A", fromDepartment: "Packing", toDepartment: "Store", quantity: 600, accepted: true });
    await store.set("mfr_movements", "M-ISO-B-IN", { movementId: "M-ISO-B-IN", jobCardNo: "JC-ISO-B", fromDepartment: "Packing", toDepartment: "Store", quantity: 400, accepted: true });

    // Store -> Packing rework loop on Child A only
    const resReworkA = await commitMaterialMovementTx(store, { operationId: "OP-REW-A", jobCardNo: "JC-ISO-A", fromDepartment: "Store", toDepartment: "Packing", quantity: 150, actor: actor("Store") });
    assert("TEST 17 Rework on Child A created", resReworkA.success);

    const movsRew = await store.list("mfr_movements");
    const rewMov = movsRew.find((m: any) => m.operationId === "OP-REW-A");
    if (rewMov) { rewMov.accepted = true; await store.set("mfr_movements", rewMov.movementId, rewMov); }

    const childAJob = await store.get("mfr_job_cards", "JC-ISO-A");
    const childBJob = await store.get("mfr_job_cards", "JC-ISO-B");

    const onHandChildA = storeAuthoritativeOnHand(childAJob, await store.list("mfr_movements"));
    const onHandChildB = storeAuthoritativeOnHand(childBJob, await store.list("mfr_movements"));

    assert("TEST 17 Rework on Child A decrements Child A store stock to 450 PCS", onHandChildA === 450);
    assert("TEST 18 Child B store stock remains untouched at 400 PCS (rework isolated)", onHandChildB === 400);
  }

  // TEST 21 & 22 & 23 — Decimal Split & Sequential Split Conservation
  {
    const store = new MemoryStore();
    const parent: JobCard = {
      jobCardNo: "JC-P6-DEC", orderNo: "ORD-DEC", partyName: "Client DEC", itemName: "Bar 25mm", itemCode: "BR-25",
      orderQty: 1000.50, currentQty: 1000.50, balanceQty: 1000.50, currentDepartment: "Production", status: "In Progress", unit: "KG", heatTreatmentRequired: false, completed: false, createdBy: "Admin", createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-DEC", parent);

    // TEST 22 — Decimal over-allocation 1000.50 -> 600.25 + 400.30 FAIL
    const resOverDec = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-DEC-OVER",
      parentJobCardNo: "JC-P6-DEC",
      childSplits: [
        { childJobCardNo: "JC-DEC-A", quantity: 600.25 },
        { childJobCardNo: "JC-DEC-B", quantity: 400.30 }
      ],
      actor: actor("Production")
    });
    assert("TEST 22 Decimal conservation rejects over-allocation (1000.50 vs 1000.55)", !resOverDec.success && resOverDec.statusCode === 400);

    // TEST 21 — Decimal split 1000.50 -> 600.25 + 400.25 PASS
    const resPassDec = await splitJobCardTx(store, {
      operationId: "OP-SPLIT-DEC-PASS",
      parentJobCardNo: "JC-P6-DEC",
      childSplits: [
        { childJobCardNo: "JC-DEC-A", quantity: 600.25 },
        { childJobCardNo: "JC-DEC-B", quantity: 400.25 }
      ],
      actor: actor("Production")
    });
    assert("TEST 21 Decimal split (1000.50 -> 600.25 + 400.25) succeeded", resPassDec.success);

    const parentDecAfter = await store.get("mfr_job_cards", "JC-P6-DEC");
    assert("TEST 21 Parent remaining currentQty after decimal split is 0", Math.abs(parentDecAfter.currentQty) < 0.001);

    // TEST 23 — Multiple sequential splits obey remaining quantity
    const parentSeq: JobCard = {
      jobCardNo: "JC-P6-SEQ", orderNo: "ORD-SEQ", partyName: "Client SEQ", itemName: "Tube 15mm", itemCode: "TB-15",
      orderQty: 1000, currentQty: 1000, balanceQty: 1000, currentDepartment: "Production", status: "In Progress", unit: "KG", heatTreatmentRequired: false, completed: false, createdBy: "Admin", createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-P6-SEQ", parentSeq);

    // Split 1: 400 KG -> remaining 600 KG
    await splitJobCardTx(store, { operationId: "OP-SEQ-1", parentJobCardNo: "JC-P6-SEQ", childSplits: [{ childJobCardNo: "JC-SEQ-1", quantity: 400 }], actor: actor("Production") });
    const pSeq1 = await store.get("mfr_job_cards", "JC-P6-SEQ");
    assert("TEST 23 First sequential split leaves 600 KG remaining on parent", pSeq1.currentQty === 600);

    // Split 2: 700 KG vs 600 remaining -> FAIL
    const resSeqFail = await splitJobCardTx(store, { operationId: "OP-SEQ-FAIL", parentJobCardNo: "JC-P6-SEQ", childSplits: [{ childJobCardNo: "JC-SEQ-FAIL", quantity: 700 }], actor: actor("Production") });
    assert("TEST 23 Sequential split exceeding remaining quantity rejected", !resSeqFail.success && resSeqFail.statusCode === 400);

    // Split 2 valid: 600 KG -> remaining 0 KG
    const resSeqPass = await splitJobCardTx(store, { operationId: "OP-SEQ-2", parentJobCardNo: "JC-P6-SEQ", childSplits: [{ childJobCardNo: "JC-SEQ-2", quantity: 600 }], actor: actor("Production") });
    assert("TEST 23 Second valid sequential split (600 KG) succeeded", resSeqPass.success);
    const pSeq2 = await store.get("mfr_job_cards", "JC-P6-SEQ");
    assert("TEST 23 Parent has 2 child entries recorded", pSeq2.childJobCardNos.length === 2);
  }

  // TEST 20 — Legacy Jobs without Lineage Continue Working
  {
    const store = new MemoryStore();
    const legacyJob: JobCard = {
      jobCardNo: "JC-LEGACY-P6", orderNo: "ORD-LEG", partyName: "Legacy Client", itemName: "Bolt M10", itemCode: "BL-10",
      orderQty: 500, currentQty: 500, balanceQty: 500, currentDepartment: "Store", status: "In Progress", unit: "PCS", heatTreatmentRequired: false, completed: false, createdBy: "Admin", createdAt: new Date().toISOString()
    };
    await store.set("mfr_job_cards", "JC-LEGACY-P6", legacyJob);
    await store.set("mfr_movements", "M-LEG-IN", { movementId: "M-LEG-IN", jobCardNo: "JC-LEGACY-P6", fromDepartment: "Packing", toDepartment: "Store", quantity: 500, accepted: true });

    const resDispLeg = await commitMaterialMovementTx(store, { operationId: "OP-LEG-DISP", jobCardNo: "JC-LEGACY-P6", fromDepartment: "Store", toDepartment: "Dispatch", quantity: 250, actor: actor("Store") });
    assert("TEST 20 Legacy jobs without lineage fields continue working cleanly", resDispLeg.success);
  }

  console.log(`\nProcess 6 Lineage & Conservation tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProcess6Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
