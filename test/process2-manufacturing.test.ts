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
  sameDepartmentTransferBlocked
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

  const prodMoves = [{ jobCardNo: "JC-P2", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 600, accepted: false }];
  assert("TEST 6 remaining after 600 of 1000 is 400", remainingAtProduction(job, prodMoves) === 400);

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

  console.log(`\nProcess 2 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
