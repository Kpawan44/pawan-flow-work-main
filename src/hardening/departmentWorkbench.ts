/**
 * Department Operations workbench membership.
 * Incoming (unaccepted) custody stays on the ingress list; after accept the same
 * job/order must remain retrievable on the receiving department's operations queue.
 */

export type WorkbenchJob = {
  jobCardNo?: string;
  completed?: boolean;
  status?: string;
  processType?: string;
  currentDepartment?: string;
  orderQty?: number;
  heatTreatmentRequired?: boolean;
  heatTreatmentDetails?: { rejectionQty?: number };
  platingDetails?: { rejectionQty?: number };
  packingDetails?: { rejectionQty?: number };
};

export type WorkbenchMovement = {
  jobCardNo?: string;
  fromDepartment?: string;
  toDepartment?: string;
  accepted?: boolean;
  quantity?: number;
  deletedDate?: string;
};

function qtyMovedFrom(jobCardNo: string, fromDepartment: string, movements: WorkbenchMovement[]): number {
  const jc = String(jobCardNo || "").toLowerCase();
  return movements
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === jc &&
        m.fromDepartment === fromDepartment &&
        !m.deletedDate
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

function qtyAcceptedAt(jobCardNo: string, toDepartment: string, movements: WorkbenchMovement[]): number {
  const jc = String(jobCardNo || "").toLowerCase();
  return movements
    .filter(
      (m) =>
        String(m.jobCardNo || "").toLowerCase() === jc &&
        m.toDepartment === toDepartment &&
        m.accepted &&
        !m.deletedDate
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

/**
 * Pick the Firestore job-card document ID that already exists.
 * Prefer canonical uppercase; fall back to the original/as-is ID.
 * Returns null when neither exists so callers do not create a duplicate.
 */
export function resolveExistingJobCardDocId(
  rawJobCardNo: string,
  hasDoc: (id: string) => boolean
): string | null {
  const raw = String(rawJobCardNo || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.startsWith("STOCK-IN-")) return null;
  if (hasDoc(upper)) return upper;
  if (raw !== upper && hasDoc(raw)) return raw;
  return null;
}

export function hasUnacceptedIncomingToDepartment(
  jobCardNo: string,
  department: string,
  movements: WorkbenchMovement[]
): boolean {
  const jc = String(jobCardNo || "").toLowerCase();
  return movements.some(
    (m) =>
      String(m.jobCardNo || "").toLowerCase() === jc &&
      m.toDepartment === department &&
      !m.accepted &&
      !m.deletedDate
  );
}

/**
 * Whether a job belongs on a department's In-Process / operations queue
 * (not the Incoming custody inbox).
 */
export function isJobInDepartmentOperationsQueue(
  department: string,
  job: WorkbenchJob,
  movements: WorkbenchMovement[]
): boolean {
  if (job.completed) return false;

  if (job.status === "Pending Acceptance" && department !== "Dispatch") {
    if (hasUnacceptedIncomingToDepartment(String(job.jobCardNo || ""), department, movements)) {
      return false;
    }
  }

  if (department === "Dispatch") {
    return true;
  }

  const jobNo = String(job.jobCardNo || "");

  if (department === "Purchase") {
    const pendingPurchaseQty = Number(job.orderQty || 0) - qtyMovedFrom(jobNo, "Purchase", movements);
    return job.processType === "Purchase" && (job.currentDepartment === "Purchase" || pendingPurchaseQty > 0);
  }

  if (department === "Production") {
    const pendingProdQty = Number(job.orderQty || 0) - qtyMovedFrom(jobNo, "Production", movements);
    // After Production ACCEPT, currentDepartment is Production. Include Purchase
    // processType jobs — they were previously excluded and vanished from both
    // Incoming (accepted) and Operations (processType !== Purchase).
    if (job.currentDepartment === "Production") return true;
    return job.processType !== "Purchase" && pendingProdQty > 0;
  }

  if (department === "Heat Treatment") {
    const totalReceivedAtHT = qtyAcceptedAt(jobNo, "Heat Treatment", movements);
    const totalRoutedFromHT = qtyMovedFrom(jobNo, "Heat Treatment", movements);
    const pendingHTQty = totalReceivedAtHT - totalRoutedFromHT - (job.heatTreatmentDetails?.rejectionQty || 0);
    const isHTRequiredOrRouted =
      job.heatTreatmentRequired || totalReceivedAtHT > 0 || job.currentDepartment === "Heat Treatment";
    if (!isHTRequiredOrRouted) return false;
    return job.currentDepartment === "Heat Treatment" || (totalReceivedAtHT > 0 && pendingHTQty > 0);
  }

  if (department === "Plating") {
    const totalReceivedAtPlating = qtyAcceptedAt(jobNo, "Plating", movements);
    const totalRoutedFromPlating = qtyMovedFrom(jobNo, "Plating", movements);
    const pendingPlatingQty = totalReceivedAtPlating - totalRoutedFromPlating - (job.platingDetails?.rejectionQty || 0);
    return job.currentDepartment === "Plating" || (totalReceivedAtPlating > 0 && pendingPlatingQty > 0);
  }

  if (department === "Packing") {
    const totalReceivedAtPacking = qtyAcceptedAt(jobNo, "Packing", movements);
    const totalRoutedFromPacking = qtyMovedFrom(jobNo, "Packing", movements);
    const pendingPackingQty = totalReceivedAtPacking - totalRoutedFromPacking - (job.packingDetails?.rejectionQty || 0);
    return job.currentDepartment === "Packing" || (totalReceivedAtPacking > 0 && pendingPackingQty > 0);
  }

  return job.currentDepartment === department;
}
