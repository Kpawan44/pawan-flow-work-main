import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";
import {
  canStartProductionWithRm,
  getAcceptedRawMaterialIssuedQty,
  getTotalAcceptedProductionRawMaterialQty,
  productionSendAvailable,
  unproducedOrderQty
} from "../src/hardening/process2Manufacturing";
import {
  addOtherRawMaterialRow,
  assertOtherRawMaterialIssueInput,
  canIssueOtherRawMaterialQty,
  computeIncomingStoreOtherRmStock,
  getAcceptedOtherRawMaterialIssuedQty,
  netProductionQty,
  otherRawMaterialRowsOptionalValid,
  removeOtherRawMaterialRow,
  totalRawMaterialWeight
} from "../src/hardening/process248OtherRawMaterial";
import { INCOMING_STORE, RAW_MATERIAL_STORE } from "../src/hardening/process1Purchase";

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

function actor(dept: string) {
  const extra = dept === "Purchase" ? ["Incoming Store"] : dept === "Incoming Store" ? ["Purchase"] : [];
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: "staff",
    department: dept,
    allowedDepartments: [dept, ...extra],
    accessList: [dept, ...extra]
  };
}

async function purchaseOtherRm(store: MemoryStore, code: string, name: string, qty: number, op: string, billNo: string) {
  return commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo: `STOCK-IN-${code}`,
    fromDepartment: "Purchase",
    toDepartment: INCOMING_STORE,
    quantity: qty,
    processDetails: {
      rawMaterialCode: code,
      rawMaterialName: name,
      itemCode: code,
      isWire: false,
      rawMaterialKind: "Other",
      materialType: "Raw Material",
      supplierName: "Washer Mill",
      billNo
    },
    extra: { itemCode: code, itemName: name, isWire: false },
    actor: actor("Purchase")
  });
}

async function acceptIncoming(store: MemoryStore, movementId: string, op: string) {
  return acceptMaterialMovementTx(store, {
    operationId: op,
    movementId,
    actor: actor("Purchase")
  });
}

async function purchaseWire(store: MemoryStore, qty: number, op: string, billNo: string) {
  return commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo: "STOCK-IN-RM-WIRE-8MM",
    fromDepartment: "Purchase",
    toDepartment: RAW_MATERIAL_STORE,
    quantity: qty,
    processDetails: {
      rawMaterialCode: "RM-WIRE-8MM",
      itemCode: "RM-WIRE-8MM",
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "Wire Mills",
      billNo
    },
    extra: { itemCode: "RM-WIRE-8MM", itemName: "Wire 8mm", isWire: true },
    actor: actor("Purchase")
  });
}

async function issueWire(store: MemoryStore, jobCardNo: string, qty: number, op: string) {
  const issue = await commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo,
    fromDepartment: RAW_MATERIAL_STORE,
    toDepartment: "Production",
    quantity: qty,
    isIssueRequest: true,
    requestedQty: qty,
    processDetails: { rawMaterialCode: "RM-WIRE-8MM" },
    actor: actor("Raw Material Store")
  });
  if (!issue.success) return issue;
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-issued`,
    movementId: issue.movement.movementId,
    issueStatus: "Issued",
    actor: actor("Raw Material Store")
  });
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-custody`,
    movementId: issue.movement.movementId,
    actor: actor("Production")
  });
  return issue;
}

async function issueOtherRm(store: MemoryStore, jobCardNo: string, code: string, name: string, qty: number, op: string) {
  const issue = await commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo,
    fromDepartment: INCOMING_STORE,
    toDepartment: "Production",
    quantity: qty,
    isIssueRequest: true,
    requestedQty: qty,
    unit: "KGS",
    processDetails: {
      isOtherRawMaterialIssue: true,
      isWire: false,
      rawMaterialKind: "Other",
      rawMaterialCode: code,
      rawMaterialName: name,
      unit: "KG"
    },
    actor: actor("Purchase")
  });
  if (!issue.success) return issue;
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-issued`,
    movementId: issue.movement.movementId,
    issueStatus: "Issued",
    actor: actor("Purchase")
  });
  await acceptMaterialMovementTx(store, {
    operationId: `${op}-custody`,
    movementId: issue.movement.movementId,
    actor: actor("Production")
  });
  return issue;
}

async function seedJob(store: MemoryStore, jobCardNo: string, orderQty = 1000) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty,
    currentQty: orderQty,
    currentDepartment: "Production",
    status: "Pending",
    processType: "Manufacturing",
    itemName: "6x13 MS Double Washer Screw",
    unit: "KGS",
    version: 1
  });
}

async function run() {
  {
    let rows: Array<{ id: string; materialCode: string; quantity: number; unit: string }> = [];
    assert("2 Other RM optional when empty", otherRawMaterialRowsOptionalValid(rows).ok === true);
    assert("8 empty rows do not block wire-only", otherRawMaterialRowsOptionalValid([]).ok === true);
    rows = addOtherRawMaterialRow(rows, { materialCode: "PLAIN-WASHER", quantity: 100, unit: "KG" });
    rows = addOtherRawMaterialRow(rows, { materialCode: "SPRING-WASHER", quantity: 50, unit: "KG" });
    assert("6 multiple additional rows", rows.length === 2);
    rows = addOtherRawMaterialRow(rows, { materialCode: "EXTRA-WASHER", quantity: 10, unit: "KG" });
    assert("6 three additional rows", rows.length === 3);
    rows = removeOtherRawMaterialRow(rows, rows[2].id);
    assert("7 optional row removed", rows.length === 2 && !rows.some((r) => r.materialCode === "EXTRA-WASHER"));
  }

  {
    const total = totalRawMaterialWeight([500, 100, 50]);
    const net = netProductionQty(total, 5);
    assert("17 production total sums all RM", total === 650);
    assert("18 scrap deducted", net === 645);
    assert("19 example 500+100+50-5=645", net === 645);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-WIRE-ONLY");
    const pin = await purchaseWire(store, 1000, "w-in", "INV-W-ONLY");
    await acceptMaterialMovementTx(store, {
      operationId: "w-in-acc",
      movementId: pin.movement.movementId,
      actor: actor("Raw Material Store")
    });
    await issueWire(store, "JC-WIRE-ONLY", 500, "w-iss-500");
    const job = await store.get("mfr_job_cards", "JC-WIRE-ONLY");
    const moves = await store.list("mfr_movements");
    assert("1 wire-only start ok", canStartProductionWithRm(job, moves, { compulsory: true }).ok === true);
    assert("1 wire-only accepted is 500", getAcceptedRawMaterialIssuedQty(job, moves) === 500);
    assert("2 other RM qty is 0", getAcceptedOtherRawMaterialIssuedQty(job, moves) === 0);
    assert("8 wire-only send avail 500", productionSendAvailable(job, moves, { compulsory: true }) === 500);
    const prod = await commitMaterialMovementTx(store, {
      operationId: "w-prod-200",
      jobCardNo: "JC-WIRE-ONLY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 200,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const after = await store.list("mfr_movements");
    assert("1 wire-only production works", prod.success === true, prod.error);
    assert("23 remaining after partial wire-only", unproducedOrderQty(job, after) === 800);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-248");
    const wireIn = await purchaseWire(store, 1000, "248-w", "INV-248-W");
    await acceptMaterialMovementTx(store, {
      operationId: "248-w-acc",
      movementId: wireIn.movement.movementId,
      actor: actor("Raw Material Store")
    });
    const plainIn = await purchaseOtherRm(store, "PLAIN-WASHER", "Plain Washer", 400, "248-pw", "INV-248-PW");
    await acceptIncoming(store, plainIn.movement.movementId, "248-pw-acc");
    const springIn = await purchaseOtherRm(store, "SPRING-WASHER", "Spring Washer", 200, "248-sw", "INV-248-SW");
    await acceptIncoming(store, springIn.movement.movementId, "248-sw-acc");

    let moves = await store.list("mfr_movements");
    assert("10 incoming other RM stock plain 400", computeIncomingStoreOtherRmStock(0, moves, "PLAIN-WASHER") === 400);
    assert("10 incoming other RM stock spring 200", computeIncomingStoreOtherRmStock(0, moves, "SPRING-WASHER") === 200);
    assert("23 wire RM stock untouched", computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 1000);

    await issueWire(store, "JC-248", 500, "248-issue-wire");
    const plainIssue = await issueOtherRm(store, "JC-248", "PLAIN-WASHER", "Plain Washer", 100, "248-issue-pw");
    assert("9 other RM issue created", plainIssue.success === true, plainIssue.error);
    assert("11 linked to job", plainIssue.movement?.jobCardNo === "JC-248");
    assert("11 flagged other RM", plainIssue.movement?.processDetails?.isOtherRawMaterialIssue === true);

    const springIssue = await issueOtherRm(store, "JC-248", "SPRING-WASHER", "Spring Washer", 50, "248-issue-sw");
    assert("4 spring washer issue ok", springIssue.success === true, springIssue.error);

    moves = await store.list("mfr_movements");
    assert("10 plain stock reduced to 300", computeIncomingStoreOtherRmStock(0, moves, "PLAIN-WASHER") === 300);
    assert("10 spring stock reduced to 150", computeIncomingStoreOtherRmStock(0, moves, "SPRING-WASHER") === 150);
    assert("23 wire issue still deducted RM store", computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 500);

    const job = await store.get("mfr_job_cards", "JC-248");
    assert("3 wire+plain", getTotalAcceptedProductionRawMaterialQty(job, moves) === 650);
    assert("5 wire+plain+spring total 650", getTotalAcceptedProductionRawMaterialQty(job, moves) === 650);
    assert("2 other still optional for start (wire present)", canStartProductionWithRm(job, moves, { compulsory: true }).ok === true);
    assert("17 send avail 650", productionSendAvailable(job, moves, { compulsory: true }) === 650);

    const neg = canIssueOtherRawMaterialQty(100, 0, "KG");
    const neg2 = canIssueOtherRawMaterialQty(100, -5, "KG");
    assert("13 zero rejected", neg.ok === false);
    assert("13 negative rejected", neg2.ok === false);

    const zeroIssue = await commitMaterialMovementTx(store, {
      operationId: "248-zero",
      jobCardNo: "JC-248",
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 0,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialCode: "PLAIN-WASHER" },
      actor: actor("Purchase")
    });
    assert("13 zero issue rejected", zeroIssue.success === false);

    const overStock = await commitMaterialMovementTx(store, {
      operationId: "248-overstock",
      jobCardNo: "JC-248",
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 9999,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
      actor: actor("Purchase")
    });
    assert("12 insufficient stock rejected", overStock.success === false);

    const unauth = await commitMaterialMovementTx(store, {
      operationId: "248-unauth",
      jobCardNo: "JC-248",
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 1,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
      actor: actor("Production")
    });
    assert("16 unauthorized rejected", unauth.success === false && unauth.statusCode === 403);

    const firstDup = await commitMaterialMovementTx(store, {
      operationId: "248-idemp",
      jobCardNo: "JC-248",
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 10,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
      actor: actor("Purchase")
    });
    const secondDup = await commitMaterialMovementTx(store, {
      operationId: "248-idemp",
      jobCardNo: "JC-248",
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 10,
      isIssueRequest: true,
      processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
      actor: actor("Purchase")
    });
    assert("14 duplicate operationId idempotent", firstDup.success === true && secondDup.success === true && secondDup.cached === true);

    const prod645 = await commitMaterialMovementTx(store, {
      operationId: "248-prod-645",
      jobCardNo: "JC-248",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 645,
      requireRawMaterialForProduction: true,
      processDetails: { producedQty: 645, wireScrapQty: 5 },
      actor: actor("Production")
    });
    moves = await store.list("mfr_movements");
    const after645 = await store.get("mfr_job_cards", "JC-248");
    assert("19 produce 645", prod645.success === true, prod645.error);
    assert("20/21 remaining 355", unproducedOrderQty(after645, moves) === 355);
    assert("20 job stays Production", after645.currentDepartment === "Production");

    const over = await commitMaterialMovementTx(store, {
      operationId: "248-over-complete",
      jobCardNo: "JC-248",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("22 over-completion rejected vs remaining RM", over.success === false);

    const rest = await commitMaterialMovementTx(store, {
      operationId: "248-prod-5",
      jobCardNo: "JC-248",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 5,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("20 leftover RM 5 still producible", rest.success === true, rest.error);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-WP", 1000);
    const w = await purchaseWire(store, 500, "wp-w", "INV-WP-W");
    await acceptMaterialMovementTx(store, { operationId: "wp-w-a", movementId: w.movement.movementId, actor: actor("Raw Material Store") });
    const p = await purchaseOtherRm(store, "PLAIN-WASHER", "Plain Washer", 100, "wp-p", "INV-WP-P");
    await acceptIncoming(store, p.movement.movementId, "wp-p-a");
    await issueWire(store, "JC-WP", 500, "wp-iw");
    await issueOtherRm(store, "JC-WP", "PLAIN-WASHER", "Plain Washer", 100, "wp-ip");
    const job = await store.get("mfr_job_cards", "JC-WP");
    const moves = await store.list("mfr_movements");
    assert("3 Wire + Plain Washer total 600", getTotalAcceptedProductionRawMaterialQty(job, moves) === 600);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-WS", 1000);
    const w = await purchaseWire(store, 500, "ws-w", "INV-WS-W");
    await acceptMaterialMovementTx(store, { operationId: "ws-w-a", movementId: w.movement.movementId, actor: actor("Raw Material Store") });
    const s = await purchaseOtherRm(store, "SPRING-WASHER", "Spring Washer", 50, "ws-s", "INV-WS-S");
    await acceptIncoming(store, s.movement.movementId, "ws-s-a");
    await issueWire(store, "JC-WS", 500, "ws-iw");
    await issueOtherRm(store, "JC-WS", "SPRING-WASHER", "Spring Washer", 50, "ws-is");
    const job = await store.get("mfr_job_cards", "JC-WS");
    const moves = await store.list("mfr_movements");
    assert("4 Wire + Spring Washer total 550", getTotalAcceptedProductionRawMaterialQty(job, moves) === 550);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-CONC-A");
    await seedJob(store, "JC-CONC-B");
    const p = await purchaseOtherRm(store, "PLAIN-WASHER", "Plain Washer", 100, "conc-p", "INV-CONC-P");
    await acceptIncoming(store, p.movement.movementId, "conc-p-a");
    const [a, b] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: "conc-a",
        jobCardNo: "JC-CONC-A",
        fromDepartment: INCOMING_STORE,
        toDepartment: "Production",
        quantity: 80,
        isIssueRequest: true,
        processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
        actor: actor("Purchase")
      }),
      commitMaterialMovementTx(store, {
        operationId: "conc-b",
        jobCardNo: "JC-CONC-B",
        fromDepartment: INCOMING_STORE,
        toDepartment: "Production",
        quantity: 80,
        isIssueRequest: true,
        processDetails: { isOtherRawMaterialIssue: true, isWire: false, rawMaterialKind: "Other", rawMaterialCode: "PLAIN-WASHER" },
        actor: actor("Purchase")
      })
    ]);
    const ok = [a, b].filter((r) => r.success);
    const bad = [a, b].filter((r) => !r.success);
    const moves = await store.list("mfr_movements");
    const stock = computeIncomingStoreOtherRmStock(0, moves, "PLAIN-WASHER");
    assert("15 concurrent cannot double-spend", ok.length === 1 && bad.length === 1 && stock === 20, `ok=${ok.length} bad=${bad.length} stock=${stock}`);
  }

  {
    const wireAttempt = assertOtherRawMaterialIssueInput({
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      isIssueRequest: true,
      quantity: 10,
      processDetails: { isOtherRawMaterialIssue: true, isWire: true, rawMaterialCode: "RM-WIRE-8MM" }
    });
    assert("23 wire cannot use other RM issue", wireAttempt.ok === false);
  }

  console.log(`\nProcess 248: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
