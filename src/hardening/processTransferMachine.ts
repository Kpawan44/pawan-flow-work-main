export type ProcessTransferAction = "create" | "receive" | "start" | "complete";
export type ProcessKind = "Repacking" | "Replating";

export function initialProcessTransferStatus(toProcess: ProcessKind): string {
  return toProcess === "Repacking" ? "Sent to Repacking" : "Sent to Replating";
}

export function expectedStatusForAction(toProcess: ProcessKind, action: ProcessTransferAction): string[] {
  if (action === "create") return [];
  if (action === "receive") {
    return toProcess === "Repacking" ? ["Sent to Repacking"] : ["Sent to Replating"];
  }
  if (action === "start") {
    return toProcess === "Repacking" ? ["Received at Repacking"] : ["Received at Replating"];
  }
  if (action === "complete") {
    return toProcess === "Repacking" ? ["Repacking in Process"] : ["Replating in Process"];
  }
  return [];
}

export function nextStatusForAction(toProcess: ProcessKind, action: ProcessTransferAction): string {
  if (action === "create") return initialProcessTransferStatus(toProcess);
  if (action === "receive") {
    return toProcess === "Repacking" ? "Received at Repacking" : "Received at Replating";
  }
  if (action === "start") {
    return toProcess === "Repacking" ? "Repacking in Process" : "Replating in Process";
  }
  return "Returned to Store";
}

export function assertProcessTransferTransition(
  toProcess: ProcessKind,
  currentStatus: string,
  action: ProcessTransferAction
): { ok: true } | { ok: false; error: string } {
  if (action === "create") return { ok: true };
  const allowed = expectedStatusForAction(toProcess, action);
  if (!allowed.includes(currentStatus)) {
    return {
      ok: false,
      error: `Invalid process-transfer transition: cannot ${action} from status '${currentStatus}'. Expected one of: ${allowed.join(", ")}.`
    };
  }
  return { ok: true };
}

export function formatStpNumber(seq: number): string {
  return `STP-${String(seq).padStart(6, "0")}`;
}
