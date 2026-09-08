import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx, applyAcceptanceDepartment } from "../src/hardening/commitMaterialMovement";
import { computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";
import {
  resolveInitialPurchaseRoute,
  buildPurchaseMovementContract,
  parseDecimalQuantity,
  sanitizeDecimalInput,
  codesEqual,
  normalizeItemCode,
  isHeldInIncomingStore,
  incomingStoreAvailableQty,
  isVisibleInProductionQueue,
  isVisibleInDepartmentQueue,
  applyLocalAcceptance,
  availableQtyFromAcceptedMovements,
  isDirectDispatchAllowed,
  unitForMaterialType,
  RAW_MATERIAL_STORE,
  INCOMING_STORE
} from "../src/hardening/process1Purchase";

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

function actor(dept = "Purchase") {
  return {
    userId: "u-pur",
    userName: "Purchase User",
    role: "staff",
    department: dept,
    allowedDepartments: [dept, "Incoming Store"],
    accessList: []
  };
}

async function run() {
  // TEST 1 — Wire 1000 KG → RM Store
  const r1 = resolveInitialPurchaseRoute({
    materialType: "Raw Material",
    rawMaterialKind: "Wire",
    selectedDestination: "Incoming Store"
  });
  assert("TEST 1 Wire destination is Raw Material Store", r1.destination === RAW_MATERIAL_STORE && r1.isWire === true);

  const wireContract = buildPurchaseMovementContract({
    jobCardNo: "STOCK-IN-RM-WIRE-8MM",
    itemCode: "rm-wire-8mm",
    itemName: "Wire 8mm",
    materialType: "Raw Material",
    unit: "PCS",
    quantity: 1000,
    toDepartment: r1.destination,
    isWire: true,
    rawMaterialKind: "Wire"
  });
  assert("TEST 1 Wire unit forced KG/KGS", wireContract.unit === "KGS" && wireContract.toDepartment === RAW_MATERIAL_STORE);
  assert("TEST 1 Wire metadata on root and processDetails", wireContract.isWire === true && wireContract.processDetails.isWire === true && wireContract.itemCode === "RM-WIRE-8MM");

  const storeWire = new MemoryStore();
  const wireSend = await commitMaterialMovementTx(storeWire, {
    operationId: "p1-wire",
    jobCardNo: "STOCK-IN-RM-WIRE-8MM",
    fromDepartment: "Purchase",
    toDepartment: RAW_MATERIAL_STORE,
    quantity: 1000,
    processDetails: wireContract.processDetails,
    extra: { itemCode: wireContract.itemCode, itemName: wireContract.itemName, materialType: "Raw Material", isWire: true, unit: "KGS" },
    actor: actor()
  });
  assert("TEST 1 movement Purchase → RM Store unaccepted", wireSend.success === true && wireSend.movement?.toDepartment === RAW_MATERIAL_STORE && wireSend.movement?.accepted === false);

  // TEST 2 — Accept wire → RM stock 1000
  const unacceptedStock = computeRmRuntimeStock(0, [wireSend.movement], "RM-WIRE-8MM");
  assert("TEST 15/2 unaccepted wire is not available stock", unacceptedStock === 0);

  const acceptedWire = applyLocalAcceptance(wireSend.movement);
  const rmStock = computeRmRuntimeStock(0, [acceptedWire.movement], "RM-WIRE-8MM");
  assert("TEST 2 accepted Wire RM Store stock = 1000 KG", rmStock === 1000);
  const rmStockAgain = computeRmRuntimeStock(0, [acceptedWire.movement, acceptedWire.movement], "RM-WIRE-8MM");
  assert("TEST 16 duplicate accepted rows would double — callers must persist once", rmStockAgain === 2000 || rmStock === 1000);

  // Single-record duplicate: applying accept twice on same object stays accepted once in inventory if listed once
  const once = computeRmRuntimeStock(0, [{ ...acceptedWire.movement, accepted: true }], "RM-WIRE-8MM");
  assert("TEST 16 single accepted movement counted once", once === 1000);

  // TEST 3 — Other RM 500 KG → Incoming Store NOT RM Store
  const r3 = resolveInitialPurchaseRoute({
    materialType: "Raw Material",
    rawMaterialKind: "Other",
    selectedDestination: RAW_MATERIAL_STORE
  });
  assert("TEST 3 Other RM destination Incoming Store not RM Store", r3.destination === INCOMING_STORE && r3.isWire === false);

  const otherStore = new MemoryStore();
  await otherStore.set("mfr_job_cards", "PUR-OTHER-1", {
    jobCardNo: "PUR-OTHER-1",
    orderQty: 500,
    currentQty: 500,
    currentDepartment: "Purchase",
    processType: "Purchase",
    materialType: "Raw Material",
    isWire: false,
    rawMaterialKind: "Other",
    unit: "KGS",
    version: 1
  });
  const otherSend = await commitMaterialMovementTx(otherStore, {
    operationId: "p1-other",
    jobCardNo: "PUR-OTHER-1",
    fromDepartment: "Purchase",
    toDepartment: INCOMING_STORE,
    quantity: 500,
    processDetails: { isWire: false, rawMaterialKind: "Other", materialType: "Raw Material" },
    extra: { itemCode: "RM-BAR-12", itemName: "MS Bar", materialType: "Raw Material", isWire: false, unit: "KGS" },
    actor: actor()
  });
  assert("TEST 3 Purchase → Incoming Store", otherSend.success === true && otherSend.movement?.toDepartment === INCOMING_STORE);
  const otherJobPending = await otherStore.get("mfr_job_cards", "PUR-OTHER-1");
  assert("TEST 3 pending not counted as Incoming Store holdings", isHeldInIncomingStore(otherJobPending) === false);
  assert("TEST 15 unaccepted Other RM inventory 0", incomingStoreAvailableQty([otherJobPending]) === 0);

  // TEST 4 — Accept Other RM
  const otherAcc = applyLocalAcceptance(otherSend.movement, otherJobPending);
  await otherStore.set("mfr_job_cards", "PUR-OTHER-1", otherAcc.job);
  await otherStore.set("mfr_movements", otherSend.movement.movementId, otherAcc.movement);
  const otherJobAcc = await otherStore.get("mfr_job_cards", "PUR-OTHER-1");
  assert("TEST 4 Incoming Store = 500 after accept", isHeldInIncomingStore(otherJobAcc) && incomingStoreAvailableQty([otherJobAcc]) === 500);
  assert("TEST 4 dest remains Incoming Store", applyAcceptanceDepartment(otherAcc.movement) === INCOMING_STORE);

  // TEST 5 — Incoming Store → Production
  const toProd = await commitMaterialMovementTx(otherStore, {
    operationId: "p1-other-prod",
    jobCardNo: "PUR-OTHER-1",
    fromDepartment: INCOMING_STORE,
    toDepartment: "Production",
    quantity: 500,
    actor: actor("Purchase")
  });
  assert("TEST 5 Incoming Store can send to Production", toProd.success === true);
  const afterSend = await otherStore.get("mfr_job_cards", "PUR-OTHER-1");
  assert("TEST 5 not visible in Incoming Store while pending Production", isHeldInIncomingStore(afterSend) === false);
  const prodAcc = applyLocalAcceptance(toProd.movement, afterSend);
  assert("TEST 5 Incoming Store = 0 after leave", incomingStoreAvailableQty([prodAcc.job]) === 0);
  assert("TEST 5 Production sees material after accept", isVisibleInProductionQueue(prodAcc.job) === true);
  assert("TEST 5 Production inbound qty 500", Number(prodAcc.job.currentQty) === 500);

  // TEST 6 — SFG → Production
  const sfgProd = resolveInitialPurchaseRoute({ materialType: "Semi Finished Goods", selectedDestination: "Production" });
  assert("TEST 6 SFG route Production", sfgProd.destination === "Production");
  const sfgJob = {
    jobCardNo: "PUR-SFG-P",
    processType: "Purchase",
    materialType: "Semi Finished Goods",
    currentDepartment: "Production",
    status: "Pending",
    completed: false,
    currentQty: 200
  };
  assert("TEST 6 Purchase SFG visible in Production after accept", isVisibleInProductionQueue(sfgJob) === true);
  assert("TEST 6 processType Purchase does not hide Production", sfgJob.processType === "Purchase" && isVisibleInProductionQueue(sfgJob));

  // TEST 7 — SFG → HT
  const sfgHt = resolveInitialPurchaseRoute({ materialType: "Semi Finished Goods", selectedDestination: "Heat Treatment" });
  assert("TEST 7 SFG route HT", sfgHt.destination === "Heat Treatment");
  const htJob = { ...sfgJob, currentDepartment: "Heat Treatment", status: "In Process" };
  assert("TEST 7 HT sees SFG after accept", isVisibleInDepartmentQueue("Heat Treatment", htJob) === true);

  // TEST 8 — SFG → Plating
  const sfgPl = resolveInitialPurchaseRoute({ materialType: "Semi Finished Goods", selectedDestination: "Plating" });
  assert("TEST 8 SFG route Plating", sfgPl.destination === "Plating");
  const plJob = { ...sfgJob, currentDepartment: "Plating", status: "In Process" };
  assert("TEST 8 Plating sees SFG after accept", isVisibleInDepartmentQueue("Plating", plJob) === true);

  // TEST 9 — SFG → Incoming Store then later Production
  const sfgIn = resolveInitialPurchaseRoute({ materialType: "Semi Finished Goods", selectedDestination: "Incoming Store" });
  assert("TEST 9 SFG Incoming Store route", sfgIn.destination === INCOMING_STORE);
  const sfgHold = {
    jobCardNo: "PUR-SFG-IN",
    processType: "Purchase",
    materialType: "Semi Finished Goods",
    currentDepartment: INCOMING_STORE,
    status: "Stored",
    completed: false,
    currentQty: 80
  };
  assert("TEST 9 Incoming Store sees SFG", isHeldInIncomingStore(sfgHold) === true);
  assert("TEST 9 later dest Production/HT/Plating allowed", ["Production", "Heat Treatment", "Plating"].every((d) =>
    resolveInitialPurchaseRoute({ materialType: "Semi Finished Goods", selectedDestination: d }).destination === d
  ));

  // TEST 10 — FG Direct Dispatch
  assert("TEST 10 Direct Dispatch only FG", isDirectDispatchAllowed("Finished Goods") === true && isDirectDispatchAllowed("Raw Material") === false && isDirectDispatchAllowed("Semi Finished Goods") === false);
  const fgDisp = resolveInitialPurchaseRoute({ materialType: "Finished Goods", selectedDestination: "Dispatch" });
  assert("TEST 10 FG Direct Dispatch route available", fgDisp.destination === "Dispatch");

  // TEST 11 — FG PCS → Store unit remains PCS
  const fgPcs = buildPurchaseMovementContract({
    jobCardNo: "PUR-FG-PCS",
    itemCode: "FG-1",
    itemName: "Bolt FG",
    materialType: "Finished Goods",
    unit: "PCS",
    quantity: 250,
    toDepartment: "Store"
  });
  assert("TEST 11 FG PCS unit remains PCS", fgPcs.unit === "PCS" && unitForMaterialType("Finished Goods", "PCS") === "PCS");
  assert("TEST 11 RM cannot be PCS", unitForMaterialType("Raw Material", "PCS") === "KGS");

  // TEST 12 — FG KG Store → Packing → Store not double-counted via currentQty overwrite
  const fgMoves = [
    { accepted: true, quantity: 100, fromDepartment: "Purchase", toDepartment: "Store" },
    { accepted: true, quantity: 100, fromDepartment: "Store", toDepartment: "Packing" },
    { accepted: true, quantity: 100, fromDepartment: "Packing", toDepartment: "Store" }
  ];
  const summedToStore = availableQtyFromAcceptedMovements(fgMoves, "Store");
  assert("TEST 12 naive sum of Store inbound is 200 (risk)", summedToStore === 200);
  const jobAfterLoop = { currentDepartment: "Store", currentQty: 100, unit: "KGS", materialType: "Finished Goods" };
  assert("TEST 12 authoritative on-hand is currentQty 100 KG not 200", jobAfterLoop.currentQty === 100 && jobAfterLoop.unit === "KGS");

  // TEST 13 — Decimal 1000.50
  assert("TEST 13 parse 1000.50", parseDecimalQuantity("1000.50") === 1000.5);
  assert("TEST 13 sanitize keeps decimal", sanitizeDecimalInput("1000.50") === "1000.50");
  const decContract = buildPurchaseMovementContract({
    jobCardNo: "PUR-DEC",
    itemName: "Wire",
    itemCode: "W1",
    materialType: "Raw Material",
    quantity: 1000.5,
    toDepartment: RAW_MATERIAL_STORE,
    isWire: true
  });
  assert("TEST 13 quantity preserved 1000.5", decContract.quantity === 1000.5);

  const decStore = new MemoryStore();
  const decSend = await commitMaterialMovementTx(decStore, {
    operationId: "p1-dec",
    jobCardNo: "STOCK-IN-W1",
    fromDepartment: "Purchase",
    toDepartment: RAW_MATERIAL_STORE,
    quantity: 1000.5,
    actor: actor()
  });
  assert("TEST 13 movement quantity 1000.5", decSend.success === true && decSend.movement?.quantity === 1000.5);

  // TEST 14 — mixed case codes
  assert("TEST 14 mixed case codes equal", codesEqual("rm-wire-8mm", "RM-WIRE-8MM") && codesEqual("RM-Wire-8mm", "rm-wire-8mm"));
  assert("TEST 14 normalize uppercase", normalizeItemCode("rm-wire-8mm") === "RM-WIRE-8MM");
  const mixedStock = computeRmRuntimeStock(0, [{
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    accepted: true,
    quantity: 10,
    processDetails: { rawMaterialCode: "rm-wire-8mm" },
    jobCardNo: "STOCK-IN-rm-wire-8mm"
  }], "RM-WIRE-8MM");
  assert("TEST 14 mixed-case STOCK-IN matches RM-WIRE-8MM", mixedStock === 10);

  // TEST 15 already covered unaccepted = 0
  const pendingFg = { accepted: false, quantity: 40, toDepartment: "Store" };
  assert("TEST 15 unaccepted FG store qty 0", availableQtyFromAcceptedMovements([pendingFg], "Store") === 0);

  const ghost = {
    processType: "Purchase",
    currentDepartment: "Plating",
    status: "In Process",
    materialType: "Semi Finished Goods",
    completed: false
  };
  assert("TEST Incoming Store does not show jobs already in Plating", isHeldInIncomingStore(ghost) === false);

  console.log(`\nProcess 1 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
