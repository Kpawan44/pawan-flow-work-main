import { ProcessTransferStatus } from "../types";

export type ProcessTransferAction = "create" | "receive" | "start" | "complete" | "assign_rack";
export type ProcessKind = "Repacking" | "Replating";

export function initialProcessTransferStatus(toProcess: ProcessKind): ProcessTransferStatus {
  return toProcess === "Repacking" ? "Sent to Repacking" : "Sent to Replating";
}

export function expectedStatusForAction(
  toProcess: ProcessKind,
  action: ProcessTransferAction,
  currentStatus?: string
): string[] {
  if (action === "create") return [];
  if (action === "receive") {
    if (currentStatus === "Plating Completed - Sent to Packing" || currentStatus === "Sent to Packing") {
      return ["Plating Completed - Sent to Packing", "Sent to Packing"];
    }
    return toProcess === "Repacking" 
      ? ["Sent to Repacking", "Sent to Packing"] 
      : ["Sent to Replating"];
  }
  if (action === "start") {
    if (currentStatus === "Received at Packing") {
      return ["Received at Packing"];
    }
    return toProcess === "Repacking" 
      ? ["Received at Repacking", "Received at Packing"] 
      : ["Received at Replating"];
  }
  if (action === "complete") {
    if (currentStatus === "Packing in Process") {
      return ["Packing in Process"];
    }
    return toProcess === "Repacking" 
      ? ["Repacking in Process", "Packing in Process"] 
      : ["Replating in Process"];
  }
  if (action === "assign_rack") {
    return [
      "Packing Completed - Sent to Store",
      "Repacking Completed",
      "Replating Completed",
      "Returned to Store"
    ];
  }
  return [];
}

export function nextStatusForAction(
  toProcess: ProcessKind,
  action: ProcessTransferAction,
  currentStatus?: string
): ProcessTransferStatus {
  if (action === "create") return initialProcessTransferStatus(toProcess);
  
  if (action === "receive") {
    if (currentStatus === "Plating Completed - Sent to Packing" || currentStatus === "Sent to Packing") {
      return "Received at Packing";
    }
    return toProcess === "Repacking" ? "Received at Repacking" : "Received at Replating";
  }
  
  if (action === "start") {
    if (currentStatus === "Received at Packing") {
      return "Packing in Process";
    }
    return toProcess === "Repacking" ? "Repacking in Process" : "Replating in Process";
  }
  
  if (action === "complete") {
    // When Plating completes, forward to Packing
    if (currentStatus === "Replating in Process" || toProcess === "Replating") {
      // Check if already in Packing stage
      if (currentStatus === "Packing in Process") {
        return "Packing Completed - Sent to Store";
      }
      return "Plating Completed - Sent to Packing";
    }
    // When Packing completes, send to Store for Rack Assignment
    return "Packing Completed - Sent to Store";
  }

  if (action === "assign_rack") {
    return "Returned to Store";
  }

  return "Returned to Store";
}

export function assertProcessTransferTransition(
  toProcess: ProcessKind,
  currentStatus: string,
  action: ProcessTransferAction
): { ok: true; nextStatus: ProcessTransferStatus } | { ok: false; error: string } {
  if (action === "create") {
    return { ok: true, nextStatus: nextStatusForAction(toProcess, action, currentStatus) };
  }
  const allowed = expectedStatusForAction(toProcess, action, currentStatus);
  if (!allowed.includes(currentStatus)) {
    return {
      ok: false,
      error: `Invalid process-transfer transition: cannot ${action} from status '${currentStatus}'. Expected one of: ${allowed.join(", ")}.`
    };
  }
  return { ok: true, nextStatus: nextStatusForAction(toProcess, action, currentStatus) };
}

export function formatStpNumber(seq: number): string {
  return `STP-${String(seq).padStart(6, "0")}`;
}
