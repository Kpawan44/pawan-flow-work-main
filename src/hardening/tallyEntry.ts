/**
 * Process 205 — Tally-style keyboard entry helpers.
 */

export function enterAdvancesField(opts: {
  isComposing?: boolean;
  shiftKey?: boolean;
  lastField?: boolean;
}): "advance" | "submit" | "ignore" {
  if (opts.isComposing) return "ignore";
  if (opts.shiftKey) return "ignore";
  return opts.lastField ? "submit" : "advance";
}

export function preserveFailedSaveFields<T extends Record<string, unknown>>(
  fields: T,
  serverAccepted: boolean,
): T {
  if (serverAccepted) {
    return {} as T;
  }
  return { ...fields };
}

export function shouldIgnoreDuplicateSubmit(opts: {
  inFlight: boolean;
  lastSubmitAtMs: number;
  nowMs: number;
  windowMs?: number;
}): boolean {
  if (opts.inFlight) return true;
  const windowMs = opts.windowMs ?? 400;
  return opts.nowMs - opts.lastSubmitAtMs < windowMs;
}

/** Enter in an input advances to the next field; last field submits the form. */
export function tallyFormEnterAction(
  e: { key: string; shiftKey?: boolean; nativeEvent?: { isComposing?: boolean }; preventDefault: () => void },
  opts: { isLastField: boolean; isTextArea?: boolean },
): "advance" | "submit" | "ignore" {
  if (e.key !== "Enter") return "ignore";
  if (opts.isTextArea) return "ignore";
  const action = enterAdvancesField({
    isComposing: Boolean(e.nativeEvent?.isComposing),
    shiftKey: Boolean(e.shiftKey),
    lastField: opts.isLastField
  });
  if (action === "advance") e.preventDefault();
  return action;
}
