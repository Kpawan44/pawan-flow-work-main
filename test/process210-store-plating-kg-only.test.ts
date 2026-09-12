import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  assertStoreToPlatingKgOnly,
  assertStoreProcessTransferUnit,
  isStoreToPlatingUnitRoute,
  STORE_PLATING_KG_ONLY_ERROR,
  STORE_PLATING_KG_REQUIRED_ERROR
} from "../src/hardening/storePlatingKgOnly";
import {
  finalizePackingBagLines,
  packingDetailsFromBagLines
} from "../src/hardening/packingBagLines";

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

function actor(dept: string, extra: Partial<{ role: string; allowedDepartments: string[] }> = {}) {
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: extra.role || "staff",
    department: dept,
    allowedDepartments: extra.allowedDepartments || [dept],
    accessList: extra.allowedDepartments || [dept]
  };
}

async function seedStoreJob(store: MemoryStore, qty = 1000) {
  await store.set("mfr_job_cards", "JC-210", {
    jobCardNo: "JC-210",
    orderQty: qty,
    currentQty: qty,
    currentDepartment: "Store",
    status: "In Process",
    unit: "PCS",
    itemName: "Bolt",
    itemCode: "BLT-210",
    version: 1
  });
}

async function run() {
  assert("route helper Store → Plating", isStoreToPlatingUnitRoute("Store", "Plating"));
  assert("route helper Storehouse → Plating Unit", isStoreToPlatingUnitRoute("Storehouse", "Plating Unit"));
  assert("route helper ignores Raw Material Store → Plating", isStoreToPlatingUnitRoute("Raw Material Store", "Plating") === false);
  assert("route helper ignores Store → Dispatch", isStoreToPlatingUnitRoute("Store", "Dispatch") === false);
  assert("route helper ignores Store → Packing", isStoreToPlatingUnitRoute("Store", "Packing") === false);

  const pcs = assertStoreToPlatingKgOnly({ fromDepartment: "Store", toDepartment: "Plating", unit: "PCS" });
  assert("helper rejects PCS", pcs.ok === false && pcs.ok === false && String((pcs as any).error).includes("KG"));
  const missing = assertStoreToPlatingKgOnly({ fromDepartment: "Store", toDepartment: "Plating Unit" });
  assert("helper rejects missing unit", missing.ok === false && (missing as any).error === STORE_PLATING_KG_REQUIRED_ERROR);
  const kg = assertStoreToPlatingKgOnly({ fromDepartment: "Store", toDepartment: "Plating", unit: "KG" });
  assert("helper accepts KG", kg.ok === true && kg.ok && kg.unit === "KGS");
  const kgs = assertStoreToPlatingKgOnly({ fromDepartment: "Store", toDepartment: "Plating", requestedUnit: "KGS" });
  assert("helper accepts KGS", kgs.ok === true);

  const replatingPcs = assertStoreProcessTransferUnit({ toProcess: "Replating", unit: "PCS" });
  assert("process Replating rejects PCS", replatingPcs.ok === false);
  const repackPcs = assertStoreProcessTransferUnit({ toProcess: "Repacking", unit: "PCS" });
  assert("process Repacking still allows PCS", repackPcs.ok === true && (repackPcs as any).unit === "PCS");

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const ok = await commitMaterialMovementTx(store, {
      operationId: "op-210-kg",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("1 Store → Plating valid KG succeeds", ok.success === true && ok.movement?.unit === "KGS", ok.error);
    assert("1 recorded quantity is 200 KG", ok.movement?.quantity === 200);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const bad = await commitMaterialMovementTx(store, {
      operationId: "op-210-pcs",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      unit: "PCS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("2 Store → Plating PCS rejected server-side", bad.success === false && bad.statusCode === 400, bad.error);
    assert("2 PCS error is client-safe KG rule", String(bad.error || "").includes("KG"));
    assert("2 error constant used", String(bad.error) === STORE_PLATING_KG_ONLY_ERROR);
    const moves = await store.list("mfr_movements");
    assert("2 no ledger movement created for PCS", moves.length === 0);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const bad = await commitMaterialMovementTx(store, {
      operationId: "op-210-missing",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 200,
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("3 missing unit rejected (does not inherit job PCS)", bad.success === false && bad.statusCode === 400, bad.error);
    assert("3 missing-unit message", String(bad.error) === STORE_PLATING_KG_REQUIRED_ERROR);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 100);
    await store.set("mfr_movements", "M-IN", {
      movementId: "M-IN",
      jobCardNo: "JC-210",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 100,
      accepted: true,
      unit: "KGS"
    });
    const over = await commitMaterialMovementTx(store, {
      operationId: "op-210-over",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 250,
      unit: "KG",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("4 KG exceeding available KG rejected", over.success === false && over.statusCode === 400, over.error);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const first = await commitMaterialMovementTx(store, {
      operationId: "op-210-idemp",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 150,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    const retry = await commitMaterialMovementTx(store, {
      operationId: "op-210-idemp",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 150,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("5 same operationId retry is idempotent", first.success && retry.success && retry.cached === true);
    const moves = await store.list("mfr_movements");
    assert("5 one movement after retry", moves.length === 1);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 200);
    await store.set("mfr_movements", "M-IN-200", {
      movementId: "M-IN-200",
      jobCardNo: "JC-210",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 200,
      accepted: true
    });
    const [a, b] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: "op-210-conc-a",
        jobCardNo: "JC-210",
        fromDepartment: "Store",
        toDepartment: "Plating",
        quantity: 150,
        unit: "KGS",
        requireRawMaterialForProduction: false,
        actor: actor("Store")
      }),
      commitMaterialMovementTx(store, {
        operationId: "op-210-conc-b",
        jobCardNo: "JC-210",
        fromDepartment: "Store",
        toDepartment: "Plating",
        quantity: 150,
        unit: "KGS",
        requireRawMaterialForProduction: false,
        actor: actor("Store")
      })
    ]);
    const ok = [a, b].filter((r) => r.success);
    const rejected = [a, b].filter((r) => !r.success);
    const moves = await store.list("mfr_movements").then((rows) => rows.filter((m) => m.fromDepartment === "Store"));
    const total = moves.reduce((s, m) => s + Number(m.quantity || 0), 0);
    assert("6 concurrent 150+150 cannot over-allocate 200", ok.length === 1 && rejected.length === 1 && total <= 200, `ok=${ok.length} rej=${rejected.length} total=${total}`);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const forbidden = await commitMaterialMovementTx(store, {
      operationId: "op-210-rbac",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 50,
      unit: "KGS",
      requireRawMaterialForProduction: false,
      actor: actor("Packing")
    });
    assert("7 unauthorized department movement forbidden", forbidden.success === false && forbidden.statusCode === 403, forbidden.error);
  }

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const dispatch = await commitMaterialMovementTx(store, {
      operationId: "op-210-dispatch-pcs",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 10,
      unit: "PCS",
      extra: { unit: "PCS" },
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("unrelated Store → Dispatch with PCS still allowed", dispatch.success === true, dispatch.error);
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-HT", {
      jobCardNo: "JC-HT",
      orderQty: 100,
      currentQty: 100,
      currentDepartment: "Heat Treatment",
      status: "In Process",
      unit: "PCS",
      version: 1
    });
    const ht = await commitMaterialMovementTx(store, {
      operationId: "op-210-ht-plating",
      jobCardNo: "JC-HT",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 40,
      extra: { unit: "PCS" },
      requireRawMaterialForProduction: false,
      actor: actor("Heat Treatment")
    });
    assert("HT → Plating is not forced to KG-only", ht.success === true, ht.error);
  }

  const single = finalizePackingBagLines([{ bags: 5, pcsPerBag: 100 }], 5000);
  assert("8/9 single-size packing still works", single.ok === true && single.ok && single.grandTotal === 500);

  const mixed = finalizePackingBagLines(
    [
      { bags: 6000, pcsPerBag: 2 },
      { bags: 5000, pcsPerBag: 1 },
      { bags: 2500, pcsPerBag: 1 }
    ],
    19500
  );
  assert("10 mixed-bag 6000×2 + 5000×1 + 2500×1 = 19500", mixed.ok === true && mixed.ok && mixed.grandTotal === 19500);
  assert("10 mixed bag count 13500 bags across sizes", mixed.ok && mixed.boxCount === 13500);
  const rollup = packingDetailsFromBagLines(mixed as any);
  assert("10 rollup totalPcs preserved for print/QR", rollup.totalPcs === 19500 && rollup.bagLines.length === 3);

  const setPack = finalizePackingBagLines([{ bags: 10, pcsPerBag: 50 }], 1000);
  assert("11 Set Packing Bags × PCS still works", setPack.ok === true && setPack.ok && setPack.grandTotal === 500);

  {
    const store = new MemoryStore();
    await seedStoreJob(store, 1000);
    const ok = await commitMaterialMovementTx(store, {
      operationId: "op-210-alias",
      jobCardNo: "JC-210",
      fromDepartment: "Store",
      toDepartment: "Plating",
      quantity: 25,
      requestedUnit: "kilograms",
      requireRawMaterialForProduction: false,
      actor: actor("Store")
    });
    assert("KG alias kilograms accepted", ok.success === true && ok.movement?.unit === "KGS", ok.error);
  }

  console.log(`\nProcess 210: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
