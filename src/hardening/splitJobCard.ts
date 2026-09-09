import { SimpleStore } from "./commitMaterialMovement";
import { parentSplitAvailableQty } from "./process2Manufacturing";

export interface JobSplitChildInput {
  childJobCardNo: string;
  quantity: number;
}

export interface JobSplitInput {
  operationId: string;
  parentJobCardNo: string;
  childSplits: JobSplitChildInput[];
  actor: {
    userId: string;
    userName: string;
    role: string;
    department: string;
  };
  nowIso?: string;
}

export interface JobSplitResult {
  success: boolean;
  cached?: boolean;
  error?: string;
  statusCode?: number;
  parentJobCard?: any;
  childJobCards?: any[];
  writes?: Array<{ collection: string; id: string; data: any }>;
}

export async function splitJobCardTx(
  store: SimpleStore,
  input: JobSplitInput
): Promise<JobSplitResult> {
  const serializeKey = String(input.parentJobCardNo || input.operationId || "split").toUpperCase();
  if (store.runSerialized) {
    return store.runSerialized(`split:${serializeKey}`, () => splitJobCardTxInner(store, input));
  }
  return splitJobCardTxInner(store, input);
}

async function splitJobCardTxInner(
  store: SimpleStore,
  input: JobSplitInput
): Promise<JobSplitResult> {
  const now = input.nowIso || new Date().toISOString();
  const opKey = String(input.operationId || "").trim();
  if (!opKey) {
    return { success: false, statusCode: 400, error: "operationId is required." };
  }

  // Idempotency check
  const existingIdemp = await store.get("mfr_idempotency_keys", opKey);
  if (existingIdemp?.result) {
    return { success: true, writes: [], ...existingIdemp.result, cached: true };
  }

  const parentNo = String(input.parentJobCardNo || "").trim();
  if (!parentNo) {
    return { success: false, statusCode: 400, error: "parentJobCardNo is required." };
  }

  const parentJob = (await store.get("mfr_job_cards", parentNo.toUpperCase())) || (await store.get("mfr_job_cards", parentNo));
  if (!parentJob) {
    return { success: false, statusCode: 404, error: `Parent Job Card '${parentNo}' not found.` };
  }

  if (parentJob.completed || String(parentJob.status || "").toLowerCase() === "completed") {
    return { success: false, statusCode: 400, error: "Cannot split an already completed parent job card." };
  }

  if (!Array.isArray(input.childSplits) || input.childSplits.length === 0) {
    return { success: false, statusCode: 400, error: "childSplits array must contain at least one child definition." };
  }

  const seenChildNos = new Set<string>();
  let totalChildQty = 0;

  for (const c of input.childSplits) {
    const cNo = String(c.childJobCardNo || "").trim();
    const cQty = Number(c.quantity);

    if (!cNo) {
      return { success: false, statusCode: 400, error: "Child job card number cannot be empty." };
    }

    if (isNaN(cQty) || !isFinite(cQty) || cQty <= 0) {
      return { success: false, statusCode: 400, error: `Child quantity for '${cNo}' must be a positive number greater than 0.` };
    }

    if (cNo.toLowerCase() === parentNo.toLowerCase()) {
      return { success: false, statusCode: 400, error: `Child job card ID '${cNo}' cannot equal parent job card ID.` };
    }

    // Cyclic lineage check
    if (parentJob.parentJobCardNo && parentJob.parentJobCardNo.toLowerCase() === cNo.toLowerCase()) {
      return { success: false, statusCode: 400, error: `Cyclic lineage detected: '${cNo}' is an ancestor of '${parentNo}'.` };
    }

    if (seenChildNos.has(cNo.toLowerCase())) {
      return { success: false, statusCode: 400, error: `Duplicate child job card ID '${cNo}' in split input.` };
    }
    seenChildNos.add(cNo.toLowerCase());

    // Existing job check in store
    const existingChild = (await store.get("mfr_job_cards", cNo.toUpperCase())) || (await store.get("mfr_job_cards", cNo));
    if (existingChild) {
      return { success: false, statusCode: 409, error: `Job Card ID '${cNo}' already exists.` };
    }

    totalChildQty += cQty;
  }

  const movements = await store.list("mfr_movements");
  const parentAvailableQty = parentSplitAvailableQty(parentJob, movements);
  if (totalChildQty > parentAvailableQty) {
    return {
      success: false,
      statusCode: 400,
      error: `Total split quantity ${totalChildQty} exceeds parent available quantity ${parentAvailableQty}.`
    };
  }

  // Update parent job
  const existingChildren = Array.isArray(parentJob.childJobCardNos) ? [...parentJob.childJobCardNos] : [];
  const newChildNos = input.childSplits.map(c => c.childJobCardNo.trim());
  const updatedChildNos = [...existingChildren, ...newChildNos];

  const existingHistory = Array.isArray(parentJob.splitHistory) ? [...parentJob.splitHistory] : [];
  const newHistoryEntries = input.childSplits.map(c => ({
    childJobCardNo: c.childJobCardNo.trim(),
    quantity: Number(c.quantity),
    splitDate: now,
    operationId: opKey
  }));
  const updatedHistory = [...existingHistory, ...newHistoryEntries];

  const nextParentQty = parentAvailableQty - totalChildQty;
  const nextVersion = (parentJob.version || 1) + 1;

  const updatedParentJob = {
    ...parentJob,
    currentQty: nextParentQty,
    balanceQty: Math.max(0, Number(parentJob.orderQty || 0) - (Number(parentJob.processedQty || 0) + totalChildQty)),
    childJobCardNos: updatedChildNos,
    splitHistory: updatedHistory,
    version: nextVersion,
    updatedAt: now,
    updatedBy: input.actor.userName
  };

  const createdChildJobs: any[] = [];
  const writes: Array<{ collection: string; id: string; data: any }> = [];

  // Write updated parent
  writes.push({ collection: "mfr_job_cards", id: parentJob.jobCardNo, data: updatedParentJob });
  await store.set("mfr_job_cards", parentJob.jobCardNo, updatedParentJob);

  // Build child jobs
  for (const c of input.childSplits) {
    const cNo = c.childJobCardNo.trim();
    const cQty = Number(c.quantity);

    const childJob = {
      jobCardNo: cNo,
      parentJobCardNo: parentJob.jobCardNo,
      orderNo: parentJob.orderNo || "",
      poNumber: parentJob.poNumber || "",
      partyName: parentJob.partyName || "",
      itemName: parentJob.itemName || "",
      itemCode: parentJob.itemCode || "",
      materialGrade: parentJob.materialGrade || "",
      heatNo: parentJob.heatNo || "",
      orderQty: cQty,
      currentQty: cQty,
      balanceQty: cQty,
      unit: parentJob.unit || "PCS",
      currentDepartment: parentJob.currentDepartment || "Production",
      status: parentJob.status || "In Progress",
      heatTreatmentRequired: Boolean(parentJob.heatTreatmentRequired),
      completed: false,
      processType: parentJob.processType || "Manufacturing",
      isWire: Boolean(parentJob.isWire),
      rawMaterialKind: parentJob.rawMaterialKind,
      createdBy: input.actor.userName,
      createdAt: now,
      version: 1
    };

    createdChildJobs.push(childJob);
    writes.push({ collection: "mfr_job_cards", id: cNo, data: childJob });
    await store.set("mfr_job_cards", cNo, childJob);
  }

  const resultPayload = {
    success: true,
    parentJobCard: updatedParentJob,
    childJobCards: createdChildJobs,
    writes
  };

  await store.set("mfr_idempotency_keys", opKey, {
    key: opKey,
    nowIso: now,
    result: resultPayload
  });

  return resultPayload;
}
