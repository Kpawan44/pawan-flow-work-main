import crypto from "crypto";
import { HARDCODED_SESSION_SECRETS } from "./constants";

export interface SessionPayload {
  uid: string;
  userId: string;
  gen: string;
  iat: number;
  exp: number;
}

export function assertSessionSecretSafe(secret: string | undefined, nodeEnv: string | undefined): string {
  const isProd = nodeEnv === "production";
  if (!secret || !secret.trim() || HARDCODED_SESSION_SECRETS.includes(secret)) {
    if (isProd) {
      throw new Error(
        "Fatal: SESSION_SECRET must be set to a unique non-default value in production. Refusing to start."
      );
    }
    return crypto.randomBytes(32).toString("hex");
  }
  return secret;
}

export function createSessionToken(secret: string, uid: string, generation: string, ttlMs = 24 * 3600 * 1000): string {
  const payload: SessionPayload = {
    uid,
    userId: uid,
    gen: generation,
    iat: Date.now(),
    exp: Date.now() + ttlMs
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadStr).digest("base64url");
  return `${payloadStr}.${sig}`;
}

export function verifySessionToken(
  secret: string,
  token: string,
  currentGeneration?: string
): { ok: true; payload: SessionPayload } | { ok: false; error: string } {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return { ok: false, error: "Invalid token format." };
    }
    const [payloadStr, sig] = parts;
    const expectedSig = crypto.createHmac("sha256", secret).update(payloadStr).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "Invalid or tampered session token." };
    }
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString("utf8")) as SessionPayload;
    if (!payload || !(payload.uid || payload.userId)) {
      return { ok: false, error: "Invalid session payload." };
    }
    if (payload.exp && payload.exp < Date.now()) {
      return { ok: false, error: "Session expired." };
    }
    if (currentGeneration && payload.gen && payload.gen !== currentGeneration) {
      return { ok: false, error: "Session invalidated by factory reset." };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Invalid or tampered session token." };
  }
}

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

export function extractBearerToken(authorizationHeader: string | undefined | null): string | null {
  if (!authorizationHeader || typeof authorizationHeader !== "string") return null;
  const trimmed = authorizationHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function hmacBearerAuthStatus(
  authorizationHeader: string | undefined | null,
  secret: string,
  currentGeneration?: string
): { status: 200; uid: string } | { status: 401; error: string } {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { status: 401, error: "Unauthorized: Missing or invalid Authorization header." };
  }
  const verified = verifySessionToken(secret, token, currentGeneration);
  if (!verified.ok) {
    return { status: 401, error: "Unauthorized: Invalid or expired authentication token." };
  }
  return { status: 200, uid: verified.payload.uid || verified.payload.userId };
}
