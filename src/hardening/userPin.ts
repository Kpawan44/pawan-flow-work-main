export function isValidFourDigitPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin.trim());
}

/** Never invent a PIN. Callers must supply a valid 4-digit value. */
export function requireUserPin(pin: unknown): string {
  if (!isValidFourDigitPin(pin)) {
    throw new Error("A valid 4-digit PIN is required.");
  }
  return pin.trim();
}

/** UI/create-user resolver: empty is an error; never substitutes 1234. */
export function resolveExplicitUserPin(pin: unknown): { ok: true; pin: string } | { ok: false; error: string } {
  if (pin === undefined || pin === null || String(pin).trim() === "") {
    return { ok: false, error: "A 4-digit Security PIN is required." };
  }
  if (!isValidFourDigitPin(pin)) {
    return { ok: false, error: "Security PIN must be exactly 4 numeric digits." };
  }
  return { ok: true, pin: String(pin).trim() };
}
