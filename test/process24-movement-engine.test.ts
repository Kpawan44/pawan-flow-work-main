import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx, isDeptAuthorized } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import {
  remainingAtDepartment,
  remainingAtProduction,
  process2SendAvailableQty,
  assertHeatTreatmentRouting,
  isPendingAcceptanceMovement,
  productionSendAvailable
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

function actor(dept: string) {
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: "staff",
    department: dept,
    allowedDepartments: [dept],
    accessList: [dept]
  };
}

async function seedManufacturingJob(store: MemoryStore, jobCardNo: string, extra: Record<string, any> = {}) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty: 100,
    currentQty: 100,
    currentDepartment: "Production",
    status: "In Process",
    processType: "Manufacturing",
    heatTreatmentRequired: true,
    version: 1,
    itemName: "Bolt",
    itemCode: "B-1",
    unit: "KGS",
    ...extra
  });
}

async function seedAcceptedRm(store: MemoryStore, jobCardNo: string, qty: number, op = `rm-${jobCardNo}-${qty}`) {
  await store.set("mfr_movements", op, {
    movementId: op,
    jobCardNo,
    fromDepartment: "Raw Material Store",
    toDepartment: "Production",
    quantity: qty,
    accepted: true,
    isIssueRequest: true,
    issueStatus: "Issued"
  });
}

async function run() {
  // 1 Normal movement
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-1");
    await seedAcceptedRm(store, "JC-P24-1", 90);
    const res = await commitMaterialMovementTx(store, {
      operationId: "op-n1",
      jobCardNo: "JC-P24-1",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("1 normal movement succeeds", res.success === true, res.error);
    assert("1 original quantity preserved", res.movement?.quantity === 80 && res.movement?.accepted === false);
  }

  // 2 Duplicate pending
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-2");
    await seedAcceptedRm(store, "JC-P24-2", 100);
    await commitMaterialMovementTx(store, {
      operationId: "op-d1",
      jobCardNo: "JC-P24-2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const dup = await commitMaterialMovementTx(store, {
      operationId: "op-d2",
      jobCardNo: "JC-P24-2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 20,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("2 additional partial production while first batch is pending is allowed", dup.success === true, dup.error);
  }

  // 3 Full acceptance
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-3");
    await seedAcceptedRm(store, "JC-P24-3", 100);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "op-a1",
      jobCardNo: "JC-P24-3",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 55,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const acc = await acceptMaterialMovementTx(store, {
      operationId: "op-acc-1",
      movementId: sent.movement.movementId,
      actor: actor("Heat Treatment")
    });
    assert("3 full accept succeeds", acc.success === true && acc.movement?.accepted === true, acc.error);
    assert("3 original qty not overwritten", acc.movement?.quantity === 55);
    const inbox = (await store.list("mfr_movements")).filter((m) => isPendingAcceptanceMovement(m) && m.toDepartment === "Heat Treatment");
    assert("3 accepted movement leaves inbox", inbox.length === 0);
  }

  // 4 Partial acceptance + 6 partial rejection
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-4");
    await seedAcceptedRm(store, "JC-P24-4", 120);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "op-pacc",
      jobCardNo: "JC-P24-4",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const split = await rejectMaterialMovementTx(store, {
      operationId: "op-split",
      movementId: sent.movement.movementId,
      remarks: "Dimensional mismatch on 30 KG",
      acceptedQty: 70,
      rejectedQty: 30,
      actor: actor("Heat Treatment")
    });
    assert("4/6 partial accept/reject succeeds", split.success === true, split.error);
    assert("4 original movement quantity remains 100", split.movement?.quantity === 100);
    assert("4 accepted 70 rejected 30", split.movement?.acceptedQty === 70 && split.movement?.rejectedQty === 30);
    assert("6 return goes to immediately previous department", split.returnMovement?.toDepartment === "Production" && split.returnMovement?.fromDepartment === "Heat Treatment");
    assert("6 return lineage", split.returnMovement?.processDetails?.isRejectionReturn === true && split.returnMovement?.reversalOfMovementId === sent.movement.movementId);
    const job = await store.get("mfr_job_cards", "JC-P24-4");
    assert("4 job stays at HT when remainder accepted", job.currentDepartment === "Heat Treatment");
    const htRem = remainingAtDepartment(job, await store.list("mfr_movements"), "Heat Treatment");
    assert("4 HT remaining is accepted 70", htRem === 70, `got ${htRem}`);
  }

  // 5 Full rejection + 7 return + 8 reason + 9 inbox + 10 notification + 13 RBAC
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-5");
    await seedAcceptedRm(store, "JC-P24-5", 100);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "op-full",
      jobCardNo: "JC-P24-5",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const noReason = await rejectMaterialMovementTx(store, {
      operationId: "op-noreason",
      movementId: sent.movement.movementId,
      remarks: "   ",
      actor: actor("Heat Treatment")
    });
    assert("8 rejection reason required", noReason.success === false && String(noReason.error || "").toLowerCase().includes("reason"));

    const unauth = await rejectMaterialMovementTx(store, {
      operationId: "op-unauth",
      movementId: sent.movement.movementId,
      remarks: "bad",
      actor: actor("Packing")
    });
    assert("13 unauthorized reject blocked", unauth.statusCode === 403);

    const rej = await rejectMaterialMovementTx(store, {
      operationId: "op-full-rej",
      movementId: sent.movement.movementId,
      remarks: "Hardness failed",
      actor: actor("Heat Treatment")
    });
    assert("5 full rejection succeeds", rej.success === true, rej.error);
    assert("7 return to Production", rej.returnMovement?.toDepartment === "Production");
    assert("7 return auto-accepted at previous dept", rej.returnMovement?.accepted === true);
    const job = await store.get("mfr_job_cards", "JC-P24-5");
    assert("7 custody restored to Production", job.currentDepartment === "Production");
    const inbox = (await store.list("mfr_movements")).filter((m) => isPendingAcceptanceMovement(m) && m.toDepartment === "Heat Treatment");
    assert("9 rejected movement not in HT inbox", inbox.length === 0);
    assert("10 rejection notification generated", Boolean(rej.notification?.department === "Production"));
    const prodAvail = productionSendAvailable(job, await store.list("mfr_movements"), { compulsory: true });
    assert("20 rejected qty returned to Production capacity", prodAvail === 100, `got ${prodAvail}`);
  }

  // 11 Multiple rejection cycles
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-11");
    await seedAcceptedRm(store, "JC-P24-11", 50);
    const send1 = await commitMaterialMovementTx(store, {
      operationId: "cyc-1",
      jobCardNo: "JC-P24-11",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(store, {
      operationId: "cyc-1r",
      movementId: send1.movement.movementId,
      remarks: "first reject",
      actor: actor("Heat Treatment")
    });
    const send2 = await commitMaterialMovementTx(store, {
      operationId: "cyc-2",
      jobCardNo: "JC-P24-11",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const rej2 = await rejectMaterialMovementTx(store, {
      operationId: "cyc-2r",
      movementId: send2.movement.movementId,
      remarks: "second reject",
      actor: actor("Heat Treatment")
    });
    const send3 = await commitMaterialMovementTx(store, {
      operationId: "cyc-3",
      jobCardNo: "JC-P24-11",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const acc = await acceptMaterialMovementTx(store, {
      operationId: "cyc-3a",
      movementId: send3.movement.movementId,
      actor: actor("Heat Treatment")
    });
    const movs = await store.list("mfr_movements");
    const returns = movs.filter((m) => m.processDetails?.isRejectionReturn);
    assert("11 two independent rejection returns recorded", returns.length === 2);
    assert("11 final accept succeeds", acc.success === true && acc.movement?.accepted === true, acc.error);
    assert("11 second cycle does not collapse first", rej2.returnMovement?.reversalOfMovementId === send2.movement.movementId);
  }

  // 12 Rejection idempotency
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-12");
    await seedAcceptedRm(store, "JC-P24-12", 80);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "id-s",
      jobCardNo: "JC-P24-12",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const r1 = await rejectMaterialMovementTx(store, {
      operationId: "id-r",
      movementId: sent.movement.movementId,
      remarks: "retry-safe",
      actor: actor("Heat Treatment")
    });
    const r2 = await rejectMaterialMovementTx(store, {
      operationId: "id-r",
      movementId: sent.movement.movementId,
      remarks: "retry-safe",
      actor: actor("Heat Treatment")
    });
    const returns = (await store.list("mfr_movements")).filter((m) => m.processDetails?.isRejectionReturn);
    assert("12 second reject is cached", r2.cached === true && r1.returnMovement?.movementId === r2.returnMovement?.movementId);
    assert("12 no duplicate return movements", returns.length === 1, `got ${returns.length}`);
  }

  // 14 Production can exceed order
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-14", { orderQty: 100 });
    await seedAcceptedRm(store, "JC-P24-14", 130);
    const res = await commitMaterialMovementTx(store, {
      operationId: "over-order",
      jobCardNo: "JC-P24-14",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 110,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("14 production may exceed order qty when RM allows", res.success === true, res.error);
  }

  // 15 cannot exceed compulsory RM
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-15", { orderQty: 100 });
    await seedAcceptedRm(store, "JC-P24-15", 80);
    const res = await commitMaterialMovementTx(store, {
      operationId: "over-rm",
      jobCardNo: "JC-P24-15",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 81,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("15 cannot exceed accepted RM when compulsory", res.success === false);
  }

  // 16 multiple RM issues accumulate
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-16");
    await seedAcceptedRm(store, "JC-P24-16", 50, "rm-a");
    await seedAcceptedRm(store, "JC-P24-16", 30, "rm-b");
    await seedAcceptedRm(store, "JC-P24-16", 40, "rm-c");
    const res = await commitMaterialMovementTx(store, {
      operationId: "multi-rm",
      jobCardNo: "JC-P24-16",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 120,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("16 multiple RM issues accumulate to 120", res.success === true, res.error);
  }

  // 17 optional RM allows above order
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-17", { orderQty: 100 });
    const res = await commitMaterialMovementTx(store, {
      operationId: "opt-rm",
      jobCardNo: "JC-P24-17",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 140,
      requireRawMaterialForProduction: false,
      actor: actor("Production")
    });
    assert("17 optional RM allows production above order", res.success === true, res.error);
  }

  // 18/19 downstream ceiling and partial remaining
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-18");
    await seedAcceptedRm(store, "JC-P24-18", 200);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "ds-1",
      jobCardNo: "JC-P24-18",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 110,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await acceptMaterialMovementTx(store, {
      operationId: "ds-1a",
      movementId: sent.movement.movementId,
      actor: actor("Heat Treatment")
    });
    const over = await commitMaterialMovementTx(store, {
      operationId: "ds-over",
      jobCardNo: "JC-P24-18",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 111,
      actor: actor("Heat Treatment")
    });
    assert("18 HT cannot exceed Production transfer", over.success === false);
    const part = await commitMaterialMovementTx(store, {
      operationId: "ds-part",
      jobCardNo: "JC-P24-18",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 70,
      actor: actor("Heat Treatment")
    });
    assert("19 partial HT transfer succeeds", part.success === true, part.error);
    const job = await store.get("mfr_job_cards", "JC-P24-18");
    const rem = remainingAtDepartment(job, await store.list("mfr_movements"), "Heat Treatment");
    assert("19 40 remains at HT", rem === 40, `got ${rem}`);
  }

  // 21 currentQty must not destroy conservation
  {
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-21");
    await seedAcceptedRm(store, "JC-P24-21", 100);
    const sent = await commitMaterialMovementTx(store, {
      operationId: "cq-1",
      jobCardNo: "JC-P24-21",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const acc = await acceptMaterialMovementTx(store, {
      operationId: "cq-1a",
      movementId: sent.movement.movementId,
      actor: actor("Heat Treatment")
    });
    const job = await store.get("mfr_job_cards", "JC-P24-21");
    const movs = await store.list("mfr_movements");
    const htRem = remainingAtDepartment(job, movs, "Heat Treatment");
    const prodRem = remainingAtProduction(job, movs, { compulsory: true });
    assert("21 HT ledger remaining is accepted 40", htRem === 40, `got ${htRem}`);
    assert("21 production remaining 60 is preserved (not wiped to 40)", prodRem === 60 && acc.updatedJobCard?.currentQty === 60, `prod ${prodRem} cache ${acc.updatedJobCard?.currentQty}`);
    assert("21 job stays in Production while 60 KG is still unproduced", acc.updatedJobCard?.currentDepartment === "Production");
  }

  // 22 QuickTransfer ceiling helper
  {
    const job = { jobCardNo: "JC-P24-22", orderQty: 100, processType: "Manufacturing" };
    const movs = [
      { jobCardNo: "JC-P24-22", fromDepartment: "Raw Material Store", toDepartment: "Production", isIssueRequest: true, accepted: true, quantity: 80 },
      { jobCardNo: "JC-P24-22", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 80 }
    ];
    const cap = process2SendAvailableQty("Production", job, movs, { compulsory: true });
    assert("22 QuickTransfer/production ceiling is RM remaining 0", cap === 0);
  }

  // 23 HT required cannot skip
  {
    const blocked = assertHeatTreatmentRouting({ heatTreatmentRequired: true }, "Production", "Plating");
    const ok = assertHeatTreatmentRouting({ heatTreatmentRequired: true }, "Production", "Heat Treatment");
    const skip = assertHeatTreatmentRouting({ heatTreatmentRequired: false }, "Production", "Plating");
    assert("23 HT required blocks Plating skip", blocked.ok === false);
    assert("23 HT required allows HT", ok.ok === true);
    assert("23 HT not required allows Plating", skip.ok === true);
    const store = new MemoryStore();
    await seedManufacturingJob(store, "JC-P24-23", { heatTreatmentRequired: true });
    await seedAcceptedRm(store, "JC-P24-23", 50);
    const res = await commitMaterialMovementTx(store, {
      operationId: "ht-skip",
      jobCardNo: "JC-P24-23",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 10,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("23 live commit blocks HT skip", res.success === false);
  }

  assert("RBAC accept uses receiving dept", isDeptAuthorized(actor("Heat Treatment"), "Heat Treatment") === true);
  assert("RBAC packing cannot accept for HT", isDeptAuthorized(actor("Packing"), "Heat Treatment") === false);

  console.log(`\nProcess 24 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
