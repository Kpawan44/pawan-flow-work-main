import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx, applyAcceptanceDepartment, isDeptAuthorized } from "../src/hardening/commitMaterialMovement";
import { assertSessionSecretSafe, createSessionToken, verifySessionToken, isValidFourDigitPin, requireUserPin, extractBearerToken } from "../src/hardening/hmacSession";
import { assertProcessTransferTransition } from "../src/hardening/processTransferMachine";
import { isProtectedSuperAdmin, shouldDeleteUserOnFactoryReset, operationalCollectionsForFactoryReset } from "../src/hardening/factoryResetPolicy";
import { INVENTORY_RAW_MATERIALS_SEED, mergeCreateIfMissing, seedToMasterDoc, computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";

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

function actor(overrides: Partial<{ userId: string; userName: string; role: string; department: string; allowedDepartments: string[]; accessList: string[] }> = {}) {
  return {
    userId: "u-prod",
    userName: "Prod User",
    role: "staff",
    department: "Production",
    allowedDepartments: ["Production"],
    accessList: [],
    ...overrides
  };
}

async function seedJob(store: MemoryStore, qty = 100) {
  await store.set("mfr_job_cards", "JC-1001", {
    jobCardNo: "JC-1001",
    orderQty: qty,
    currentQty: qty,
    currentDepartment: "Production",
    status: "In Process",
    version: 1
  });
}

async function run() {
  const store = new MemoryStore();
  await seedJob(store);

  const a = actor();
  const r1 = await commitMaterialMovementTx(store, {
    operationId: "op-1",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Heat Treatment",
    quantity: 10,
    actor: a
  });
  assert("1 concurrent first movement succeeds", r1.success === true && r1.movement?.accepted === false);
  assert("job pending acceptance at destination", r1.updatedJobCard?.status === "Pending Acceptance" && r1.updatedJobCard?.currentDepartment === "Heat Treatment");
  assert("does not decrement currentQty on send", r1.updatedJobCard?.currentQty === 100);

  const r1b = await commitMaterialMovementTx(store, {
    operationId: "op-1",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Heat Treatment",
    quantity: 10,
    actor: a
  });
  assert("2 duplicate operationId returns cached original", r1b.cached === true && r1b.movement?.movementId === r1.movement?.movementId);

  const rDupPending = await commitMaterialMovementTx(store, {
    operationId: "op-2",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Heat Treatment",
    quantity: 5,
    actor: a
  });
  assert("duplicate pending same route rejected", rDupPending.success === false);

  const store2 = new MemoryStore();
  await seedJob(store2, 20);
  const rInsuf = await commitMaterialMovementTx(store2, {
    operationId: "op-insuf",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Plating",
    quantity: 50,
    actor: a
  });
  assert("3 insufficient quantity rejected", rInsuf.success === false && (rInsuf.error || "").toLowerCase().includes("insufficient"));

  const purchaseStore = new MemoryStore();
  await purchaseStore.set("mfr_job_cards", "PUR-1002", {
    jobCardNo: "PUR-1002",
    orderQty: 80,
    currentQty: 80,
    currentDepartment: "Purchase",
    processType: "Purchase",
    version: 1
  });
  const rRm = await commitMaterialMovementTx(purchaseStore, {
    operationId: "op-pur-rm",
    jobCardNo: "PUR-1002",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 80,
    actor: actor({ department: "Purchase", allowedDepartments: ["Purchase"], userId: "u-pur" })
  });
  assert("4 Purchase → Raw Material Store dest authoritative", rRm.updatedJobCard?.currentDepartment === "Raw Material Store");
  assert("accept helper keeps RM dest", applyAcceptanceDepartment(rRm.movement) === "Raw Material Store");

  const storeForFg = new MemoryStore();
  await storeForFg.set("mfr_job_cards", "PUR-1003", {
    jobCardNo: "PUR-1003",
    orderQty: 40,
    currentQty: 40,
    currentDepartment: "Purchase",
    processType: "Purchase",
    version: 1
  });
  const rStore = await commitMaterialMovementTx(storeForFg, {
    operationId: "op-pur-store",
    jobCardNo: "PUR-1003",
    fromDepartment: "Purchase",
    toDepartment: "Store",
    quantity: 10,
    actor: actor({ department: "Purchase", allowedDepartments: ["Purchase"], userId: "u-pur" })
  });
  // pending dup? from purchase to store is different from RM so OK unless first still pending from same from-to
  assert("5 Purchase → Store dest authoritative", rStore.success && rStore.updatedJobCard?.currentDepartment === "Store");

  const rUnauth = await commitMaterialMovementTx(store2, {
    operationId: "op-unauth",
    jobCardNo: "JC-1001",
    fromDepartment: "Purchase",
    toDepartment: "Store",
    quantity: 1,
    actor: a
  });
  assert("6 unauthorized department movement", rUnauth.statusCode === 403);

  const rStock = await commitMaterialMovementTx(new MemoryStore(), {
    operationId: "op-stock",
    jobCardNo: "STOCK-IN-EN8-R",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 50,
    actor: actor({ department: "Purchase", allowedDepartments: ["Purchase"] })
  });
  assert("7 STOCK-IN without job card", rStock.success === true && !rStock.updatedJobCard);

  const issueStore = new MemoryStore();
  await issueStore.set("mfr_job_cards", "JC-1001", {
    jobCardNo: "JC-1001",
    currentDepartment: "Production",
    currentQty: 100,
    orderQty: 100,
    version: 1
  });
  const rIssue = await commitMaterialMovementTx(issueStore, {
    operationId: "op-issue",
    jobCardNo: "JC-1001",
    fromDepartment: "Raw Material Store",
    toDepartment: "Production",
    quantity: 12,
    isIssueRequest: true,
    requestedQty: 12,
    actor: actor({ department: "Raw Material Store", allowedDepartments: ["Raw Material Store"] })
  });
  const jobAfterIssue = await issueStore.get("mfr_job_cards", "JC-1001");
  assert("8 issue request does not change department", rIssue.success && jobAfterIssue.currentDepartment === "Production");

  const rSame = await commitMaterialMovementTx(store2, {
    operationId: "op-same",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Production",
    quantity: 1,
    actor: a
  });
  assert("9 same-department normal transfer rejected", rSame.success === false);

  const rWire = await commitMaterialMovementTx(new MemoryStore(), {
    operationId: "op-wire",
    jobCardNo: "STOCK-IN-EN8-R",
    fromDepartment: "Raw Material Store",
    toDepartment: "Raw Material Store",
    quantity: 3,
    processDetails: { isWireRejection: true },
    actor: actor({ department: "Raw Material Store", allowedDepartments: ["Raw Material Store"] })
  });
  assert("10 wire rejection explicitly allowed", rWire.success === true);

  const t1 = assertProcessTransferTransition("Repacking", "Sent to Repacking", "receive");
  const tSkip = assertProcessTransferTransition("Repacking", "Sent to Repacking", "complete");
  assert("11 process transfer receive from Sent is valid", t1.ok);
  assert("12 process transfer cannot skip to complete", !tSkip.ok);

  assert("13 factory reset preserves super_admin", isProtectedSuperAdmin({ role: "super_admin" }) && !shouldDeleteUserOnFactoryReset({ role: "super_admin" }));
  assert("factory reset deletes staff", shouldDeleteUserOnFactoryReset({ role: "staff" }));
  assert("factory reset does not purge mfr_users wholesale", !operationalCollectionsForFactoryReset().includes("mfr_users"));

  const secret = "unit-test-secret-please-change";
  const token = createSessionToken(secret, "u-1", "gen-a", 60_000);
  const ok = verifySessionToken(secret, token, "gen-a");
  assert("session valid", ok.ok);

  const tampered = token.slice(0, -2) + "xx";
  const bad = verifySessionToken(secret, tampered, "gen-a");
  assert("15 tampered HMAC rejected", !bad.ok);

  const expired = createSessionToken(secret, "u-1", "gen-a", -1000);
  const exp = verifySessionToken(secret, expired, "gen-a");
  assert("16 expired HMAC rejected", !exp.ok);

  const oldGen = createSessionToken(secret, "u-1", "gen-old", 60_000);
  const genBad = verifySessionToken(secret, oldGen, "gen-new");
  assert("14 factory reset invalidates old sessions", !genBad.ok);

  assert("17 missing Bearer rejected", extractBearerToken(undefined) === null && extractBearerToken("Basic x") === null && extractBearerToken("Bearer ") === null);
  assert("18 missing PIN rejected", !isValidFourDigitPin("") && !isValidFourDigitPin("12") && !isValidFourDigitPin("abcd"));
  let pinThrew = false;
  try {
    requireUserPin(undefined);
  } catch {
    pinThrew = true;
  }
  let defaultPinAssigned = "1234";
  try {
    requireUserPin("");
  } catch {
    defaultPinAssigned = "";
  }
  assert("19 default PIN 1234 is never automatically assigned", pinThrew && defaultPinAssigned === "");

  const idempStore = new MemoryStore();
  await seedJob(idempStore);
  const first = await commitMaterialMovementTx(idempStore, {
    operationId: "same-op",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Packing",
    quantity: 2,
    actor: a
  });
  const second = await commitMaterialMovementTx(idempStore, {
    operationId: "same-op",
    jobCardNo: "JC-1001",
    fromDepartment: "Production",
    toDepartment: "Packing",
    quantity: 2,
    actor: a
  });
  const movs = await idempStore.list("mfr_movements");
  assert("20 duplicate writes do not create duplicate movements", movs.length === 1 && first.movement.movementId === second.movement.movementId);

  const captured = "2026-01-01T00:00:00.000Z";
  const seed = INVENTORY_RAW_MATERIALS_SEED[0];
  const incoming = seedToMasterDoc(seed, captured);
  const existing = { ...incoming, openingQty: 99999, openingCapturedAt: "2020-01-01T00:00:00.000Z" };
  const merged = mergeCreateIfMissing(existing, { ...incoming, openingQty: 1 });
  assert("21 RM opening balance unchanged after migration", merged.openingQty === 99999 && merged.openingCapturedAt === "2020-01-01T00:00:00.000Z");

  const freshMaster = mergeCreateIfMissing(null, incoming);
  assert("create-if-missing uses seed opening", freshMaster.openingQty === seed.availableStock);

  const stock = computeRmRuntimeStock(100, [
    { fromDepartment: "Purchase", toDepartment: "Raw Material Store", accepted: true, quantity: 50, processDetails: { rawMaterialCode: seed.code } },
    { fromDepartment: "Raw Material Store", toDepartment: "Production", isIssueRequest: true, issueStatus: "Issued", quantity: 20, processDetails: { rawMaterialCode: seed.code } },
    { fromDepartment: "Raw Material Store", issueStatus: "Rejected", quantity: 5, processDetails: { rawMaterialCode: seed.code } }
  ], seed.code);
  assert("22 stock reconciliation 100+50-20-5=125", stock === 125);

  let threw = false;
  try {
    assertSessionSecretSafe(undefined, "production");
  } catch {
    threw = true;
  }
  assert("production refuses missing SESSION_SECRET", threw);

  assert("dept auth admin bypass", isDeptAuthorized(actor({ role: "super_admin", department: "Admin" }), "Packing"));

  const p1 = commitMaterialMovementTx(new MemoryStore(), {
    operationId: "c1",
    jobCardNo: "STOCK-IN-X",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 1,
    actor: actor({ department: "Purchase", allowedDepartments: ["Purchase"] })
  });
  const p2 = commitMaterialMovementTx(new MemoryStore(), {
    operationId: "c2",
    jobCardNo: "STOCK-IN-Y",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 1,
    actor: actor({ department: "Purchase", allowedDepartments: ["Purchase"] })
  });
  const conc = await Promise.all([p1, p2]);
  assert("1b two concurrent independent movements succeed", conc[0].success && conc[1].success);

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
