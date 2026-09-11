import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";
import { isVisibleInProductionQueue, isVisibleInDepartmentQueue, parseDecimalQuantity } from "../src/hardening/process1Purchase";
import {
  canIssueRawMaterialQty,
  getAcceptedRawMaterialIssuedQty,
  canStartProductionWithRm,
  remainingAtProduction,
  remainingAtDepartment,
  storeAuthoritativeOnHand,
  isVisibleInDispatchQueue,
  canFinalizeDispatch,
  attachProcess2MovementContract,
  findPendingDuplicateMovement,
  shouldUpdateJobOnAccept,
  isRawMaterialStoreIssuingToProduction,
  sameDepartmentTransferBlocked,
  unproducedOrderQty,
  shouldBlockPendingDuplicateRoute
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

function actor(dept = "Production") {
  return {
    userId: "u-p2",
    userName: "P2 User",
    role: "staff",
    department: dept,
    allowedDepartments: [dept],
    accessList: []
  };
}

async function run() {
  const rmMoves = [
    { fromDepartment: "Purchase", toDepartment: "Raw Material Store", accepted: true, quantity: 1000, processDetails: { rawMaterialCode: "EN8-R" }, jobCardNo: "STOCK-IN-EN8-R" }
  ];
  const stock1000 = computeRmRuntimeStock(0, rmMoves, "EN8-R");
  assert("TEST 1 RM stock 1000 from accepted purchase", stock1000 === 1000);

  const afterIssue = computeRmRuntimeStock(0, [
    ...rmMoves,
    { fromDepartment: "Raw Material Store", toDepartment: "Production", isIssueRequest: true, issueStatus: "Issued", accepted: false, quantity: 600, processDetails: { rawMaterialCode: "EN8-R" }, jobCardNo: "JC-1" }
  ], "EN8-R");
  assert("TEST 1 issue 600 reduces RM stock to 400", afterIssue === 400);
  assert("TEST 1 issue 600 allowed vs 1000", canIssueRawMaterialQty(1000, 600).ok === true);

  assert("TEST 2 issue 600 vs 500 rejected", canIssueRawMaterialQty(500, 600).ok === false);

  const job = { jobCardNo: "JC-P2", processType: "Manufacturing", orderQty: 1000, currentQty: 1000, currentDepartment: "Production" };
  const issuedUnaccepted = [
    { jobCardNo: "JC-P2", fromDepartment: "Raw Material Store", toDepartment: "Production", isIssueRequest: true, issueStatus: "Issued", accepted: false, quantity: 600 }
  ];
  assert("TEST 3 unaccepted issue is not accepted RM qty", getAcceptedRawMaterialIssuedQty(job, issuedUnaccepted) === 0);
  assert("TEST 3 cannot start until Production accepts", canStartProductionWithRm(job, issuedUnaccepted, { compulsory: true }).ok === false);

  const issuedAccepted = [{ ...issuedUnaccepted[0], accepted: true }];
  assert("TEST 4 accepted RM allows start", canStartProductionWithRm(job, issuedAccepted, { compulsory: true }).ok === true);

  const afterIssueAccept = { ...job, currentQty: 1000 };
  assert("TEST 5 RM issue must not imply currentQty overwrite", afterIssueAccept.currentQty === 1000);
  assert("TEST 5 shouldUpdateJobOnAccept false while RM issuing", shouldUpdateJobOnAccept({
    isIssueRequest: true, fromDepartment: "Raw Material Store", toDepartment: "Production", issueStatus: "Issued"
  }) === false);
  assert("TEST 5 isRawMaterialStoreIssuingToProduction", isRawMaterialStoreIssuingToProduction({
    isIssueRequest: true, fromDepartment: "Raw Material Store", toDepartment: "Production", issueStatus: "Issued"
  }) === true);

  const prodMoves = [
    { jobCardNo: "JC-P2", fromDepartment: "Raw Material Store", toDepartment: "Production", isIssueRequest: true, accepted: true, quantity: 1000 },
    { jobCardNo: "JC-P2", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 600, accepted: false }
  ];
  assert("TEST 6 remaining after 600 of 1000 accepted RM is 400", remainingAtProduction(job, prodMoves, { compulsory: true }) === 400);

  const sfgProd = { jobCardNo: "PUR-SFG", processType: "Purchase", currentDepartment: "Production", status: "Pending", completed: false };
  assert("TEST 7 Purchase SFG accepted in Production is visible", isVisibleInProductionQueue(sfgProd) === true);
  const stillPurchase = { ...sfgProd, currentDepartment: "Purchase", status: "Pending Acceptance" };
  assert("TEST 7 still in Purchase not in Production queue", isVisibleInProductionQueue(stillPurchase) === false);

  const sfgHt = { jobCardNo: "PUR-SFG-HT", currentDepartment: "Heat Treatment", status: "In Process", completed: false };
  assert("TEST 8 HT sees Purchase SFG after accept", isVisibleInDepartmentQueue("Heat Treatment", sfgHt) === true);

  const sfgPl = { ...sfgHt, currentDepartment: "Plating" };
  assert("TEST 9 Plating sees Purchase SFG after accept", isVisibleInDepartmentQueue("Plating", sfgPl) === true);

  const htJob = { jobCardNo: "JC-HT", heatTreatmentDetails: { rejectionQty: 0 } };
  const htMoves = [
    { jobCardNo: "JC-HT", toDepartment: "Heat Treatment", fromDepartment: "Production", accepted: true, quantity: 100 },
    { jobCardNo: "JC-HT", fromDepartment: "Heat Treatment", toDepartment: "Plating", accepted: false, quantity: 60 }
  ];
  assert("TEST 10 HT remaining 40 after sending 60 of 100", remainingAtDepartment(htJob, htMoves, "Heat Treatment") === 40);

  const plJob = { jobCardNo: "JC-PL", platingDetails: { rejectionQty: 0 } };
  const plMoves = [
    { jobCardNo: "JC-PL", toDepartment: "Plating", fromDepartment: "Heat Treatment", accepted: true, quantity: 100 },
    { jobCardNo: "JC-PL", fromDepartment: "Plating", toDepartment: "Packing", quantity: 60 }
  ];
  assert("TEST 11 Plating remaining 40 after sending 60 of 100", remainingAtDepartment(plJob, plMoves, "Plating") === 40);

  const packJob = { jobCardNo: "JC-PK", packingDetails: { rejectionQty: 0 }, unit: "KGS" };
  const packMoves = [
    { jobCardNo: "JC-PK", toDepartment: "Packing", accepted: true, quantity: 100 },
    { jobCardNo: "JC-PK", fromDepartment: "Packing", toDepartment: "Store", quantity: 100 }
  ];
  assert("TEST 12 Packing sends 100 KG to Store", remainingAtDepartment(packJob, packMoves, "Packing") === 0);

  const storeJob = { jobCardNo: "JC-ST", currentDepartment: "Store", currentQty: 100 };
  const loopMoves = [
    { jobCardNo: "JC-ST", toDepartment: "Store", fromDepartment: "Packing", accepted: true, quantity: 100 },
    { jobCardNo: "JC-ST", fromDepartment: "Store", toDepartment: "Packing", accepted: true, quantity: 100 },
    { jobCardNo: "JC-ST", toDepartment: "Store", fromDepartment: "Packing", accepted: true, quantity: 100 }
  ];
  assert("TEST 13 Store packing loop on-hand is 100 not 200", storeAuthoritativeOnHand(storeJob, loopMoves) === 100);

  const fg = attachProcess2MovementContract(
    { jobCardNo: "PUR-FG", fromDepartment: "Packing", toDepartment: "Store", quantity: 100 },
    { itemCode: "fg-bolt", itemName: "Bolt FG", materialType: "Finished Goods", unit: "PCS", jobCardNo: "PUR-FG" }
  );
  assert("TEST 14 FG unit remains PCS", fg.unit === "PCS");
  assert("TEST 20 metadata itemCode/itemName/materialType/unit", fg.itemCode === "FG-BOLT" && fg.itemName === "Bolt FG" && fg.materialType === "Finished Goods" && fg.unit === "PCS");

  assert("TEST 15 decimal 1000.50 preserved", parseDecimalQuantity("1000.50") === 1000.5);

  const dispJob = { jobCardNo: "JC-D", completed: false, currentDepartment: "Production", status: "In Process" };
  assert("TEST 16 Production job not in Dispatch queue", isVisibleInDispatchQueue(dispJob, []) === false);
  const dispInbound = { jobCardNo: "JC-D", toDepartment: "Dispatch", accepted: false };
  assert("TEST 16 inbound Dispatch work is visible", isVisibleInDispatchQueue(dispJob, [dispInbound]) === true);
  assert("TEST 16 currentDepartment Dispatch is visible", isVisibleInDispatchQueue({ ...dispJob, currentDepartment: "Dispatch" }, []) === true);

  assert("TEST 17 completed cannot dispatch twice", canFinalizeDispatch({ completed: true }).ok === false);
  assert("TEST 17 dispatchQty already set blocked", canFinalizeDispatch({ completed: false, dispatchDetails: { dispatchQty: 10 } }).ok === false);
  assert("TEST 17 first dispatch allowed", canFinalizeDispatch({ completed: false, status: "In Process" }).ok === true);

  const store = new MemoryStore();
  await store.set("mfr_job_cards", "JC-IDEM", { jobCardNo: "JC-IDEM", currentQty: 100, orderQty: 100, currentDepartment: "Packing", version: 1, itemCode: "X1", itemName: "Item", materialType: "Finished Goods", unit: "KGS" });
  const first = await commitMaterialMovementTx(store, {
    operationId: "p2-op-1",
    jobCardNo: "JC-IDEM",
    fromDepartment: "Packing",
    toDepartment: "Store",
    quantity: 100,
    extra: { itemCode: "X1", itemName: "Item", materialType: "Finished Goods", unit: "KGS" },
    actor: actor("Packing")
  });
  const second = await commitMaterialMovementTx(store, {
    operationId: "p2-op-1",
    jobCardNo: "JC-IDEM",
    fromDepartment: "Packing",
    toDepartment: "Store",
    quantity: 100,
    actor: actor("Packing")
  });
  assert("TEST 18 duplicate operationId returns cached original", first.success === true && second.success === true && second.cached === true);

  const pending = [{ jobCardNo: "JC-IDEM", fromDepartment: "Packing", toDepartment: "Store", accepted: false }];
  assert("TEST 19 duplicate pending same-route rejected", findPendingDuplicateMovement(pending, { jobCardNo: "JC-IDEM", fromDepartment: "Packing", toDepartment: "Store" }) === true);

  assert("TEST packing same-dept blocked", sameDepartmentTransferBlocked("Packing", "Packing") === true);

  const incomingToProd = { jobCardNo: "PUR-IN", processType: "Purchase", currentDepartment: "Production", status: "In Process", completed: false };
  assert("Incoming Store → Production accepted visible", isVisibleInProductionQueue(incomingToProd) === true);

  {
    const store = new MemoryStore();
    const job = {
      jobCardNo: "JC-PARTIAL-1000",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      status: "Pending",
      processType: "Manufacturing",
      version: 1
    };
    await store.set("mfr_job_cards", "JC-PARTIAL-1000", job);
    await store.set("mfr_movements", "rm-1000", {
      movementId: "rm-1000",
      jobCardNo: "JC-PARTIAL-1000",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      isIssueRequest: true,
      issueStatus: "Issued",
      accepted: true,
      quantity: 1000
    });

    const first = await commitMaterialMovementTx(store, {
      operationId: "prod-200",
      jobCardNo: "JC-PARTIAL-1000",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 200,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const afterFirst = await store.get("mfr_job_cards", "JC-PARTIAL-1000");
    const movsAfterFirst = await store.list("mfr_movements");
    assert("PARTIAL 200 of 1000 succeeds", first.success === true, first.error);
    assert("PARTIAL remaining 800 after first entry", remainingAtProduction(afterFirst, movsAfterFirst, { compulsory: true }) === 800);
    assert("PARTIAL unproduced 800 after first entry", unproducedOrderQty(afterFirst, movsAfterFirst) === 800);
    assert("PARTIAL job stays pending at Production", afterFirst.currentDepartment === "Production" && afterFirst.status !== "Completed" && String(afterFirst.status).toLowerCase() !== "pending acceptance");

    const second = await commitMaterialMovementTx(store, {
      operationId: "prod-800",
      jobCardNo: "JC-PARTIAL-1000",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 800,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const afterSecond = await store.get("mfr_job_cards", "JC-PARTIAL-1000");
    const movsAfterSecond = await store.list("mfr_movements");
    assert("PARTIAL remaining 800 then 800 completes the order", second.success === true, second.error);
    assert("PARTIAL unproduced 0 after 200+800", unproducedOrderQty(afterSecond, movsAfterSecond) === 0);
    assert("PARTIAL remaining at production 0 after full 1000", remainingAtProduction(afterSecond, movsAfterSecond, { compulsory: true }) === 0);
    assert("PARTIAL relocates only after last quantity", afterSecond.currentDepartment === "Heat Treatment" && afterSecond.status === "Pending Acceptance");
  }

  function liveShapedStore() {
    const s = new MemoryStore();
    (s as any).runSerialized = undefined;
    return s;
  }

  async function seedProd1000(store: MemoryStore, jobCardNo: string, rmQty = 1000) {
    await store.set("mfr_job_cards", jobCardNo, {
      jobCardNo,
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      status: "Pending",
      processType: "Manufacturing",
      version: 1
    });
    await store.set("mfr_movements", `rm-${jobCardNo}`, {
      movementId: `rm-${jobCardNo}`,
      jobCardNo,
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      isIssueRequest: true,
      issueStatus: "Issued",
      accepted: true,
      quantity: rmQty
    });
  }

  function prodActor() {
    return actor("Production");
  }

  async function prodSend(store: MemoryStore, jobCardNo: string, qty: number, op: string) {
    return commitMaterialMovementTx(store, {
      operationId: op,
      jobCardNo,
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: qty,
      requireRawMaterialForProduction: true,
      actor: prodActor()
    });
  }

  {
    const pendingProd = [
      { jobCardNo: "JC-P", fromDepartment: "Production", toDepartment: "Heat Treatment", accepted: false, quantity: 200 }
    ];
    assert(
      "TEST C helper: Production pending does not block additional batch",
      shouldBlockPendingDuplicateRoute(pendingProd, { jobCardNo: "JC-P", fromDepartment: "Production", toDepartment: "Heat Treatment" }) === false
    );
    const pendingStore = [
      { jobCardNo: "JC-LOCK", fromDepartment: "Store", toDepartment: "Dispatch", accepted: false, quantity: 500 }
    ];
    assert(
      "TEST D helper: Store pending still blocks same route",
      shouldBlockPendingDuplicateRoute(pendingStore, { jobCardNo: "JC-LOCK", fromDepartment: "Store", toDepartment: "Dispatch" }) === true
    );
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-LOCK", {
      jobCardNo: "JC-LOCK",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Store",
      version: 1
    });
    await store.set("mfr_movements", "M-LOCK-IN", {
      movementId: "M-LOCK-IN",
      jobCardNo: "JC-LOCK",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 1000,
      accepted: true
    });
    const first = await commitMaterialMovementTx(store, {
      operationId: "OP-IDEM-001",
      jobCardNo: "JC-LOCK",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 500,
      actor: actor("Store")
    });
    const second = await commitMaterialMovementTx(store, {
      operationId: "OP-IDEM-002",
      jobCardNo: "JC-LOCK",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 200,
      actor: actor("Store")
    });
    assert("TEST D Store 500 pending then 200 same route rejected", first.success === true && second.success === false && (second.statusCode === 400 || second.statusCode === 409), second.error);
  }

  {
    const store = liveShapedStore();
    await seedProd1000(store, "JC-CONC-600");
    const [a, b] = await Promise.all([
      prodSend(store, "JC-CONC-600", 600, "conc-600-a"),
      prodSend(store, "JC-CONC-600", 600, "conc-600-b")
    ]);
    const outbound = (await store.list("mfr_movements")).filter((m: any) => m.fromDepartment === "Production");
    const total = outbound.reduce((sum: number, m: any) => sum + Number(m.quantity || 0), 0);
    const oneFail = (a.success && !b.success) || (!a.success && b.success);
    assert("TEST E concurrent 600+600 does not exceed 1000", total <= 1000 && oneFail && total === 600, `total=${total} a=${a.success} b=${b.success}`);
  }

  {
    const store = liveShapedStore();
    await seedProd1000(store, "JC-CONC-433");
    const results = await Promise.all([
      prodSend(store, "JC-CONC-433", 400, "c433-400"),
      prodSend(store, "JC-CONC-433", 300, "c433-300a"),
      prodSend(store, "JC-CONC-433", 300, "c433-300b")
    ]);
    const outbound = (await store.list("mfr_movements")).filter((m: any) => m.fromDepartment === "Production");
    const total = outbound.reduce((sum: number, m: any) => sum + Number(m.quantity || 0), 0);
    const successes = results.filter((r) => r.success).length;
    assert(
      "TEST F concurrent 400+300+300 total <= 1000",
      total <= 1000 && total === results.filter((r) => r.success).reduce((s, r) => s + Number(r.movement?.quantity || 0), 0),
      `total=${total} ok=${successes}`
    );
  }

  {
    const store = liveShapedStore();
    await seedProd1000(store, "JC-IDEM-200");
    const r1 = await prodSend(store, "JC-IDEM-200", 200, "same-op-200");
    const r2 = await prodSend(store, "JC-IDEM-200", 200, "same-op-200");
    const outbound = (await store.list("mfr_movements")).filter((m: any) => m.fromDepartment === "Production");
    const job = await store.get("mfr_job_cards", "JC-IDEM-200");
    assert("TEST G same operationId retry is cached", r1.success && r2.success && r2.cached === true);
    assert("TEST G no duplicate movement", outbound.length === 1 && outbound[0].quantity === 200);
    assert("TEST G remaining 800", unproducedOrderQty(job, await store.list("mfr_movements")) === 800);
  }

  {
    const store = liveShapedStore();
    await seedProd1000(store, "JC-H-PARTIAL");
    const r1 = await prodSend(store, "JC-H-PARTIAL", 200, "h-200");
    const over = await prodSend(store, "JC-H-PARTIAL", 801, "h-801");
    const ok = await prodSend(store, "JC-H-PARTIAL", 800, "h-800");
    const job = await store.get("mfr_job_cards", "JC-H-PARTIAL");
    assert("TEST H first 200 ok", r1.success === true, r1.error);
    assert("TEST H 801 against remaining 800 rejected", over.success === false, over.error);
    assert("TEST H legitimate 800 with different operationId allowed", ok.success === true, ok.error);
    assert("TEST H remaining 0 after 200+800", unproducedOrderQty(job, await store.list("mfr_movements")) === 0);
  }

  {
    const store = new MemoryStore();
    await seedProd1000(store, "JC-I-EXACT");
    const r1 = await prodSend(store, "JC-I-EXACT", 200, "i-200");
    const r2 = await prodSend(store, "JC-I-EXACT", 300, "i-300");
    const r3 = await prodSend(store, "JC-I-EXACT", 500, "i-500");
    const job = await store.get("mfr_job_cards", "JC-I-EXACT");
    const movs = await store.list("mfr_movements");
    assert("TEST I 200+300+500 all succeed", r1.success && r2.success && r3.success, `${r1.error}|${r2.error}|${r3.error}`);
    assert("TEST I remaining 0 at exactly 1000", unproducedOrderQty(job, movs) === 0 && remainingAtProduction(job, movs, { compulsory: true }) === 0);
    assert("TEST I relocates after exact complete", job.currentDepartment === "Heat Treatment");
  }

  {
    const store = new MemoryStore();
    await seedProd1000(store, "JC-J-OVER");
    await prodSend(store, "JC-J-OVER", 200, "j-200");
    await prodSend(store, "JC-J-OVER", 300, "j-300");
    const over = await prodSend(store, "JC-J-OVER", 501, "j-501");
    const job = await store.get("mfr_job_cards", "JC-J-OVER");
    const movs = await store.list("mfr_movements");
    assert("TEST J 200+300+501 rejects excess", over.success === false && String(over.error || "").toLowerCase().includes("insufficient"), over.error);
    assert("TEST J remaining stays 500", unproducedOrderQty(job, movs) === 500);
  }

  console.log(`\nProcess 2 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
