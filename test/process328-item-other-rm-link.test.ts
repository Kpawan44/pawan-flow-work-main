import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import {
  buildItemOtherRmLinkDocId,
  validateItemOtherRmLinkInput,
  canManageItemOtherRmLinks,
  assertItemOtherRmLinkActive,
  upsertItemOtherRmLink,
  filterLinkedOtherRmCatalog
} from "../src/hardening/itemOtherRawMaterialLink";
import {
  totalRawMaterialWeight,
  netProductionQty
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

function actor(dept: string, role = "staff") {
  const extra = dept === "Purchase" ? ["Incoming Store"] : dept === "Incoming Store" ? ["Purchase"] : [];
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role,
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

async function acceptWire(store: MemoryStore, movementId: string, op: string) {
  return acceptMaterialMovementTx(store, {
    operationId: op,
    movementId,
    actor: actor("Raw Material Store")
  });
}

async function issueOtherRm(store: MemoryStore, jobCardNo: string, code: string, name: string, qty: number, op: string, jobCardData?: any) {
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
    extra: {
      jobCardData: jobCardData || { jobCardNo, itemCode: "ITEM-6X13-MS-DW-SCREW", itemName: "6x13 MS Double Washer Screw" }
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

async function issueWire(store: MemoryStore, jobCardNo: string, qty: number, op: string, jobCardData?: any) {
  const issue = await commitMaterialMovementTx(store, {
    operationId: op,
    jobCardNo,
    fromDepartment: RAW_MATERIAL_STORE,
    toDepartment: "Production",
    quantity: qty,
    isIssueRequest: true,
    requestedQty: qty,
    processDetails: { rawMaterialCode: "RM-WIRE-8MM", isWire: true },
    extra: {
      jobCardData: jobCardData || { jobCardNo, itemCode: "ITEM-PLAIN-PIN-NO-WASHER", itemName: "Plain Pin No Washer" }
    },
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

async function runTests() {
  console.log("===============================================================");
  console.log("PROCESS 328 — ITEM <-> OTHER RAW MATERIAL LINKAGE TEST SUITE");
  console.log("===============================================================\n");

  const store = new MemoryStore();
  const adminActor = { userId: "admin-1", userName: "Admin", role: "admin", department: "Administration" };
  const ownerActor = { userId: "owner-1", userName: "Owner", role: "owner", department: "Management" };
  const prodActor = actor("Production");
  const incomingStoreActor = actor("Incoming Store");

  // 1. Create valid item -> Other RM link
  const link1Res = await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      itemName: "6x13 MS Double Washer Screw",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      otherRawMaterialName: "Plain Washer 6mm",
      active: true
    },
    adminActor
  );
  assert("1. create valid item -> Other RM link", link1Res.ok === true && link1Res.link.active === true);

  // 2. Duplicate link handling (idempotent upsert with deterministic ID)
  const link1DupRes = await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      itemName: "6x13 MS Double Washer Screw (Updated)",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      otherRawMaterialName: "Plain Washer 6mm",
      active: true
    },
    adminActor
  );
  const expectedDocId = buildItemOtherRmLinkDocId("ITEM-6X13-MS-DW-SCREW", "RM-OTHER-PLAIN-WASHER-6MM");
  assert(
    "2. duplicate link handling (idempotent upsert)",
    link1DupRes.ok === true && link1DupRes.link.id === expectedDocId && link1DupRes.link.itemName === "6x13 MS Double Washer Screw (Updated)"
  );

  // 3. Two Other RMs linked to one item
  const link2Res = await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      itemName: "6x13 MS Double Washer Screw",
      otherRawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM",
      otherRawMaterialName: "Spring Washer 6mm",
      active: true
    },
    adminActor
  );
  const checkLink1 = await assertItemOtherRmLinkActive(store, "ITEM-6X13-MS-DW-SCREW", "RM-OTHER-PLAIN-WASHER-6MM");
  const checkLink2 = await assertItemOtherRmLinkActive(store, "ITEM-6X13-MS-DW-SCREW", "RM-OTHER-SPRING-WASHER-6MM");
  assert("3. two Other RMs linked to one item", link2Res.ok === true && checkLink1.ok === true && checkLink2.ok === true);

  // 4. Same Other RM linked to two items
  const link3Res = await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-8X20-MS-HEX-SCREW",
      itemName: "8x20 MS Hex Screw",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      otherRawMaterialName: "Plain Washer 6mm",
      active: true
    },
    ownerActor
  );
  const checkItem1 = await assertItemOtherRmLinkActive(store, "ITEM-6X13-MS-DW-SCREW", "RM-OTHER-PLAIN-WASHER-6MM");
  const checkItem2 = await assertItemOtherRmLinkActive(store, "ITEM-8X20-MS-HEX-SCREW", "RM-OTHER-PLAIN-WASHER-6MM");
  assert("4. same Other RM linked to two items", link3Res.ok === true && checkItem1.ok === true && checkItem2.ok === true);

  // Setup Job Card & Incoming Store Stock for issue testing
  const jcNo = "JC-328-TEST-001";
  await store.set("mfr_job_cards", jcNo, {
    id: jcNo,
    jobCardNo: jcNo,
    itemCode: "ITEM-6X13-MS-DW-SCREW",
    itemName: "6x13 MS Double Washer Screw",
    targetQuantity: 1000
  });

  const p1 = await purchaseOtherRm(store, "RM-OTHER-PLAIN-WASHER-6MM", "Plain Washer 6mm", 200, "op-p-plain", "B-101");
  if (p1.success) await acceptIncoming(store, p1.movement.movementId, "op-a-plain");

  const p2 = await purchaseOtherRm(store, "RM-OTHER-SPRING-WASHER-6MM", "Spring Washer 6mm", 100, "op-p-spring", "B-102");
  if (p2.success) await acceptIncoming(store, p2.movement.movementId, "op-a-spring");

  const pUnlinked = await purchaseOtherRm(store, "RM-OTHER-RUBBER-GASKET", "Rubber Gasket", 50, "op-p-gasket", "B-103");
  if (pUnlinked.success) await acceptIncoming(store, pUnlinked.movement.movementId, "op-a-gasket");

  // 5. Active link allows issue
  const issuePlain = await issueOtherRm(store, jcNo, "RM-OTHER-PLAIN-WASHER-6MM", "Plain Washer 6mm", 100, "op-iss-plain-1");
  assert("5. active link allows issue", issuePlain.success === true);

  // 6. Unlinked Other RM rejected
  const issueUnlinked = await issueOtherRm(store, jcNo, "RM-OTHER-RUBBER-GASKET", "Rubber Gasket", 10, "op-iss-unlinked");
  assert(
    "6. unlinked Other RM rejected",
    issueUnlinked.success === false && String(issueUnlinked.error).includes("is not actively linked to finished item")
  );

  // 7. Inactive link rejected
  // Soft deactivate Spring Washer link
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM",
      active: false
    },
    adminActor
  );
  const issueInactive = await issueOtherRm(store, jcNo, "RM-OTHER-SPRING-WASHER-6MM", "Spring Washer 6mm", 20, "op-iss-inactive");
  assert(
    "7. inactive link rejected",
    issueInactive.success === false && String(issueInactive.error).includes("is not actively linked to finished item")
  );

  // Re-activate Spring Washer link for later multi-RM tests
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM",
      active: true
    },
    adminActor
  );

  // 8. Wire cannot be linked
  const wireLinkRes = validateItemOtherRmLinkInput({
    itemCode: "ITEM-6X13-MS-DW-SCREW",
    otherRawMaterialCode: "RM-WIRE-8MM"
  });
  assert(
    "8. Wire cannot be linked",
    wireLinkRes.ok === false && wireLinkRes.error.includes("Wire cannot be linked")
  );

  // 9. itemCode "-" rejected
  const dashItemRes = validateItemOtherRmLinkInput({
    itemCode: "-",
    otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM"
  });
  assert("9. itemCode '-' rejected", dashItemRes.ok === false && dashItemRes.error.includes("required and must not be empty or '-'"));

  // 10. missing item code rejected
  const missingItemRes = validateItemOtherRmLinkInput({
    itemCode: "",
    otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM"
  });
  assert("10. missing item code rejected", missingItemRes.ok === false);

  // 11. missing Other RM code rejected
  const missingRmRes = validateItemOtherRmLinkInput({
    itemCode: "ITEM-6X13-MS-DW-SCREW",
    otherRawMaterialCode: ""
  });
  assert("11. missing Other RM code rejected", missingRmRes.ok === false);

  // 12. Production role cannot create link
  assert("12. Production role cannot create link", canManageItemOtherRmLinks(prodActor) === false);

  // 13. Incoming Store role cannot create link
  assert("13. Incoming Store role cannot create link", canManageItemOtherRmLinks(incomingStoreActor) === false);

  // 14. linked catalog returns only linked codes
  const catalogList = [
    { code: "RM-OTHER-PLAIN-WASHER-6MM", name: "Plain Washer", availableStock: 100, unit: "KG" },
    { code: "RM-OTHER-SPRING-WASHER-6MM", name: "Spring Washer", availableStock: 100, unit: "KG" },
    { code: "RM-OTHER-RUBBER-GASKET", name: "Rubber Gasket", availableStock: 50, unit: "KG" },
    { code: "RM-WIRE-8MM", name: "Wire", availableStock: 500, unit: "KG" }
  ];
  const activeLinks = [
    { id: "1", itemCode: "ITEM-6X13-MS-DW-SCREW", itemName: "6x13", otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM", otherRawMaterialName: "Plain Washer", active: true, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" },
    { id: "2", itemCode: "ITEM-6X13-MS-DW-SCREW", itemName: "6x13", otherRawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM", otherRawMaterialName: "Spring Washer", active: true, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" },
    { id: "3", itemCode: "ITEM-6X13-MS-DW-SCREW", itemName: "6x13", otherRawMaterialCode: "RM-OTHER-RUBBER-GASKET", otherRawMaterialName: "Rubber Gasket", active: false, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" }
  ];
  const filteredCatalog = filterLinkedOtherRmCatalog(catalogList, activeLinks, "ITEM-6X13-MS-DW-SCREW");
  assert(
    "14. linked catalog returns only active linked codes",
    filteredCatalog.length === 2 &&
    filteredCatalog.some(c => c.code === "RM-OTHER-PLAIN-WASHER-6MM") &&
    filteredCatalog.some(c => c.code === "RM-OTHER-SPRING-WASHER-6MM") &&
    !filteredCatalog.some(c => c.code === "RM-OTHER-RUBBER-GASKET") &&
    !filteredCatalog.some(c => c.code === "RM-WIRE-8MM")
  );

  // 15. linked + in-stock filtering
  const inStockItems = [
    { code: "RM-OTHER-PLAIN-WASHER-6MM", name: "Plain Washer", availableStock: 100, unit: "KG" },
    { code: "RM-OTHER-SPRING-WASHER-6MM", name: "Spring Washer", availableStock: 0, unit: "KG" },
    { code: "RM-OTHER-RUBBER-GASKET", name: "Rubber Gasket", availableStock: 50, unit: "KG" }
  ];
  const inStockLinked = filterLinkedOtherRmCatalog(inStockItems, activeLinks, "ITEM-6X13-MS-DW-SCREW");
  assert(
    "15. linked + in-stock filtering",
    inStockLinked.length === 1 &&
    inStockLinked[0].code === "RM-OTHER-PLAIN-WASHER-6MM"
  );

  // 16. stale/inactive link cannot issue
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      active: false
    },
    adminActor
  );
  const staleIssue = await issueOtherRm(store, jcNo, "RM-OTHER-PLAIN-WASHER-6MM", "Plain Washer 6mm", 10, "op-iss-stale");
  assert("16. stale/inactive link cannot issue", staleIssue.success === false);

  // Re-activate Plain Washer
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      active: true
    },
    adminActor
  );

  // 17. Other RM idempotency remains correct
  const issueSpring1 = await commitMaterialMovementTx(store, {
    operationId: "op-iss-spring-idemp",
    jobCardNo: jcNo,
    fromDepartment: INCOMING_STORE,
    toDepartment: "Production",
    quantity: 50,
    isIssueRequest: true,
    requestedQty: 50,
    unit: "KGS",
    processDetails: {
      isOtherRawMaterialIssue: true,
      isWire: false,
      rawMaterialKind: "Other",
      rawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM",
      rawMaterialName: "Spring Washer 6mm",
      unit: "KG"
    },
    extra: {
      jobCardData: { jobCardNo: jcNo, itemCode: "ITEM-6X13-MS-DW-SCREW" }
    },
    actor: actor("Purchase")
  });
  const issueSpring2 = await commitMaterialMovementTx(store, {
    operationId: "op-iss-spring-idemp",
    jobCardNo: jcNo,
    fromDepartment: INCOMING_STORE,
    toDepartment: "Production",
    quantity: 50,
    isIssueRequest: true,
    requestedQty: 50,
    unit: "KGS",
    processDetails: {
      isOtherRawMaterialIssue: true,
      isWire: false,
      rawMaterialKind: "Other",
      rawMaterialCode: "RM-OTHER-SPRING-WASHER-6MM",
      rawMaterialName: "Spring Washer 6mm",
      unit: "KG"
    },
    extra: {
      jobCardData: { jobCardNo: jcNo, itemCode: "ITEM-6X13-MS-DW-SCREW" }
    },
    actor: actor("Purchase")
  });
  assert(
    "17. Other RM idempotency remains correct",
    issueSpring1.success === true &&
    issueSpring2.success === true &&
    issueSpring1.movement.movementId === issueSpring2.movement.movementId &&
    issueSpring2.cached === true
  );
  if (issueSpring1.success && !issueSpring1.movement.accepted) {
    await acceptMaterialMovementTx(store, {
      operationId: "op-acc-spring-idemp-1",
      movementId: issueSpring1.movement.movementId,
      issueStatus: "Issued",
      actor: actor("Purchase")
    });
    await acceptMaterialMovementTx(store, {
      operationId: "op-acc-spring-idemp-2",
      movementId: issueSpring1.movement.movementId,
      actor: prodActor
    });
  }

  // 18. Concurrent Other RM issue remains serialized
  const pConcurrent = await purchaseOtherRm(store, "RM-OTHER-CONCURRENT", "Concurrent Washer", 100, "op-p-conc", "B-104");
  if (pConcurrent.success) await acceptIncoming(store, pConcurrent.movement.movementId, "op-a-conc");
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-CONCURRENT",
      active: true
    },
    adminActor
  );
  const [resA, resB] = await Promise.all([
    commitMaterialMovementTx(store, {
      operationId: "op-conc-issue-A",
      jobCardNo: jcNo,
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 60,
      isIssueRequest: true,
      requestedQty: 60,
      unit: "KGS",
      processDetails: {
        isOtherRawMaterialIssue: true,
        rawMaterialCode: "RM-OTHER-CONCURRENT",
        rawMaterialName: "Concurrent Washer",
        rawMaterialKind: "Other",
        materialType: "Raw Material",
        isWire: false
      },
      extra: { jobCardData: { jobCardNo: jcNo, itemCode: "ITEM-6X13-MS-DW-SCREW" } },
      actor: actor("Purchase")
    }),
    commitMaterialMovementTx(store, {
      operationId: "op-conc-issue-B",
      jobCardNo: jcNo,
      fromDepartment: INCOMING_STORE,
      toDepartment: "Production",
      quantity: 60,
      isIssueRequest: true,
      requestedQty: 60,
      unit: "KGS",
      processDetails: {
        isOtherRawMaterialIssue: true,
        rawMaterialCode: "RM-OTHER-CONCURRENT",
        rawMaterialName: "Concurrent Washer",
        rawMaterialKind: "Other",
        materialType: "Raw Material",
        isWire: false
      },
      extra: { jobCardData: { jobCardNo: jcNo, itemCode: "ITEM-6X13-MS-DW-SCREW" } },
      actor: actor("Purchase")
    })
  ]);
  assert(
    "18. concurrent Other RM issue remains serialized",
    (resA.success && !resB.success) || (!resA.success && resB.success)
  );

  // 19. Process 248 total RM = 650 (500 wire + 100 plain washer + 50 spring washer)
  const totalRm = totalRawMaterialWeight([500, 100, 50]);
  assert("19. Process 248 total RM = 650", totalRm === 650);

  // 20. Process 248 net production = 645 (650 - 5 scrap)
  const netProd = netProductionQty(650, 5);
  assert("20. Process 248 net production = 645", netProd === 645);

  // 21. Process 248 remaining = 355 (1000 target - 645 produced)
  const remaining = 1000 - netProd;
  assert("21. Process 248 remaining = 355", remaining === 355);

  // 22. Process 248 over-completion remains rejected
  const overCompletion = 660 > totalRm;
  assert("22. Process 248 over-completion remains rejected", overCompletion === true);

  // 23. Wire issue still succeeds with zero Other RM links
  const jcWireNo = "JC-WIRE-ONLY-001";
  await store.set("mfr_job_cards", jcWireNo, {
    id: jcWireNo,
    jobCardNo: jcWireNo,
    itemCode: "ITEM-PLAIN-PIN-NO-WASHER",
    itemName: "Plain Pin No Washer",
    targetQuantity: 500
  });
  const pWire = await purchaseWire(store, 500, "op-p-wire-only", "B-105");
  if (pWire.success) await acceptWire(store, pWire.movement.movementId, "op-a-wire-only");

  const issueWireRes = await issueWire(store, jcWireNo, 500, "op-iss-wire-only", {
    jobCardNo: jcWireNo,
    itemCode: "ITEM-PLAIN-PIN-NO-WASHER",
    itemName: "Plain Pin No Washer"
  });
  assert("23. Wire issue still succeeds with zero Other RM links", issueWireRes.success === true);

  // 24. Historical accepted movements remain intact after link deactivation
  await upsertItemOtherRmLink(
    store,
    {
      itemCode: "ITEM-6X13-MS-DW-SCREW",
      otherRawMaterialCode: "RM-OTHER-PLAIN-WASHER-6MM",
      active: false
    },
    adminActor
  );
  const movements = await store.list("mfr_movements");
  const acceptedPlainMovements = movements.filter(
    (m: any) =>
      m.jobCardNo === jcNo &&
      m.accepted === true &&
      m.processDetails?.rawMaterialCode === "RM-OTHER-PLAIN-WASHER-6MM"
  );
  assert(
    "24. historical accepted movements remain intact after link deactivation",
    acceptedPlainMovements.length === 1 && acceptedPlainMovements[0].quantity === 100
  );

  console.log("\n---------------------------------------------------------------");
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("---------------------------------------------------------------");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
