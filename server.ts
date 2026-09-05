import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dns from "dns";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import nodemailer from "nodemailer";
import bcrypt from "bcryptjs";
import { initializeApp, getApps, getApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { GoogleAuth } from "google-auth-library";
import { commitMaterialMovementTx, nextStatusOnAccept, SimpleStore, applyAcceptanceDepartment, clearPendingOutbound } from "./src/hardening/commitMaterialMovement";
import { resolveExistingJobCardDocId } from "./src/hardening/departmentWorkbench";
import { assertSessionSecretSafe, createSessionToken, verifySessionToken, isValidFourDigitPin, extractBearerToken, requireUserPin } from "./src/hardening/hmacSession";
import { operationalCollectionsForFactoryReset, isProtectedSuperAdmin, shouldDeleteUserOnFactoryReset } from "./src/hardening/factoryResetPolicy";
import {
  assertProcessTransferTransition,
  formatStpNumber,
  initialProcessTransferStatus,
  nextStatusForAction,
  ProcessKind
} from "./src/hardening/processTransferMachine";
import { INVENTORY_RAW_MATERIALS_SEED, mergeCreateIfMissing, seedToMasterDoc } from "./src/hardening/rmSkuMaster";
import { persistExclusive } from "./src/hardening/exclusivePersist";

// Force IPv4 first to prevent dual-stack DNS timeout issues in Node.js fetch
dns.setDefaultResultOrder("ipv4first");

// Read Firebase applet configuration for Admin SDK
let firebaseConfig: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch (e) {
  console.warn("Could not read firebase-applet-config.json:", e);
}

const firebaseProjectId = firebaseConfig?.projectId || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || "my-project-9ca72";
const firestoreDbId = firebaseConfig?.firestoreDatabaseId || "(default)";

// Guard against unhandled background async rejections
process.on('unhandledRejection', (reason: any) => {
  console.warn('[Server Warning] Caught background async rejection:', reason?.message || reason);
});

let adminApp: any = null;
let firestoreAdminDb: any = null;

function getFirestoreAdmin() {
  if (!firestoreAdminDb) {
    try {
      if (getApps().length === 0) {
        try {
          adminApp = initializeApp({
            credential: applicationDefault(),
            projectId: firebaseProjectId,
          });
        } catch (_) {
          adminApp = initializeApp({
            projectId: firebaseProjectId,
          });
        }
      } else {
        adminApp = getApp();
      }
      firestoreAdminDb = firestoreDbId && firestoreDbId !== "(default)"
        ? getFirestore(adminApp, firestoreDbId)
        : getFirestore(adminApp);
      try {
        firestoreAdminDb.settings({ ignoreUndefinedProperties: true });
      } catch (_) {}
    } catch (err: any) {
      console.warn("[Firebase Admin] Initialization note:", err?.message || err);
      return null;
    }
  }
  return firestoreAdminDb;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  // High-performance gzip/deflate response compression (saves 70%+ bandwidth)
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    }
  }));

  // Hardened Production CORS Middleware with explicit trusted origin allowlist
  const ALLOWED_ORIGINS = [
    "https://pmw-tracker-928410476586.asia-south1.run.app",
    "https://my-project-9ca72.web.app",
    "https://my-project-9ca72.firebaseapp.com",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost"
  ];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.endsWith(".run.app") ||
        origin.endsWith(".web.app");

      if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
    } else {
      // Direct API requests (native Android mobile app, curl, server-to-server)
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Helper to parse Firestore REST format to JS objects
  function parseFirestoreFields(fields: any): any {
    if (!fields || typeof fields !== "object") return fields;
    const result: any = {};
    for (const key of Object.keys(fields)) {
      const val = fields[key];
      if (val.stringValue !== undefined) result[key] = val.stringValue;
      else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
      else if (val.doubleValue !== undefined) result[key] = Number(val.doubleValue);
      else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
      else if (val.nullValue !== undefined) result[key] = null;
      else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
      else if (val.arrayValue !== undefined) {
        result[key] = (val.arrayValue.values || []).map((v: any) => parseFirestoreFields({ v }).v);
      } else if (val.mapValue !== undefined) {
        result[key] = parseFirestoreFields(val.mapValue.fields || {});
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  function encodeFirestoreFields(data: any): any {
    const fields: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v === null) fields[k] = { nullValue: null };
      else if (typeof v === "string") fields[k] = { stringValue: v };
      else if (typeof v === "number") {
        if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
        else fields[k] = { doubleValue: v };
      }
      else if (typeof v === "boolean") fields[k] = { booleanValue: v };
      else if (Array.isArray(v)) {
        fields[k] = { arrayValue: { values: v.map((item: any) => encodeFirestoreFields({ item }).item) } };
      }
      else if (typeof v === "object") {
        fields[k] = { mapValue: { fields: encodeFirestoreFields(v) } };
      }
    }
    return fields;
  }

  let gcpAuthClient: GoogleAuth | null = null;
  async function getGcpAccessToken(): Promise<string | null> {
    try {
      if (!gcpAuthClient) {
        gcpAuthClient = new GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/datastore", "https://www.googleapis.com/auth/cloud-platform"]
        });
      }
      const directToken = await gcpAuthClient.getAccessToken();
      if (typeof directToken === "string" && directToken.length > 10) return directToken;
      const client = await gcpAuthClient.getClient();
      const tokenRes: any = await client.getAccessToken();
      if (typeof tokenRes === "string") return tokenRes;
      if (tokenRes && typeof tokenRes.token === "string") return tokenRes.token;
      return null;
    } catch (_) {
      return null;
    }
  }

  function buildFirestoreRestUrl(docPath: string, hasGcpToken: boolean, queryParams: Record<string, string> = {}): string {
    const apiKey = firebaseConfig?.apiKey || "";
    const projId = firebaseProjectId;
    const dbId = firestoreDbId;
    const params = new URLSearchParams();
    if (!hasGcpToken && apiKey) {
      params.append("key", apiKey);
    }
    for (const [k, v] of Object.entries(queryParams)) {
      params.append(k, v);
    }
    const qs = params.toString();
    return `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents${docPath}${qs ? `?${qs}` : ""}`;
  }

  async function firestoreRestGetDoc(collectionName: string, docId: string): Promise<any> {
    try {
      const gcpToken = await getGcpAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;
      const url = buildFirestoreRestUrl(`/${collectionName}/${encodeURIComponent(docId)}`, Boolean(gcpToken));

      const res = await fetch(url, { headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      if (!data || !data.fields) return null;
      const parsed = parseFirestoreFields(data.fields);
      return { id: docId, ...parsed };
    } catch (err: any) {
      return null;
    }
  }

  async function firestoreRestQuery(collectionName: string, field: string, value: string): Promise<any> {
    try {
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: collectionName }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: "EQUAL",
              value: { stringValue: value }
            }
          },
          limit: 1
        }
      };
      const gcpToken = await getGcpAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;
      const url = buildFirestoreRestUrl(`:runQuery`, Boolean(gcpToken));

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(queryBody)
      });
      if (!res.ok) return null;
      const results = await res.json();
      if (Array.isArray(results) && results[0] && results[0].document && results[0].document.fields) {
        const docName = results[0].document.name || "";
        const docId = docName.split("/").pop() || "";
        const parsed = parseFirestoreFields(results[0].document.fields);
        return { id: docId, ...parsed };
      }
      return null;
    } catch (err: any) {
      return null;
    }
  }

  async function firestoreRestQueryAll(collectionName: string): Promise<any[]> {
    const gcpToken = await getGcpAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;

    // 1. Try simple collection list (documents endpoint with pageSize=300)
    try {
      const listUrl = buildFirestoreRestUrl(`/${collectionName}`, Boolean(gcpToken), { pageSize: "300" });
      const listRes = await fetch(listUrl, { headers });
      if (listRes.ok) {
        const listData: any = await listRes.json();
        if (Array.isArray(listData.documents)) {
          const results: any[] = [];
          for (const doc of listData.documents) {
            if (doc.fields) {
              const parsed = parseFirestoreFields(doc.fields);
              const docName = doc.name || "";
              const docId = docName.split("/").pop() || "";
              if (parsed) {
                results.push({ id: docId, userId: parsed.userId || docId, ...parsed });
              }
            }
          }
          if (results.length > 0) return results;
        }
      }
    } catch (_) {}

    // 2. Fallback to runQuery
    try {
      const runQueryUrl = buildFirestoreRestUrl(`:runQuery`, Boolean(gcpToken));
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: collectionName }]
        }
      };
      const res = await fetch(runQueryUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(queryBody)
      });
      if (res.ok) {
        const rawDocs = await res.json().catch(() => []);
        const results: any[] = [];
        if (Array.isArray(rawDocs)) {
          for (const r of rawDocs) {
            if (r.document && r.document.fields) {
              const parsed = parseFirestoreFields(r.document.fields);
              const docName = r.document.name || "";
              const docId = docName.split("/").pop() || "";
              if (parsed) {
                results.push({ id: docId, userId: parsed.userId || docId, ...parsed });
              }
            }
          }
        }
        return results;
      }
    } catch (_) {}

    return [];
  }

  async function firestoreRestSetDoc(collectionName: string, docId: string, data: any): Promise<boolean> {
    try {
      const encodedFields = encodeFirestoreFields(data);
      const gcpToken = await getGcpAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;
      const url = buildFirestoreRestUrl(`/${collectionName}/${encodeURIComponent(docId)}`, Boolean(gcpToken));

      const res = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ fields: encodedFields })
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  async function firestoreRestDeleteDoc(collectionName: string, docId: string): Promise<boolean> {
    try {
      const gcpToken = await getGcpAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;
      const url = buildFirestoreRestUrl(`/${collectionName}/${encodeURIComponent(docId)}`, Boolean(gcpToken));

      const res = await fetch(url, { method: "DELETE", headers });
      return res.ok || res.status === 404;
    } catch (err) {
      return false;
    }
  }

  async function persistDocsExclusive(
    docs: Array<{ collection: string; id: string; data: any }>
  ): Promise<{ wroteViaAdmin: boolean }> {
    const db = getFirestoreAdmin();
    if (db) {
      try {
        const batch = db.batch();
        for (const d of docs) {
          batch.set(db.collection(d.collection).doc(d.id), d.data);
        }
        await batch.commit();
        return { wroteViaAdmin: true };
      } catch (err: any) {
        console.warn("[PERSIST] Admin SDK write failed, using REST fallback:", err?.message || err);
      }
    }
    await Promise.all(docs.map((d) => firestoreRestSetDoc(d.collection, d.id, d.data)));
    return { wroteViaAdmin: false };
  }

  function createFirestoreSimpleStore(): SimpleStore {
    return {
      async get(collection: string, id: string) {
        const db = getFirestoreAdmin();
        if (db) {
          try {
            const snap = await db.collection(collection).doc(id).get();
            if (snap.exists) return snap.data();
          } catch (_) {}
        }
        return firestoreRestGetDoc(collection, id);
      },
      async set(collection: string, id: string, data: any) {
        await persistDocsExclusive([{ collection, id, data }]);
      },
      async list(collection: string) {
        const db = getFirestoreAdmin();
        if (db) {
          try {
            const snap = await db.collection(collection).limit(500).get();
            return snap.docs.map((d: any) => d.data());
          } catch (_) {}
        }
        const rest = await firestoreRestQueryAll(collection);
        return Array.isArray(rest) ? rest : [];
      }
    };
  }

  const SESSION_SECRET = assertSessionSecretSafe(process.env.SESSION_SECRET, process.env.NODE_ENV);

  // ----------------------------------------------------
  // SYSTEM STATE & RESET GENERATION (ANTI-RESURRECTION)
  // ----------------------------------------------------
  let currentResetGeneration = "gen-initial";

  async function initSystemState(): Promise<string> {
    try {
      let stateDoc: any = null;
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const snap = await db.collection("mfr_system_state").doc("global").get();
            if (snap.exists) {
              stateDoc = snap.data();
            }
          }
        } catch (e) {
          }
      }
      if (!stateDoc) {
        stateDoc = await firestoreRestGetDoc("mfr_system_state", "global");
      }

      if (stateDoc && stateDoc.factoryResetGeneration) {
        currentResetGeneration = stateDoc.factoryResetGeneration;
        console.log(`[SYSTEM] Loaded factory reset generation: ${currentResetGeneration}`);
        return currentResetGeneration;
      }

      currentResetGeneration = `gen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const payload = {
        factoryResetGeneration: currentResetGeneration,
        resetAt: new Date().toISOString(),
        resetBy: "system_init",
        resetOpId: "init-0",
        updatedAt: new Date().toISOString()
      };
      await persistExclusive(
        async () => {
          const db = getFirestoreAdmin();
          if (!db) {
            throw new Error("Admin SDK unavailable");
          }
          await db.collection("mfr_system_state").doc("global").set(payload);
        },
        async () => {
          await firestoreRestSetDoc("mfr_system_state", "global", payload);
        }
      ).catch(() => {});
      console.log(`[SYSTEM] Initialized new factory reset generation: ${currentResetGeneration}`);
      return currentResetGeneration;
    } catch (err) {
      console.warn("[SYSTEM] Error initializing system state generation:", err);
      currentResetGeneration = `gen-${Date.now()}`;
      return currentResetGeneration;
    }
  }

  async function updateResetGeneration(resetOpId: string, resetBy: string): Promise<string> {
    const nextGen = `gen-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    currentResetGeneration = nextGen;
    const payload = {
      factoryResetGeneration: nextGen,
      resetAt: new Date().toISOString(),
      resetBy: resetBy || "super_admin",
      resetOpId: resetOpId || `op-${Date.now()}`,
      updatedAt: new Date().toISOString()
    };
    await persistExclusive(
      async () => {
        const db = getFirestoreAdmin();
        if (!db) {
          throw new Error("Admin SDK unavailable");
        }
        await db.collection("mfr_system_state").doc("global").set(payload);
      },
      async () => {
        await firestoreRestSetDoc("mfr_system_state", "global", payload);
      }
    );
    return nextGen;
  }

  // Authoritative in-memory maps for sub-millisecond consistency and zero read-after-write lag
  const inMemoryJobCards = new Map<string, any>();
  const inMemoryMovements = new Map<string, any>();
  const inMemoryDeletedJobCards = new Set<string>();
  // PERSISTENT DELETED-USER TOMBSTONES (ANTI-RESURRECTION)
  // ----------------------------------------------------
  const DELETED_USERS_FILE = path.join(process.cwd(), "deleted_users.json");
  let deletedUserIds = new Set<string>();

  function loadDeletedUsers() {
    try {
      if (fs.existsSync(DELETED_USERS_FILE)) {
        const arr = JSON.parse(fs.readFileSync(DELETED_USERS_FILE, "utf8"));
        if (Array.isArray(arr)) {
          deletedUserIds = new Set(arr.map(id => String(id).toLowerCase().trim()));
        }
      }
    } catch (e) {
      console.warn("Could not load deleted users list:", e);
    }
  }

  function saveDeletedUsers() {
    try {
      fs.writeFileSync(DELETED_USERS_FILE, JSON.stringify(Array.from(deletedUserIds), null, 2), "utf8");
    } catch (e) {
      console.warn("Could not save deleted users list:", e);
    }
  }

  loadDeletedUsers();

  async function isUserTombstoned(userId: string): Promise<boolean> {
    if (!userId || typeof userId !== "string") return false;
    const cleanId = userId.trim();
    const lowerId = cleanId.toLowerCase();

    // 1. Fast in-memory check
    if (deletedUserIds.has(cleanId) || deletedUserIds.has(lowerId)) {
      return true;
    }

    // 2. Authoritative Firestore check
    try {
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const snap = await db.collection("mfr_deleted_users").doc(cleanId).get();
            if (snap.exists) {
              deletedUserIds.add(lowerId);
              return true;
            }
            if (lowerId !== cleanId) {
              const lowerSnap = await db.collection("mfr_deleted_users").doc(lowerId).get();
              if (lowerSnap.exists) {
                deletedUserIds.add(lowerId);
                return true;
              }
            }
          }
        } catch (_) {
          }
      }

      const doc = await firestoreRestGetDoc("mfr_deleted_users", cleanId);
      if (doc && (doc.tombstone || doc.userId)) {
        deletedUserIds.add(lowerId);
        return true;
      }
      if (lowerId !== cleanId) {
        const lowerDoc = await firestoreRestGetDoc("mfr_deleted_users", lowerId);
        if (lowerDoc && (lowerDoc.tombstone || lowerDoc.userId)) {
          deletedUserIds.add(lowerId);
          return true;
        }
      }
    } catch (err) {
      console.warn(`[TOMBSTONE] Error checking tombstone for ${cleanId}:`, err);
    }

    return false;
  }

  async function recordDeletedUserTombstone(userId: string, deletedBy: string): Promise<void> {
    if (!userId || typeof userId !== "string") return;
    const cleanId = userId.trim();
    const lowerId = cleanId.toLowerCase();

    const tombstonePayload = {
      userId: cleanId,
      deletedAt: new Date().toISOString(),
      deletedBy: deletedBy || "admin",
      tombstone: true
    };

    deletedUserIds.add(cleanId);
    deletedUserIds.add(lowerId);
    saveDeletedUsers();

    await persistExclusive(
      async () => {
        const db = getFirestoreAdmin();
        if (!db) {
          throw new Error("Admin SDK unavailable");
        }
        await db.collection("mfr_deleted_users").doc(cleanId).set(tombstonePayload);
        if (lowerId !== cleanId) {
          await db.collection("mfr_deleted_users").doc(lowerId).set(tombstonePayload);
        }
        await db.collection("mfr_users").doc(cleanId).delete();
        await db.collection("mfr_user_credentials").doc(cleanId).delete();
        if (lowerId !== cleanId) {
          await db.collection("mfr_users").doc(lowerId).delete();
          await db.collection("mfr_user_credentials").doc(lowerId).delete();
        }
      },
      async () => {
        await firestoreRestSetDoc("mfr_deleted_users", cleanId, tombstonePayload);
        if (lowerId !== cleanId) {
          await firestoreRestSetDoc("mfr_deleted_users", lowerId, tombstonePayload);
        }
        await firestoreRestDeleteDoc("mfr_users", cleanId);
        await firestoreRestDeleteDoc("mfr_user_credentials", cleanId);
        if (lowerId !== cleanId) {
          await firestoreRestDeleteDoc("mfr_users", lowerId);
          await firestoreRestDeleteDoc("mfr_user_credentials", lowerId);
        }
      }
    ).catch(() => {});

    for (const k of Object.keys(customUsersStore)) {
      const u = customUsersStore[k];
      if (k.toLowerCase().trim() === lowerId || u?.userId?.toLowerCase()?.trim() === lowerId) {
        delete customUsersStore[k];
      }
    }
    saveUsersStore();

    for (const k of Object.keys(customCredsStore)) {
      if (k.toLowerCase().trim() === lowerId) {
        delete customCredsStore[k];
      }
    }
    saveCredsStore();

    cachedUsersDirectory = null;
  }

  const USERS_STORE_FILE = path.join(process.cwd(), "users_store.json");
  let customUsersStore: Record<string, any> = {};

  function loadUsersStore() {
    try {
      if (fs.existsSync(USERS_STORE_FILE)) {
        customUsersStore = JSON.parse(fs.readFileSync(USERS_STORE_FILE, "utf8")) || {};
      }
    } catch (e) {
      console.warn("Could not load custom users store:", e);
    }
  }

  function saveUsersStore() {
    try {
      fs.writeFileSync(USERS_STORE_FILE, JSON.stringify(customUsersStore, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not save custom users store:", e);
    }
  }

  loadUsersStore();

  const CREDS_STORE_FILE = path.join(process.cwd(), "creds_store.json");
  let customCredsStore: Record<string, string> = {};

  function loadCredsStore() {
    try {
      if (fs.existsSync(CREDS_STORE_FILE)) {
        customCredsStore = JSON.parse(fs.readFileSync(CREDS_STORE_FILE, "utf8")) || {};
      }
    } catch (e) {
      console.warn("Could not load custom creds store:", e);
    }
  }

  function saveCredsStore() {
    try {
      fs.writeFileSync(CREDS_STORE_FILE, JSON.stringify(customCredsStore, null, 2), "utf8");
    } catch (e) {
      console.warn("Could not save custom creds store:", e);
    }
  }

  loadCredsStore();

  // ----------------------------------------------------
  // REAL-TIME SERVER-SENT EVENTS (SSE) BROADCAST SYSTEM
  // ----------------------------------------------------
  const sseClients = new Set<express.Response>();

  function broadcastRealtimeEvent(eventType: string, payload?: any) {
    const msg = `data: ${JSON.stringify({ type: eventType, payload, timestamp: Date.now() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch (_) {
        sseClients.delete(client);
      }
    }
  }

  // GET /api/events - Real-time SSE stream for instant cross-device updates
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "CONNECTED", timestamp: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch (_) {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // POST /api/events/broadcast - Broadcast state changes from any connected client
  app.post("/api/events/broadcast", requireFirebaseAuth, (req, res) => {
    const { type, payload } = req.body || {};
    if (type) {
      broadcastRealtimeEvent(type, payload);
    }
    return res.json({ success: true });
  });

  // Standard Production Health Check Endpoints
  const handleHealthCheck = async (req: express.Request, res: express.Response) => {
    return res.json({
      success: true,
      status: "healthy",
      service: "pmw-tracker",
      version: "1.0.53",
      region: "asia-south1",
      firestore: "reachable",
      factoryResetGeneration: currentResetGeneration,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  };

  app.get("/health", handleHealthCheck);
  app.get("/api/health", handleHealthCheck);
  app.get("/health/live", handleHealthCheck);
  app.get("/health/ready", handleHealthCheck);

  // GET /api/system/state - Public/Client state inspection (reset generation & user count)
  app.get("/api/system/state", async (req, res) => {
    try {
      let activeCount = 0;
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const snap = await db.collection("mfr_users").get();
            const activeDocs = snap.docs.filter((d: any) => {
              const data = d.data();
              const docUid = (data?.userId || d.id || "").toLowerCase().trim();
              if (deletedUserIds.has(docUid)) return false;
              return data && data.active !== false && data.status !== 'deleted' && !data.deletedAt;
            });
            activeCount = activeDocs.length;
          }
        } catch (_) {}
      }
      if (activeCount === 0) {
        const restUsers = await firestoreRestQueryAll("mfr_users");
        const activeDocs = restUsers.filter((u: any) => {
          const docUid = (u?.userId || u?.id || "").toLowerCase().trim();
          if (deletedUserIds.has(docUid)) return false;
          return u && u.active !== false && u.status !== 'deleted' && !u.deletedAt;
        });
        activeCount = activeDocs.length;
      }
      return res.json({
        success: true,
        factoryResetGeneration: currentResetGeneration,
        activeUsersCount: activeCount,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/system/raw-users - Diagnostic inspection of persistent Firestore user records (Admin only)
  app.get("/api/system/raw-users", requireFirebaseAuth, async (req, res) => {
    try {
      const requester = (req as any).user;
      const role = String(requester?.role || "").toLowerCase();
      const dept = String(requester?.department || "").toLowerCase();
      if (role !== "super_admin" && role !== "admin" && dept !== "admin" && dept !== "management") {
        return res.status(403).json({ success: false, error: "Forbidden: Admin access required." });
      }

      let docs: any[] = [];
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const snap = await db.collection("mfr_users").get();
            docs = snap.docs.map(d => ({ id: d.id, userId: d.data()?.userId, name: d.data()?.name, role: d.data()?.role, active: d.data()?.active }));
          }
        } catch (_) {}
      }
      if (docs.length === 0) {
        docs = await firestoreRestQueryAll("mfr_users");
      }
      return res.json({ success: true, count: docs.length, users: docs, deletedIds: Array.from(deletedUserIds) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper to issue authentic Firebase Auth Custom Token or signed session token
  async function issueAuthToken(uid: string): Promise<string> {
    if (!uid || typeof uid !== "string" || !uid.trim()) {
      throw new Error("Invalid UID: A valid user ID is required to create an auth token.");
    }
    const cleanUid = uid.trim();

    return createSessionToken(SESSION_SECRET, cleanUid, currentResetGeneration, 24 * 3600 * 1000);
  }

  // Authoritative user profile and credentials lookup via Firebase Admin SDK with REST fallback
  async function findUserAndCreds(searchKey: string): Promise<{ user: any; pinHash: string } | null> {
    const cleanKey = searchKey.trim();
    if (!cleanKey) return null;

    let user: any = null;
    let uid: string = "";
    let pinHash: string = "";

    // 0. Instant lookup in customUsersStore
    const lowerKey = cleanKey.toLowerCase();
    for (const [id, u] of Object.entries(customUsersStore)) {
      const udata = u as any;
      if (
        id.toLowerCase() === lowerKey ||
        udata?.userId?.toLowerCase() === lowerKey ||
        udata?.name?.toLowerCase() === lowerKey ||
        udata?.email?.toLowerCase() === lowerKey
      ) {
        user = udata;
        uid = udata?.userId || id;
        break;
      }
    }

    if (uid && customCredsStore[uid]) {
      pinHash = customCredsStore[uid];
    }

    // 1. Try Firebase Admin SDK if permission is available
    if (true) {
      try {
        const db = getFirestoreAdmin();
        if (db) {
          // Direct document ID lookup in mfr_users/{cleanKey}
          const docSnap = await db.collection("mfr_users").doc(cleanKey).get();
          if (docSnap.exists) {
            user = docSnap.data();
            uid = docSnap.id;
          }

          // Query by userId
          if (!user) {
            const qSnap = await db.collection("mfr_users").where("userId", "==", cleanKey).limit(1).get();
            if (!qSnap.empty) {
              user = qSnap.docs[0].data();
              uid = qSnap.docs[0].id;
            }
          }

          // Query by exact name
          if (!user) {
            const qSnap = await db.collection("mfr_users").where("name", "==", cleanKey).get();
            if (!qSnap.empty) {
              for (const d of qSnap.docs) {
                const candUser = d.data();
                const candUid = candUser.userId || d.id;
                const cSnap = await db.collection("mfr_user_credentials").doc(candUid).get();
                if (cSnap.exists && cSnap.data()?.pinHash) {
                  user = candUser;
                  uid = candUid;
                  pinHash = cSnap.data()?.pinHash;
                  break;
                }
                if (candUser.pinHash) {
                  user = candUser;
                  uid = candUid;
                  pinHash = candUser.pinHash;
                  break;
                }
              }
              if (!user) {
                user = qSnap.docs[0].data();
                uid = user.userId || qSnap.docs[0].id;
              }
            }
          }

          // Query by email
          if (!user) {
            const qSnap = await db.collection("mfr_users").where("email", "==", cleanKey).limit(1).get();
            if (!qSnap.empty) {
              user = qSnap.docs[0].data();
              uid = user.userId || qSnap.docs[0].id;
            }
          }

          // Case-insensitive name match via Admin SDK
          if (!user) {
            const allUsersSnap = await db.collection("mfr_users").get();
            const targetLower = cleanKey.toLowerCase();
            const matches = allUsersSnap.docs.filter((doc: any) => {
              const data = doc.data();
              return data && typeof data.name === "string" && String(data.name).trim().toLowerCase() === targetLower;
            });

            for (const m of matches) {
              const mData = m.data();
              const mUid = mData.userId || m.id;
              const cSnap = await db.collection("mfr_user_credentials").doc(mUid).get();
              if (cSnap.exists && cSnap.data()?.pinHash) {
                user = mData;
                uid = mUid;
                pinHash = cSnap.data()?.pinHash;
                break;
              }
              if (mData.pinHash) {
                user = mData;
                uid = mUid;
                pinHash = mData.pinHash;
                break;
              }
            }

            if (!user && matches.length > 0) {
              user = matches[0].data();
              uid = user.userId || matches[0].id;
            }
          }

          if (user && uid && !pinHash) {
            const credSnap = await db.collection("mfr_user_credentials").doc(uid).get();
            if (credSnap.exists) {
              pinHash = credSnap.data()?.pinHash || "";
            }
          }
        }
      } catch (adminErr: any) {
        console.warn("[AUTH] Admin SDK lookup unavailable, switching to Firestore REST API:", adminErr?.message || adminErr);
        }
    }

    // 2. Fallback to Firestore REST API if Admin SDK was unavailable or returned permission error
    if (!user) {
      user = await firestoreRestGetDoc("mfr_users", cleanKey);
      if (user) {
        uid = user.userId || cleanKey;
      }

      if (!user) {
        user = await firestoreRestQuery("mfr_users", "userId", cleanKey);
        if (user) uid = user.userId || user.id;
      }

      if (!user) {
        user = await firestoreRestQuery("mfr_users", "name", cleanKey);
        if (user) uid = user.userId || user.id;
      }

      if (!user) {
        user = await firestoreRestQuery("mfr_users", "email", cleanKey);
        if (user) uid = user.userId || user.id;
      }

      if (!user) {
        try {
          const apiKey = firebaseConfig?.apiKey || "";
          const projId = firebaseProjectId;
          const dbId = firestoreDbId;
          const url = `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
          const qRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "mfr_users" }] } })
          });
          if (qRes.ok) {
            const rawDocs = await qRes.json();
            if (Array.isArray(rawDocs)) {
              const targetLower = cleanKey.toLowerCase();
              for (const r of rawDocs) {
                if (r.document && r.document.fields) {
                  const parsed = parseFirestoreFields(r.document.fields);
                  if (parsed && typeof parsed.name === "string" && parsed.name.trim().toLowerCase() === targetLower) {
                    const docName = r.document.name || "";
                    const docId = docName.split("/").pop() || "";
                    user = parsed;
                    uid = parsed.userId || docId;
                    break;
                  }
                }
              }
            }
          }
        } catch (e) {}
      }

      if (!user) {
        const lower = cleanKey.toLowerCase();
        for (const [id, u] of Object.entries(customUsersStore)) {
          const udata = u as any;
          if (
            id.toLowerCase() === lower ||
            udata?.userId?.toLowerCase() === lower ||
            udata?.name?.toLowerCase() === lower ||
            udata?.email?.toLowerCase() === lower
          ) {
            user = udata;
            uid = udata?.userId || id;
            break;
          }
        }
      }
    }

    if (!user || !uid) {
      return null;
    }

    if (deletedUserIds.has(String(uid).toLowerCase().trim())) {
      return null;
    }

    // Look up PIN hash in credentials store if not already obtained
    if (!pinHash) {
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const credSnap = await db.collection("mfr_user_credentials").doc(uid).get();
            if (credSnap.exists) {
              pinHash = credSnap.data()?.pinHash || "";
            }
          }
        } catch (_) {}
      }
    }

    if (!pinHash) {
      const credDoc = await firestoreRestGetDoc("mfr_user_credentials", uid);
      if (credDoc && credDoc.pinHash) {
        pinHash = credDoc.pinHash;
      }
    }

    // Also check legacy or root pinHash if credential document is pending migration
    if (!pinHash && user.pinHash) {
      pinHash = user.pinHash;
    }

    if (!pinHash || typeof pinHash !== "string" || !pinHash.trim()) {
      pinHash = "";
    }

    console.info("[AUTH] User profile located for:", user.name || uid);

    // Sanitize user object: Ensure no credential fields exist in the user profile
    const sanitizedUser = { ...user, userId: uid };
    delete sanitizedUser.pinHash;
    delete sanitizedUser.pin;
    delete sanitizedUser.password;

    return { user: sanitizedUser, pinHash: pinHash.trim() };
  }

  // ----------------------------------------------------
  // STRICT AUTHORITATIVE FIREBASE AUTHENTICATION MIDDLEWARE
  // ----------------------------------------------------
  async function requireFirebaseAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const token = extractBearerToken(req.headers.authorization as string);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: Missing or invalid Authorization header."
        });
      }

      let decodedUid: string | null = null;
      let tokenGeneration: string | null = null;
      let verifiedSessionPayload: any = null;

      // 1. Try Firebase Admin ID Token verification if available
      if (true) {
        try {
          if (!adminApp) {
            getFirestoreAdmin();
          }
          if (adminApp) {
            const decoded = await getAdminAuth(adminApp).verifyIdToken(token);
            if (decoded && decoded.uid) {
              decodedUid = decoded.uid;
            }
          }
        } catch (authErr: any) {
          // Not a standard Firebase Admin ID token, try signed session token
        }
      }

      // 2. Try signed session token verification
      if (!decodedUid) {
        const verified = verifySessionToken(SESSION_SECRET, token, currentResetGeneration);
        if (verified.ok) {
          decodedUid = verified.payload.uid || verified.payload.userId;
          tokenGeneration = verified.payload.gen || null;
          verifiedSessionPayload = verified.payload;
        }
      }

      if (!decodedUid) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: Invalid or expired authentication token."
        });
      }

      // Check factory reset generation: immediately reject tokens from older generations
      if (tokenGeneration && currentResetGeneration && tokenGeneration !== currentResetGeneration) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: Session invalidated by factory reset."
        });
      }

      // Check tombstone: block deleted users
      if (await isUserTombstoned(decodedUid)) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: User account has been permanently deleted."
        });
      }

      let userData: any = null;

      // 1. Try Admin SDK
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const userSnap = await db.collection("mfr_users").doc(decodedUid).get();
            if (userSnap.exists) {
              userData = userSnap.data();
            }
          }
        } catch (e) {
          }
      }

      // 2. Fallback to Firestore REST
      if (!userData) {
        userData = await firestoreRestGetDoc("mfr_users", decodedUid);
      }
      if (!userData) {
        const qRes = await firestoreRestQuery("mfr_users", "userId", decodedUid);
        if (qRes) userData = qRes;
      }
      if (!userData) {
        userData = customUsersStore[decodedUid] || Object.values(customUsersStore).find((u: any) => u?.userId?.toLowerCase() === decodedUid?.toLowerCase());
      }

      // 3. Fallback to verified HMAC session token payload
      if (!userData && verifiedSessionPayload && verifiedSessionPayload.department) {
        userData = {
          userId: decodedUid,
          name: verifiedSessionPayload.name || decodedUid,
          department: verifiedSessionPayload.department || "Production",
          role: verifiedSessionPayload.role || "staff",
          allowedDepartments: verifiedSessionPayload.allowedDepartments || [verifiedSessionPayload.department],
          accessList: verifiedSessionPayload.accessList || [],
          active: true
        };
      }

      if (!userData) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: User profile does not exist in system database."
        });
      }

      if (userData.active === false || userData.status === "inactive" || userData.status === "deactivated") {
        return res.status(403).json({
          success: false,
          error: "Forbidden: User account is inactive or deactivated."
        });
      }

      const sanitizedUser: any = {
        userId: userData.userId || decodedUid,
        name: userData.name || "",
        email: userData.email || "",
        role: userData.role || "staff",
        department: userData.department || "Production",
        allowedDepartments: Array.isArray(userData.allowedDepartments) ? userData.allowedDepartments : [],
        accessList: Array.isArray(userData.accessList) ? userData.accessList : [],
        canOutsource: Boolean(userData.canOutsource),
        active: true,
        createdAt: userData.createdAt || new Date().toISOString(),
        updatedAt: userData.updatedAt || new Date().toISOString()
      };
      delete sanitizedUser.pinHash;
      delete sanitizedUser.pin;
      delete sanitizedUser.password;
      delete sanitizedUser.credentials;

      (req as any).user = sanitizedUser;
      (req as any).authUid = decodedUid;

      next();
    } catch (err: any) {
      console.error("[AUTH] requireFirebaseAuth middleware error:", err);
      return res.status(500).json({
        success: false,
        error: "Internal Server Error: Authentication verification failed."
      });
    }
  }

  app.get("/api/auth/session", requireFirebaseAuth, async (req, res) => {
    const user = (req as any).user;
    const authUid = (req as any).authUid;
    return res.json({
      success: true,
      user,
      authUid,
      factoryResetGeneration: currentResetGeneration
    });
  });

  // ----------------------------------------------------
  // SERVER-SIDE BRUTE-FORCE RATE LIMITING & LOCKOUT
  // ----------------------------------------------------
  interface LoginAttemptRecord {
    count: number;
    firstAttempt: number;
    lastAttempt: number;
    lockedUntil: number;
  }

  const loginAttempts = new Map<string, LoginAttemptRecord>();
  const MAX_ACCOUNT_FAILED_ATTEMPTS = 5;
  const MAX_IP_FAILED_ATTEMPTS = 25;
  const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes sliding window
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

  // Periodic garbage collection for expired rate limit records
  setInterval(() => {
    const now = Date.now();
    for (const [key, rec] of loginAttempts.entries()) {
      if (now > rec.lockedUntil && now - rec.lastAttempt > ATTEMPT_WINDOW_MS) {
        loginAttempts.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  function getClientIp(req: express.Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown-ip';
  }

  function checkLoginRateLimit(identifier: string, ip: string): { isLocked: boolean; remainingLockMs?: number } {
    const now = Date.now();
    const cleanId = identifier.toLowerCase().trim();
    
    // 1. Check account lockout (5 failed attempts)
    const accountRec = loginAttempts.get(`account:${cleanId}`);
    if (accountRec && accountRec.lockedUntil > now) {
      return { isLocked: true, remainingLockMs: accountRec.lockedUntil - now };
    }

    // 2. Check IP lockout (25 failed attempts)
    const ipRec = loginAttempts.get(`ip:${ip}`);
    if (ipRec && ipRec.lockedUntil > now) {
      return { isLocked: true, remainingLockMs: ipRec.lockedUntil - now };
    }

    return { isLocked: false };
  }

  function recordFailedLoginAttempt(identifier: string, ip: string) {
    const now = Date.now();
    const cleanId = identifier.toLowerCase().trim();

    // Track account failed attempts
    const accKey = `account:${cleanId}`;
    const accRec = loginAttempts.get(accKey);
    if (!accRec || now - accRec.firstAttempt > ATTEMPT_WINDOW_MS) {
      loginAttempts.set(accKey, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
        lockedUntil: 0
      });
    } else {
      accRec.count += 1;
      accRec.lastAttempt = now;
      if (accRec.count >= MAX_ACCOUNT_FAILED_ATTEMPTS) {
        accRec.lockedUntil = now + LOCKOUT_DURATION_MS;
      }
      loginAttempts.set(accKey, accRec);
    }

    // Track IP failed attempts
    const ipKey = `ip:${ip}`;
    const ipRec = loginAttempts.get(ipKey);
    if (!ipRec || now - ipRec.firstAttempt > ATTEMPT_WINDOW_MS) {
      loginAttempts.set(ipKey, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
        lockedUntil: 0
      });
    } else {
      ipRec.count += 1;
      ipRec.lastAttempt = now;
      if (ipRec.count >= MAX_IP_FAILED_ATTEMPTS) {
        ipRec.lockedUntil = now + LOCKOUT_DURATION_MS;
      }
      loginAttempts.set(ipKey, ipRec);
    }
  }

  function clearLoginAttempts(identifier: string, ip: string) {
    const cleanId = identifier.toLowerCase().trim();
    loginAttempts.delete(`account:${cleanId}`);
  }

  // ----------------------------------------------------
  // SECURE AUTHENTICATION & CREDENTIAL ENDPOINTS
  // ----------------------------------------------------

  // POST /api/auth/login — Authoritative login with brute-force protection and generic responses
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { name, userId, pin } = req.body || {};
      const clientIp = getClientIp(req);

      if (!pin || typeof pin !== "string") {
        return res.status(400).json({ success: false, error: "Security PIN is required." });
      }

      const cleanPin = pin.trim();
      const searchKey = (userId || name || "").trim();

      if (!searchKey) {
        return res.status(400).json({ success: false, error: "User Name or ID is required." });
      }

      // 1. Rate Limit & Lockout Check BEFORE expensive processing
      const rateLimitStatus = checkLoginRateLimit(searchKey, clientIp);
      if (rateLimitStatus.isLocked) {
        const minutesLeft = Math.ceil((rateLimitStatus.remainingLockMs || LOCKOUT_DURATION_MS) / 60000);
        console.warn(`[AUTH_RATE_LIMIT] Blocked login attempt for ${searchKey} from IP ${clientIp} (${minutesLeft}m remaining)`);
        return res.status(429).json({
          success: false,
          error: `Too many failed login attempts. Account/IP temporarily locked. Please try again after ${minutesLeft} minute(s).`,
          locked: true,
          retryAfterMinutes: minutesLeft
        });
      }

      // Generic error response to prevent user and credential enumeration
      const GENERIC_AUTH_ERROR = "Invalid username, User ID, or Security PIN.";

      // 2. Locate user profile and credential hash authoritatively
      const lookup = await findUserAndCreds(searchKey);
      if (!lookup || !lookup.user) {
        recordFailedLoginAttempt(searchKey, clientIp);
        await new Promise(r => setTimeout(r, 200));
        return res.status(401).json({ success: false, error: GENERIC_AUTH_ERROR });
      }

      const userData = lookup.user;
      const targetPinHash = lookup.pinHash;

      // 3. Active status verification
      if (userData.active === false || userData.status === "inactive" || userData.status === "deactivated") {
        recordFailedLoginAttempt(searchKey, clientIp);
        await new Promise(r => setTimeout(r, 200));
        return res.status(401).json({ success: false, error: GENERIC_AUTH_ERROR });
      }

      // 4. Verify PIN with bcrypt
      let isMatch = false;
      if (targetPinHash) {
        isMatch = await bcrypt.compare(cleanPin, targetPinHash).catch(() => false);
      }

      if (!isMatch) {
        recordFailedLoginAttempt(searchKey, clientIp);
        await new Promise(r => setTimeout(r, 200));
        return res.status(401).json({ success: false, error: GENERIC_AUTH_ERROR });
      }

      // 5. Successful authentication -> Clear failed attempt counter for account and IP
      clearLoginAttempts(searchKey, clientIp);
      if (userData.userId) clearLoginAttempts(userData.userId, clientIp);
      if (userData.name) clearLoginAttempts(userData.name, clientIp);

      // 6. Issue authentic session token
      const sessionToken = await issueAuthToken(userData.userId);

      // 7. Return sanitized profile (NEVER return pinHash, password, or credentials)
      return res.json({
        success: true,
        token: sessionToken,
        sessionToken,
        customToken: sessionToken,
        user: {
          userId: userData.userId,
          name: userData.name || "",
          email: userData.email || "",
          role: userData.role || "staff",
          department: userData.department || "Production",
          allowedDepartments: userData.allowedDepartments || [],
          accessList: userData.accessList || [],
          canOutsource: userData.canOutsource || false,
          active: true,
          status: "active",
          createdAt: userData.createdAt || new Date().toISOString(),
          updatedAt: userData.updatedAt || new Date().toISOString()
        },
        message: "Authenticated successfully"
      });
    } catch (err: any) {
      console.error("[AUTH] Login error:", err);
      return res.status(503).json({
        success: false,
        error: "Authentication service is temporarily unavailable. Please try again."
      });
    }
  });

  // POST /api/users/:userId/set-pin — Authenticated PIN creation/update with Admin SDK & REST fallback
  app.post("/api/users/:userId/set-pin", requireFirebaseAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const { pin } = req.body;
      const requester = (req as any).user;
      const authUid = (req as any).authUid;

      if (!pin || typeof pin !== "string" || pin.trim().length !== 4) {
        return res.status(400).json({ success: false, error: "A valid 4-digit PIN is required." });
      }

      if (await isUserTombstoned(userId)) {
        return res.status(409).json({ success: false, error: "This user has been permanently deleted and cannot be restored." });
      }

      const isSuperAdmin = requester?.role === "super_admin";
      const isAdmin = requester?.role === "admin";
      const isSelf = requester?.userId === userId || authUid === userId;

      if (!isSuperAdmin && !isAdmin && !isSelf) {
        return res.status(403).json({ success: false, error: "Forbidden: You cannot modify credentials for this account." });
      }

      let existingData: any = null;
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const userDoc = await db.collection("mfr_users").doc(userId).get();
            if (userDoc.exists) existingData = userDoc.data();
          }
        } catch (e) {
          }
      }
      if (!existingData) {
        existingData = await firestoreRestGetDoc("mfr_users", userId);
      }
      if (!existingData) {
        existingData = customUsersStore[userId];
      }

      if (existingData && existingData.role === "super_admin" && !isSuperAdmin) {
        return res.status(403).json({ success: false, error: "Forbidden: Only Super Admins can modify Super Admin credentials." });
      }

      const rawPin = pin.trim();
      const pinHash = await bcrypt.hash(rawPin, 10);

      customCredsStore[userId] = pinHash;
      saveCredsStore();

      await firestoreRestSetDoc("mfr_user_credentials", userId, {
        pinHash,
        updatedAt: new Date().toISOString()
      }).catch(() => {});

      return res.json({ success: true, message: "PIN updated successfully." });
    } catch (err: any) {
      console.error("[AUTH] Error setting PIN:", err);
      return res.status(500).json({ success: false, error: "Failed to update Security PIN." });
    }
  });

  let cachedUsersDirectory: any[] = [];
  let cachedUsersDirectoryTimestamp = 0;
  const USERS_CACHE_TTL = 8000; // 8s fast server cache

  // GET /api/users & GET /api/auth/users — Authenticated user directory endpoint (Protected)
  const handleGetUsers = async (req: express.Request, res: express.Response) => {
    try {
      if (cachedUsersDirectory && cachedUsersDirectory.length > 0 && Date.now() - cachedUsersDirectoryTimestamp < USERS_CACHE_TTL) {
        return res.json({ success: true, users: cachedUsersDirectory });
      }

      let usersList: any[] = [];
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const snap = await db.collection("mfr_users").get();
            usersList = snap.docs.map((doc: any) => ({ ...doc.data(), userId: doc.data()?.userId || doc.id }));
          }
        } catch (e) {
          }
      }

      if (usersList.length === 0) {
        const restResult = await firestoreRestQueryAll("mfr_users");
        if (Array.isArray(restResult)) {
          usersList = restResult;
        }
      }

      for (const [uid, udata] of Object.entries(customUsersStore)) {
        if (!usersList.some(u => u.userId?.toLowerCase() === uid.toLowerCase())) {
          usersList.push(udata);
        }
      }

      const sanitizedUsers = usersList.filter(data => {
        if (!data || !data.userId) return false;
        const uidLower = String(data.userId).toLowerCase().trim();
        if (deletedUserIds.has(uidLower)) return false;
        if (data.active === false || data.status === "deleted" || data.status === "inactive" || data.status === "deactivated" || data.deletedAt) return false;
        return true;
      }).map(data => {
        return {
          userId: data.userId,
          name: data.name || "",
          email: data.email || "",
          role: data.role || "staff",
          department: data.department || "Production",
          allowedDepartments: Array.isArray(data.allowedDepartments) ? data.allowedDepartments : [],
          accessList: Array.isArray(data.accessList) ? data.accessList : [],
          canOutsource: Boolean(data.canOutsource),
          isDepartmentHead: Boolean(data.isDepartmentHead),
          active: data.active !== false && data.status !== "inactive" && data.status !== "deactivated",
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString()
        };
      });

      // Deduplicate by userId
      const userMap = new Map<string, any>();
      for (const u of sanitizedUsers) {
        const key = u.userId.toLowerCase().trim();
        if (!userMap.has(key)) userMap.set(key, u);
      }
      
      const uniqueUsers = Array.from(userMap.values());
      cachedUsersDirectory = uniqueUsers;
      cachedUsersDirectoryTimestamp = Date.now();

      return res.json({ success: true, users: uniqueUsers });
    } catch (err: any) {
      console.error("[AUTH] Error listing users:", err);
      return res.status(500).json({ success: false, error: "Failed to retrieve user directory" });
    }
  };

  app.get("/api/users", requireFirebaseAuth, handleGetUsers);
  app.get("/api/auth/users", requireFirebaseAuth, handleGetUsers);

  // Public login picker (names only). PINs/credentials are never included.
  app.get("/api/auth/login-directory", async (_req, res) => {
    try {
      await handleGetUsers(_req as any, {
        json: (payload: any) => {
          const users = Array.isArray(payload?.users)
            ? payload.users.map((u: any) => ({
                userId: u.userId,
                name: u.name,
                department: u.department,
                role: u.role
              }))
            : [];
          return res.json({ success: true, users });
        },
        status: (code: number) => ({
          json: (payload: any) => res.status(code).json(payload)
        })
      } as any);
    } catch (err: any) {
      return res.status(500).json({ success: false, error: "Failed to load login directory" });
    }
  });

  // POST /api/users — Protected user creation/save endpoint with strict role escalation guard & anti-resurrection
  app.post("/api/users", requireFirebaseAuth, async (req, res) => {
    try {
      const userData = req.body;
      const requester = (req as any).user;

      if (!userData || !userData.userId || !userData.name) {
        return res.status(400).json({ success: false, error: "User ID and Name are required." });
      }

      // Check persistent tombstones
      if (await isUserTombstoned(userData.userId)) {
        return res.status(409).json({
          success: false,
          error: "This user has been permanently deleted and cannot be restored."
        });
      }

      const isSuperAdmin = requester?.role === "super_admin";
      const isAdmin = requester?.role === "admin";

      if (!isSuperAdmin && !isAdmin) {
        return res.status(403).json({ success: false, error: "Forbidden: You do not have permission to manage users." });
      }

      let existingData: any = null;
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const targetDocSnap = await db.collection("mfr_users").doc(userData.userId).get();
            if (targetDocSnap.exists) {
              existingData = targetDocSnap.data();
            }
          }
        } catch (e) {
          }
      }

      if (!existingData) {
        existingData = await firestoreRestGetDoc("mfr_users", userData.userId);
      }

      if (!isSuperAdmin) {
        if (userData.role === "super_admin" || existingData?.role === "super_admin") {
          return res.status(403).json({ success: false, error: "Forbidden: Only Super Admins can assign or modify Super Admin privileges." });
        }
      }

      if (!existingData) {
        try {
          requireUserPin(userData.pin);
        } catch {
          return res.status(400).json({ success: false, error: "A valid 4-digit PIN is required to create a user." });
        }
      }

      const sanitized = {
        userId: userData.userId,
        name: userData.name,
        email: userData.email || "",
        role: userData.role || "staff",
        department: userData.department || "Production",
        allowedDepartments: Array.isArray(userData.allowedDepartments) ? userData.allowedDepartments : [],
        accessList: Array.isArray(userData.accessList) ? userData.accessList : [],
        canOutsource: Boolean(userData.canOutsource),
        isDepartmentHead: Boolean(userData.isDepartmentHead),
        active: userData.active !== false && userData.status !== "inactive" && userData.status !== "deactivated",
        createdAt: existingData?.createdAt || userData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let wroteUserViaAdmin = false;
      try {
        const db = getFirestoreAdmin();
        if (db) {
          if (sanitized.role === "super_admin") {
            const prevSuperSnap = await db.collection("mfr_users").where("role", "==", "super_admin").get();
            for (const doc of prevSuperSnap.docs) {
              if (doc.id !== userData.userId && doc.data()?.userId !== userData.userId) {
                await doc.ref.update({ role: "admin", updatedAt: new Date().toISOString() }).catch(() => {});
              }
            }
          }
        }
      } catch (e) {
      }

      const userPersist = await persistDocsExclusive([{ collection: "mfr_users", id: userData.userId, data: sanitized }]);
      wroteUserViaAdmin = userPersist.wroteViaAdmin;
      void wroteUserViaAdmin;
      customUsersStore[userData.userId] = sanitized;
      saveUsersStore();

      if (userData.pin !== undefined && userData.pin !== null && String(userData.pin).length > 0) {
        try {
          requireUserPin(userData.pin);
        } catch {
          return res.status(400).json({ success: false, error: "A valid 4-digit PIN is required when setting credentials." });
        }
        const rawPin = userData.pin.trim();
        const pinHash = await bcrypt.hash(rawPin, 10);
        await persistDocsExclusive([{
          collection: "mfr_user_credentials",
          id: userData.userId,
          data: { pinHash, updatedAt: new Date().toISOString() }
        }]);
        customCredsStore[userData.userId] = pinHash;
        saveCredsStore();
      }

      cachedUsersDirectory = null;
      broadcastRealtimeEvent("USER_UPDATED", { userId: sanitized.userId, action: "create" });

      return res.json({ success: true, user: sanitized });
    } catch (err: any) {
      console.error("[AUTH] Error saving user:", err);
      return res.status(500).json({ success: false, error: "Failed to save user profile" });
    }
  });

  // PUT /api/users/:userId & PATCH /api/users/:userId — Protected user update endpoints
  const handleUpdateUser = async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      const userData = req.body;
      const requester = (req as any).user;
      const authUid = (req as any).authUid;

      if (!userData) {
        return res.status(400).json({ success: false, error: "User payload is required." });
      }

      if (await isUserTombstoned(userId)) {
        return res.status(409).json({
          success: false,
          error: "This user has been permanently deleted and cannot be restored."
        });
      }

      const isSelf = requester?.userId === userId || authUid === userId;
      const isManager = requester?.role === "admin" || requester?.role === "super_admin";

      if (!isSelf && !isManager) {
        return res.status(403).json({ success: false, error: "Forbidden: You are not authorized to update this profile." });
      }

      let existingData: any = customUsersStore[userId] || null;
      if (!existingData) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const docSnap = await db.collection("mfr_users").doc(userId).get();
            if (docSnap.exists) existingData = docSnap.data();
          }
        } catch (e) {
          }
      }
      if (!existingData) {
        existingData = await firestoreRestGetDoc("mfr_users", userId);
      }

      if (!existingData) {
        return res.status(404).json({ success: false, error: "User not found." });
      }

      const isRequesterSuperAdmin = requester?.role === "super_admin";
      if (!isRequesterSuperAdmin) {
        if (userData.role !== undefined && userData.role !== existingData?.role) {
          return res.status(403).json({ success: false, error: "Forbidden: Only Super Admins can modify account roles." });
        }
        if (userData.department !== undefined && userData.department !== existingData?.department) {
          return res.status(403).json({ success: false, error: "Forbidden: Only Super Admins can reassign departments." });
        }
      }

      const sanitized: any = {
        userId,
        name: userData.name !== undefined ? userData.name : (existingData?.name || ""),
        email: userData.email !== undefined ? userData.email : (existingData?.email || ""),
        role: (isRequesterSuperAdmin && userData.role) ? userData.role : (existingData?.role || "staff"),
        department: (isRequesterSuperAdmin && userData.department) ? userData.department : (existingData?.department || "Production"),
        allowedDepartments: Array.isArray(userData.allowedDepartments) ? userData.allowedDepartments : (existingData?.allowedDepartments || []),
        accessList: Array.isArray(userData.accessList) ? userData.accessList : (existingData?.accessList || []),
        canOutsource: userData.canOutsource !== undefined ? Boolean(userData.canOutsource) : Boolean(existingData?.canOutsource),
        isDepartmentHead: userData.isDepartmentHead !== undefined ? Boolean(userData.isDepartmentHead) : Boolean(existingData?.isDepartmentHead),
        active: userData.active !== undefined ? Boolean(userData.active) : (existingData?.active !== false),
        createdAt: existingData?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        const db = getFirestoreAdmin();
        if (db && sanitized.role === "super_admin" && existingData?.role !== "super_admin") {
          const prevSuperSnap = await db.collection("mfr_users").where("role", "==", "super_admin").get();
          for (const doc of prevSuperSnap.docs) {
            if (doc.id !== userId) {
              await doc.ref.update({ role: "admin", updatedAt: new Date().toISOString() }).catch(() => {});
            }
          }
        }
      } catch (_) {}

      await persistDocsExclusive([{ collection: "mfr_users", id: userId, data: sanitized }]);
      customUsersStore[userId] = sanitized;
      saveUsersStore();

      cachedUsersDirectory = null;
      broadcastRealtimeEvent("USER_UPDATED", { userId: sanitized.userId, action: "update" });

      return res.json({ success: true, user: sanitized });
    } catch (err: any) {
      console.error("[AUTH] Error updating user:", err);
      return res.status(500).json({ success: false, error: "Failed to update user profile" });
    }
  };

  app.put("/api/users/:userId", requireFirebaseAuth, handleUpdateUser);
  app.patch("/api/users/:userId", requireFirebaseAuth, handleUpdateUser);

  // DELETE /api/users/:userId — Protected user deletion endpoint with persistent tombstone
  app.delete("/api/users/:userId", requireFirebaseAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const requester = (req as any).user;

      const isAllowed = requester?.role === "super_admin" || requester?.role === "admin" || requester?.department === "Admin" || requester?.name?.toLowerCase() === "admin" || requester?.userId?.toLowerCase() === "admin";
      if (!isAllowed) {
        return res.status(403).json({ success: false, error: "Forbidden: Only Admins or Super Admins can delete user accounts." });
      }

      await recordDeletedUserTombstone(userId, requester?.userId || requester?.name || "admin");
      broadcastRealtimeEvent("USER_UPDATED", { userId, action: "delete" });

      return res.json({ success: true, message: `User ${userId} deleted permanently.` });
    } catch (err: any) {
      console.error("[AUTH] Error deleting user:", err);
      return res.status(500).json({ success: false, error: "Failed to delete user profile" });
    }
  });

  // Helper for verified atomic collection purge during Factory Reset
  async function purgeCollectionWithVerification(collectionName: string): Promise<{ success: boolean; remainingDocuments?: number; error?: string }> {
    try {
      const apiKey = firebaseConfig?.apiKey || "";
      const projId = firebaseProjectId;
      const dbId = firestoreDbId;

      // 1. Purge via Admin SDK if available
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            let hasMore = true;
            while (hasMore) {
              const snap = await db.collection(collectionName).limit(300).get();
              if (snap.empty) {
                hasMore = false;
                break;
              }
              const batch = db.batch();
              snap.docs.forEach((doc: any) => batch.delete(doc.ref));
              await batch.commit();
              if (snap.size < 300) {
                hasMore = false;
              }
            }
          }
        } catch (e) {
          }
      }

      // 2. Multi-pass REST deletion until empty
      let pagePass = 0;
      while (pagePass < 10) {
        pagePass++;
        const gcpToken = await getGcpAccessToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;

        const url = `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/${collectionName}?pageSize=300${apiKey ? `&key=${apiKey}` : ""}`;
        const qRes = await fetch(url, { headers });
        if (!qRes.ok) {
          if (qRes.status === 404) break;
          break;
        }
        const data = await qRes.json().catch(() => ({}));
        if (!Array.isArray(data.documents) || data.documents.length === 0) {
          break;
        }

        const delPromises = data.documents.map((doc: any) => {
          const docId = doc.name ? doc.name.split("/").pop() : "";
          return docId ? firestoreRestDeleteDoc(collectionName, docId) : Promise.resolve(true);
        });
        await Promise.all(delPromises);
      }

      // 3. Multi-attempt Verification Check with clean retry
      for (let vPass = 0; vPass < 5; vPass++) {
        if (vPass > 0) await new Promise(r => setTimeout(r, 500));
        const gcpToken = await getGcpAccessToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (gcpToken) headers["Authorization"] = `Bearer ${gcpToken}`;

        const verifyUrl = `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/${collectionName}?pageSize=10${apiKey ? `&key=${apiKey}` : ""}`;
        const vRes = await fetch(verifyUrl, { headers });
        if (vRes.ok) {
          const vData = await vRes.json().catch(() => ({}));
          if (Array.isArray(vData.documents) && vData.documents.length > 0) {
            // Delete any trailing documents explicitly
            await Promise.all(vData.documents.map((doc: any) => {
              const docId = doc.name ? doc.name.split("/").pop() : "";
              return docId ? firestoreRestDeleteDoc(collectionName, docId) : Promise.resolve(true);
            }));
            if (vPass === 4) {
              return {
                success: false,
                remainingDocuments: vData.documents.length,
                error: `Verification check failed: ${collectionName} still contains ${vData.documents.length} document(s).`
              };
            }
            continue;
          }
          break;
        } else if (vRes.status === 404) {
          break;
        }
      }

      return { success: true, remainingDocuments: 0 };
    } catch (restErr: any) {
      return { success: false, error: `Failed to purge ${collectionName}: ${restErr.message || String(restErr)}` };
    }
  }

  // POST /api/admin/factory-reset — True Permanent Factory Reset (Super Admin Only)
  app.post("/api/admin/factory-reset", requireFirebaseAuth, async (req, res) => {
    const resetOpId = `reset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const requester = (req as any).user;
    const { pin } = req.body || {};

    console.log(`[AUDIT] [FACTORY_RESET_INITIATED] OpId: ${resetOpId}, Requester: ${requester?.name} (${requester?.userId}), Role: ${requester?.role}, Time: ${new Date().toISOString()}`);

    if (!requester || requester.role !== "super_admin") {
      console.warn(`[AUDIT] [FACTORY_RESET_DENIED] Unauthorized attempt by ${requester?.userId || "unknown"} (role: ${requester?.role})`);
      return res.status(403).json({ success: false, error: "Forbidden: Factory Reset requires active Super Admin authorization." });
    }

    if (!pin || typeof pin !== "string" || pin.trim().length !== 4) {
      return res.status(400).json({ success: false, error: "Super Admin 4-digit security PIN is required for verification." });
    }

    // Verify Super Admin PIN
    let storedPinHash = customCredsStore[requester.userId] || "";
    if (!storedPinHash) {
      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const credSnap = await db.collection("mfr_user_credentials").doc(requester.userId).get();
            if (credSnap.exists) {
              storedPinHash = credSnap.data()?.pinHash || "";
            }
            if (!storedPinHash) {
              const userSnap = await db.collection("mfr_users").doc(requester.userId).get();
              if (userSnap.exists) {
                storedPinHash = userSnap.data()?.pinHash || "";
              }
            }
          }
        } catch (_) {}
      }
    }
    if (!storedPinHash) {
      const cred = await firestoreRestGetDoc("mfr_user_credentials", requester.userId);
      storedPinHash = cred?.pinHash || "";
    }
    if (!storedPinHash) {
      const userDoc = await firestoreRestGetDoc("mfr_users", requester.userId);
      storedPinHash = userDoc?.pinHash || "";
    }
    if (!storedPinHash && requester.pinHash) {
      storedPinHash = requester.pinHash;
    }

    let pinValid = false;
    try {
      if (storedPinHash) {
        pinValid = bcrypt.compareSync(pin.trim(), storedPinHash);
      }
    } catch (_) {}

    if (!pinValid) {
      console.warn(`[AUDIT] [FACTORY_RESET_DENIED] Invalid PIN provided by Super Admin ${requester.userId}`);
      return res.status(401).json({ success: false, error: "Invalid Super Admin Security PIN." });
    }

    const operationalCollections = operationalCollectionsForFactoryReset();

    console.log(`[AUDIT] [FACTORY_RESET_PROCESSING] OpId: ${resetOpId}, Beginning purge of ${operationalCollections.length} collections...`);

    for (const col of operationalCollections) {
      console.log(`[AUDIT] [FACTORY_RESET_STAGE] OpId: ${resetOpId}, Purging ${col}...`);
      const result = await purgeCollectionWithVerification(col);
      if (!result.success) {
        console.error(`[AUDIT] [FACTORY_RESET_FAILED] OpId: ${resetOpId}, Failed at collection ${col}: ${result.error}`);
        return res.status(500).json({ 
          success: false, 
          error: `Factory reset verification failed`,
          stage: col,
          remainingDocuments: result.remainingDocuments || 1,
          resetOpId
        });
      }
    }

    // Remove non-super_admin users only. Never delete, deactivate, or tombstone super_admin.
    try {
      const db = getFirestoreAdmin();
      const preservedUsers: any[] = [];
      if (db) {
        const usersSnap = await db.collection("mfr_users").get();
        for (const doc of usersSnap.docs) {
          const data = doc.data() || {};
          if (isProtectedSuperAdmin(data) || isProtectedSuperAdmin({ role: data.role })) {
            preservedUsers.push({ id: doc.id, ...data, role: "super_admin", active: true });
            continue;
          }
          if (shouldDeleteUserOnFactoryReset(data)) {
            await db.collection("mfr_user_credentials").doc(doc.id).delete().catch(() => {});
            await db.collection("mfr_users").doc(doc.id).delete().catch(() => {});
          }
        }
      } else {
        const restUsers = await firestoreRestQueryAll("mfr_users");
        for (const u of restUsers) {
          const id = u.userId || u.id;
          if (isProtectedSuperAdmin(u)) {
            preservedUsers.push(u);
            continue;
          }
          await firestoreRestDeleteDoc("mfr_users", id);
          await firestoreRestDeleteDoc("mfr_user_credentials", id);
        }
      }

      const nextUsers: Record<string, any> = {};
      const nextCreds: Record<string, string> = {};
      for (const u of preservedUsers) {
        const id = u.userId || u.id;
        nextUsers[id] = { ...u, role: "super_admin", active: true };
        if (customCredsStore[id]) nextCreds[id] = customCredsStore[id];
      }
      customUsersStore = nextUsers;
      saveUsersStore();
      customCredsStore = nextCreds;
      saveCredsStore();
    } catch (userPurgeErr: any) {
      console.error("[FACTORY_RESET] Non-super user purge warning:", userPurgeErr?.message || userPurgeErr);
    }

    // Advance persistent reset generation
    const newGeneration = await updateResetGeneration(resetOpId, requester.userId);

    // Re-initialize default clean company config
    const cleanDefaultConfig = {
      companyName: "PMW Manufacturing Tracker",
      address: "Precision Metal Works Industrial Unit",
      phone: "+91-9876543210",
      email: "admin@factory.com",
      autoGenerateOrderNo: true,
      requirePinForMovements: true,
      defaultUnit: "KGS",
      updatedAt: new Date().toISOString()
    };
    await persistDocsExclusive([{ collection: "mfr_company_config", id: "global", data: cleanDefaultConfig }]);

    deletedUserIds.clear();
    saveDeletedUsers();

    cachedUsersDirectory = Object.values(customUsersStore);
    cachedUsersDirectoryTimestamp = Date.now();

    const freshToken = await issueAuthToken(requester.userId);

    const resetAuditId = `AL-${Date.now()}-reset`;
    await persistDocsExclusive([{
      collection: "mfr_audit_logs",
      id: resetAuditId,
      data: {
        id: resetAuditId,
        timestamp: new Date().toISOString(),
        userId: requester.userId,
        userName: requester.name,
        action: "FACTORY_RESET",
        details: `Factory reset ${resetOpId} completed. Super admin accounts preserved. Generation ${newGeneration}.`
      }
    }]);

    console.log(`[AUDIT] [FACTORY_RESET_COMPLETED] OpId: ${resetOpId}, Operational data purged. Super admin preserved. New Generation: ${newGeneration}`);
    broadcastRealtimeEvent("FACTORY_RESET_COMPLETED", { resetOpId, factoryResetGeneration: newGeneration, timestamp: new Date().toISOString(), firstRun: false });

    return res.json({
      success: true,
      resetOperationId: resetOpId,
      factoryResetGeneration: newGeneration,
      firstRun: false,
      token: freshToken,
      sessionToken: freshToken,
      user: requester,
      message: "Factory reset completed. Super Admin accounts preserved. Operational data erased."
    });
  });

  // POST /api/auth/setup-admin — Initial First-Run Super Admin Onboarding (Only permitted when 0 active users exist)
  app.post("/api/auth/setup-admin", async (req, res) => {
    const { name, email, department, pin } = req.body || {};

    if (!name || !name.trim() || !pin || pin.trim().length !== 4 || !/^\d{4}$/.test(pin.trim())) {
      return res.status(400).json({ success: false, error: "Full Name and 4-digit numeric Security PIN are required." });
    }

    // Strict verification: Query active users to ensure 0 active users exist
    let activeUserCount = 0;
    if (Array.isArray(cachedUsersDirectory) && cachedUsersDirectory.length > 0) {
      activeUserCount = Math.max(activeUserCount, cachedUsersDirectory.length);
    }
    if (Object.keys(customUsersStore).length > 0) {
      activeUserCount = Math.max(activeUserCount, Object.keys(customUsersStore).length);
    }

    if (activeUserCount === 0) {
      try {
        const db = getFirestoreAdmin();
        if (db) {
          const snap = await db.collection("mfr_users").limit(5).get();
          activeUserCount = Math.max(activeUserCount, snap.size);
        }
      } catch (_) {}
    }

    if (activeUserCount > 0) {
      return res.status(403).json({ success: false, error: "Setup is only permitted on a fresh or reset system with 0 existing users." });
    }

    const cleanName = name.trim();
    const cleanPin = pin.trim();
    const userId = `super-${Date.now()}`;
    const pinHash = bcrypt.hashSync(cleanPin, 10);

    const newSuperAdmin: any = {
      userId,
      name: cleanName,
      email: (email && email.trim()) ? email.trim() : `${cleanName.toLowerCase().replace(/\s+/g, '')}@factory.com`,
      role: "super_admin",
      department: department || "Admin",
      allowedDepartments: ["Dispatch", "Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Admin"],
      accessList: ["Dispatch", "Purchase", "Raw Material Store", "Production", "Heat Treatment", "Plating", "Packing", "Store", "Admin"],
      canOutsource: true,
      isDepartmentHead: true,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    customUsersStore[userId] = newSuperAdmin;
    saveUsersStore();

    customCredsStore[userId] = pinHash;
    saveCredsStore();

    cachedUsersDirectory = [newSuperAdmin];
    cachedUsersDirectoryTimestamp = Date.now();

    await persistDocsExclusive([
      { collection: "mfr_users", id: userId, data: newSuperAdmin },
      { collection: "mfr_user_credentials", id: userId, data: { pinHash, updatedAt: new Date().toISOString() } }
    ]);

    const token = await issueAuthToken(userId);

    console.log(`[AUTH] Initial Super Admin created: ${newSuperAdmin.name} (${userId}) on generation ${currentResetGeneration}`);
    broadcastRealtimeEvent("USER_UPDATED", { userId, action: "create" });

    return res.json({ success: true, user: newSuperAdmin, token });
  });

  // GET /api/users/:userId — Single user profile endpoint
  app.get("/api/users/:userId", requireFirebaseAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const requester = (req as any).user;
      const authUid = (req as any).authUid;

      const isSelf = requester?.userId === userId || authUid === userId;
      const isPrivileged = requester?.role === "admin" || requester?.role === "super_admin";

      if (!isSelf && !isPrivileged) {
        return res.status(403).json({ success: false, error: "Forbidden: You are not authorized to view this profile." });
      }

      let userData: any = null;

      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const userDocSnap = await db.collection("mfr_users").doc(userId).get();
            if (userDocSnap.exists) {
              userData = userDocSnap.data();
            }
          }
        } catch (e) {
          }
      }

      if (!userData) {
        userData = await firestoreRestGetDoc("mfr_users", userId);
      }

      if (!userData) {
        return res.status(404).json({ success: false, error: "User not found" });
      }

      return res.json({
        success: true,
        user: {
          userId: userData.userId || userId,
          name: userData.name || "",
          email: userData.email || "",
          role: userData.role || "staff",
          department: userData.department || "Production",
          allowedDepartments: Array.isArray(userData.allowedDepartments) ? userData.allowedDepartments : [],
          accessList: Array.isArray(userData.accessList) ? userData.accessList : [],
          canOutsource: Boolean(userData.canOutsource),
          active: userData.active !== false && userData.status !== "inactive" && userData.status !== "deactivated",
          createdAt: userData.createdAt || new Date().toISOString(),
          updatedAt: userData.updatedAt || new Date().toISOString()
        }
      });
    } catch (err: any) {
      console.error("[AUTH] Error fetching user:", err);
      return res.status(500).json({ success: false, error: "Failed to fetch user profile" });
    }
  });

  // ----------------------------------------------------
  // SERVER-AUTHORITATIVE JOB CARDS CRUD & TOMBSTONE PROPAGATION
  // ----------------------------------------------------
  app.get("/api/job-cards", requireFirebaseAuth, async (req, res) => {
    try {
      let cards: any[] = [];
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const snapPromise = dbAdmin.collection("mfr_job_cards").get();
          const snap: any = await Promise.race([
            snapPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK get timeout")), 2500))
          ]);
          cards = snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
        }
      } catch (adminErr) {}

      if (cards.length === 0) {
        const restResult = await firestoreRestQueryAll("mfr_job_cards");
        if (Array.isArray(restResult)) {
          cards = restResult;
        }
      }

      // Check tombstoned job cards
      const deletedIds = new Set<string>();
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const tombPromise = dbAdmin.collection("mfr_deleted_job_cards").get();
          const tombSnap: any = await Promise.race([
            tombPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK tombstone timeout")), 1500))
          ]);
          tombSnap.docs.forEach((d: any) => {
            deletedIds.add(d.id.toLowerCase().trim());
            const dData = d.data();
            if (dData && dData.jobCardNo) deletedIds.add(String(dData.jobCardNo).toLowerCase().trim());
          });
        }
      } catch (tErr) {}

      if (deletedIds.size === 0) {
        const restTombs = await firestoreRestQueryAll("mfr_deleted_job_cards");
        if (Array.isArray(restTombs)) {
          restTombs.forEach((d: any) => {
            if (d.id) deletedIds.add(String(d.id).toLowerCase().trim());
            if (d.jobCardNo) deletedIds.add(String(d.jobCardNo).toLowerCase().trim());
          });
        }
      }

      // Merge in-memory authoritative cards
      inMemoryJobCards.forEach((val, key) => {
        const upper = key.toUpperCase();
        if (!cards.some(c => String(c.jobCardNo || c.id).toUpperCase() === upper)) {
          cards.push(val);
        }
      });
      inMemoryDeletedJobCards.forEach(id => deletedIds.add(id.toLowerCase().trim()));

      const activeCards = cards
        .filter((c: any) => {
          if (!c || !c.jobCardNo) return false;
          const jcNo = String(c.jobCardNo).toLowerCase().trim();
          if (deletedIds.has(jcNo)) return false;
          if (c.active === false || c.status === "deleted" || c.deletedAt) return false;
          return true;
        })
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      return res.json({ success: true, jobCards: activeCards });
    } catch (err: any) {
      console.error("[JOB_CARDS] Error fetching job cards:", err);
      return res.status(500).json({ success: false, error: "Failed to retrieve job cards" });
    }
  });

  // POST /api/job-cards — Authoritative Server Job Card Creation
  app.post("/api/job-cards", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      if (!authUid || !requester) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      }

      const { jobCard, initialMovement: customInitialMovement } = req.body || {};
      if (!jobCard || !jobCard.jobCardNo || !jobCard.partyName || jobCard.orderQty === undefined || jobCard.orderQty === null) {
        return res.status(400).json({ success: false, error: "jobCardNo, partyName, and orderQty are required." });
      }

      const numOrderQty = Number(jobCard.orderQty);
      if (isNaN(numOrderQty) || !isFinite(numOrderQty) || numOrderQty <= 0 || numOrderQty > 1000000000) {
        return res.status(400).json({ success: false, error: "Invalid orderQty: Must be a positive finite number (1 to 1,000,000,000)." });
      }

      const isPurchase = Boolean(jobCard.purchaseDetails && Object.keys(jobCard.purchaseDetails).length > 0);
      const userRole = String(requester.role || "staff").toLowerCase();
      const userDept = String(requester.department || "").toLowerCase();
      const allowedDepts: string[] = [
        ...(Array.isArray(requester.allowedDepartments) ? requester.allowedDepartments : []),
        ...(Array.isArray(requester.accessList) ? requester.accessList : [])
      ].map((d: string) => String(d).toLowerCase());

      const isSuperOrAdmin = userRole === "super_admin" || userRole === "admin" || userDept === "admin" || userDept === "management";
      const requiredDept = isPurchase ? "purchase" : "dispatch";
      const hasDeptPerm = isSuperOrAdmin || userDept === requiredDept || allowedDepts.includes(requiredDept);

      if (!hasDeptPerm) {
        return res.status(403).json({
          success: false,
          error: `Forbidden: User '${requester.name || requester.userId}' (${requester.department}) is not authorized to create ${isPurchase ? 'Purchase Inward' : 'Dispatch'} Job Cards.`
        });
      }

      const authoritativeUserId = authUid;
      const authoritativeUserName = requester.name || requester.userId || "Authorized User";
      const now = new Date().toISOString();
      const upperJobNo = String(jobCard.jobCardNo).toUpperCase().trim();
      const unitLabel = jobCard.unit || 'KG';

      const newJob = {
        ...jobCard,
        jobCardNo: upperJobNo,
        orderQty: numOrderQty,
        currentQty: numOrderQty,
        status: jobCard.status || 'Pending Acceptance',
        createdBy: authoritativeUserName,
        createdByUserId: authoritativeUserId,
        balanceQty: numOrderQty,
        version: 1,
        createdAt: now,
        completed: false
      };

      const movId = `M-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const defaultMovement = isPurchase ? {
        movementId: movId,
        jobCardNo: upperJobNo,
        fromDepartment: 'Purchase',
        toDepartment: jobCard.currentDepartment || 'Store',
        quantity: Number(jobCard.currentQty || jobCard.orderQty),
        transferBy: authoritativeUserName,
        transferDate: now,
        accepted: false,
        initiatedByUserId: authoritativeUserId,
        initiatedByUserName: authoritativeUserName,
        remarks: jobCard.purchaseDetails?.remarks || `Material inwarded from Supplier: ${jobCard.purchaseDetails?.supplierName || jobCard.partyName}. Total Received: ${jobCard.purchaseDetails?.receivedQty || jobCard.orderQty} ${unitLabel}, Sent to ${jobCard.currentDepartment || 'Store'}: ${jobCard.currentQty || jobCard.orderQty} ${unitLabel}.`
      } : {
        movementId: movId,
        jobCardNo: upperJobNo,
        fromDepartment: 'Dispatch',
        toDepartment: jobCard.currentDepartment || 'Production',
        quantity: Number(jobCard.orderQty),
        transferBy: authoritativeUserName,
        transferDate: now,
        accepted: false,
        initiatedByUserId: authoritativeUserId,
        initiatedByUserName: authoritativeUserName,
        remarks: 'Order registered. Dispatching raw material and job ticket to Production.'
      };

      const initialMovement = {
        ...defaultMovement,
        ...(customInitialMovement || {})
      };

      const notifId = `N-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const targetDept = isPurchase ? 'Store' : (jobCard.currentDepartment || 'Production');
      const notifData = {
        notificationId: notifId,
        department: targetDept,
        title: isPurchase ? 'New Purchase Inward Receipt' : 'New Production Queue Item',
        message: isPurchase
          ? `New Purchase Inward ${upperJobNo} generated for supplier ${jobCard.partyName}. Quantity: ${jobCard.currentQty || jobCard.orderQty} ${unitLabel}. Pending Store acceptance.`
          : `Job Card ${upperJobNo} generated for ${jobCard.partyName}. Quantity: ${jobCard.orderQty} ${unitLabel}. Pending material acceptance.`,
        userId: isPurchase ? 'all_store' : 'all_production',
        read: false,
        createdAt: now
      };

      const auditId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const auditData = {
        id: auditId,
        timestamp: now,
        userId: authoritativeUserId,
        userName: authoritativeUserName,
        action: "CREATE_JOB_CARD",
        details: `Generated job card ${upperJobNo} for ${jobCard.partyName} (${jobCard.orderQty} ${unitLabel})`
      };

      await persistDocsExclusive([
        { collection: "mfr_job_cards", id: upperJobNo, data: newJob },
        { collection: "mfr_movements", id: initialMovement.movementId, data: initialMovement },
        { collection: "mfr_notifications", id: notifId, data: notifData },
        { collection: "mfr_audit_logs", id: auditId, data: auditData }
      ]);

      inMemoryJobCards.set(upperJobNo, newJob);
      inMemoryMovements.set(initialMovement.movementId, initialMovement);

      broadcastRealtimeEvent("JOB_UPDATED", { jobCardNo: upperJobNo });
      broadcastRealtimeEvent("MOVEMENT_UPDATED", { movementId: initialMovement.movementId, jobCardNo: upperJobNo });
      broadcastRealtimeEvent("NOTIFICATION_UPDATED", {});

      return res.json({
        success: true,
        jobCard: newJob,
        movement: initialMovement
      });
    } catch (err: any) {
      console.error("[JOB_CARDS] Error creating job card:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to create job card" });
    }
  });

  // PUT /api/job-cards/:jobCardNo — Authoritative Server Job Card Update
  app.put("/api/job-cards/:jobCardNo", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      if (!authUid || !requester) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      }

      const rawJobCardNo = decodeURIComponent(req.params.jobCardNo).trim();
      const upperId = rawJobCardNo.toUpperCase();
      const updates = req.body || {};
      const authoritativeUserId = authUid;
      const authoritativeUserName = requester.name || requester.userId || "Authorized User";
      const now = new Date().toISOString();

      let updatedCard: any = null;

      if (inMemoryJobCards.has(upperId) || inMemoryJobCards.has(rawJobCardNo)) {
        const existing = inMemoryJobCards.get(upperId) || inMemoryJobCards.get(rawJobCardNo);
        const nextVersion = (existing.version || 1) + 1;
        updatedCard = {
          ...existing,
          ...updates,
          version: nextVersion,
          updatedAt: now,
          updatedBy: authoritativeUserName,
          updatedByUserId: authoritativeUserId
        };
        inMemoryJobCards.set(upperId, updatedCard);
      }

      if (true) {
        try {
          const dbAdmin = getFirestoreAdmin();
          if (dbAdmin) {
            let jcRef = dbAdmin.collection("mfr_job_cards").doc(upperId);
            let snap = await jcRef.get();
            if (!snap.exists) {
              jcRef = dbAdmin.collection("mfr_job_cards").doc(rawJobCardNo);
              snap = await jcRef.get();
            }
            if (snap.exists) {
              const existing = snap.data() as any;
              const nextVersion = (existing.version || 1) + 1;
              updatedCard = {
                ...existing,
                ...updates,
                version: nextVersion,
                updatedAt: now,
                updatedBy: authoritativeUserName,
                updatedByUserId: authoritativeUserId
              };
              await jcRef.set(updatedCard);
              inMemoryJobCards.set(upperId, updatedCard);
            }
          }
        } catch (e) {
          console.warn("[JOB_CARDS] Admin SDK update failed, falling back to REST:", e);
        }
      }

      if (!updatedCard) {
        let existing = await firestoreRestGetDoc("mfr_job_cards", upperId);
        if (!existing) {
          existing = await firestoreRestGetDoc("mfr_job_cards", rawJobCardNo);
        }
        if (!existing) {
          return res.status(404).json({ success: false, error: `Job card ${rawJobCardNo} not found.` });
        }
        const nextVersion = (existing.version || 1) + 1;
        updatedCard = {
          ...existing,
          ...updates,
          version: nextVersion,
          updatedAt: now,
          updatedBy: authoritativeUserName,
          updatedByUserId: authoritativeUserId
        };
        await firestoreRestSetDoc("mfr_job_cards", upperId, updatedCard);
        inMemoryJobCards.set(upperId, updatedCard);
      }

      const auditId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const auditData = {
        id: auditId,
        timestamp: now,
        userId: authoritativeUserId,
        userName: authoritativeUserName,
        action: "UPDATE_JOB_CARD",
        details: `Updated Job Card ${upperId} (Version ${updatedCard.version})`
      };
      await firestoreRestSetDoc("mfr_audit_logs", auditId, auditData);

      broadcastRealtimeEvent("JOB_UPDATED", { jobCardNo: upperId });

      return res.json({ success: true, jobCard: updatedCard });
    } catch (err: any) {
      console.error("[JOB_CARDS] Error updating job card:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to update job card" });
    }
  });

  app.delete("/api/job-cards/:jobCardNo", requireFirebaseAuth, async (req, res) => {
    try {
      const requester = (req as any).user;
      if (!requester || (requester.role !== "super_admin" && requester.role !== "admin")) {
        return res.status(403).json({ success: false, error: "Forbidden: Only Administrators can delete Job Cards." });
      }

      const jobCardNo = decodeURIComponent(req.params.jobCardNo).trim();
      if (!jobCardNo) {
        return res.status(400).json({ success: false, error: "Job Card number is required." });
      }

      const upperId = jobCardNo.toUpperCase();
      const asIsId = jobCardNo;
      const lowerId = jobCardNo.toLowerCase();

      inMemoryJobCards.delete(upperId);
      inMemoryJobCards.delete(asIsId);
      inMemoryDeletedJobCards.add(upperId.toLowerCase());
      inMemoryDeletedJobCards.add(lowerId);

      const tombstonePayload = {
        jobCardNo: upperId,
        deletedAt: new Date().toISOString(),
        deletedBy: requester.userId || requester.name || "admin",
        deletedByName: requester.name || "Administrator",
        tombstone: true
      };

      // 1. Write tombstone to Firestore
      await persistExclusive(
        async () => {
          const dbAdmin = getFirestoreAdmin();
          if (!dbAdmin) {
            throw new Error("Admin SDK unavailable");
          }
          await dbAdmin.collection("mfr_deleted_job_cards").doc(upperId).set(tombstonePayload);
          if (upperId !== asIsId) {
            await dbAdmin.collection("mfr_deleted_job_cards").doc(asIsId).set(tombstonePayload);
          }
        },
        async () => {
          await firestoreRestSetDoc("mfr_deleted_job_cards", upperId, tombstonePayload);
          if (upperId !== asIsId) {
            await firestoreRestSetDoc("mfr_deleted_job_cards", asIsId, tombstonePayload);
          }
        }
      ).catch(() => {});

      // 2. Delete Job Card and cascade related documents from Firestore
      await persistExclusive(
        async () => {
          const dbAdmin = getFirestoreAdmin();
          if (!dbAdmin) {
            throw new Error("Admin SDK unavailable");
          }
          await dbAdmin.collection("mfr_job_cards").doc(upperId).delete();
          await dbAdmin.collection("mfr_job_cards").doc(asIsId).delete();

          const movSnap = await dbAdmin.collection("mfr_movements").where("jobCardNo", "==", jobCardNo).get().catch(() => null);
          if (movSnap && !movSnap.empty) {
            const batch = dbAdmin.batch();
            movSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit().catch(() => {});
          }
          if (upperId !== asIsId) {
            const movUpperSnap = await dbAdmin.collection("mfr_movements").where("jobCardNo", "==", upperId).get().catch(() => null);
            if (movUpperSnap && !movUpperSnap.empty) {
              const batch = dbAdmin.batch();
              movUpperSnap.docs.forEach(d => batch.delete(d.ref));
              await batch.commit().catch(() => {});
            }
          }

          const notifSnap = await dbAdmin.collection("mfr_notifications").get().catch(() => null);
          if (notifSnap && !notifSnap.empty) {
            const batch = dbAdmin.batch();
            notifSnap.docs.forEach(d => {
              const nData = d.data();
              if (nData.message && nData.message.toLowerCase().includes(lowerId)) {
                batch.delete(d.ref);
              }
            });
            await batch.commit().catch(() => {});
          }
        },
        async () => {
          await firestoreRestDeleteDoc("mfr_job_cards", upperId);
          await firestoreRestDeleteDoc("mfr_job_cards", asIsId);
        }
      ).catch(() => {});

      // 3. Broadcast SSE Event for Instant Cross-User & Cross-Device Synchronization
      broadcastRealtimeEvent("JOB_UPDATED", { jobCardNo: upperId });
      broadcastRealtimeEvent("MOVEMENT_UPDATED");

      return res.json({ success: true, message: `Job Card ${jobCardNo} deleted successfully.` });
    } catch (err: any) {
      console.error("[JOB_CARDS] Error deleting job card:", err);
      return res.status(500).json({ success: false, error: "Failed to delete job card" });
    }
  });

  app.post("/api/job-cards/delete-all", requireFirebaseAuth, async (req, res) => {
    try {
      const requester = (req as any).user;
      if (!requester || (requester.role !== "super_admin" && requester.role !== "admin")) {
        return res.status(403).json({ success: false, error: "Forbidden: Only Administrators can purge all Job Cards." });
      }

      const collectionsToPurge = ["mfr_job_cards", "mfr_movements", "mfr_notifications", "mfr_process_transfers", "mfr_outsource_orders"];
      for (const col of collectionsToPurge) {
        await persistExclusive(
          async () => {
            const dbAdmin = getFirestoreAdmin();
            if (!dbAdmin) {
              throw new Error("Admin SDK unavailable");
            }
            const snap = await dbAdmin.collection(col).get();
            if (!snap.empty) {
              const batch = dbAdmin.batch();
              snap.docs.forEach(d => batch.delete(d.ref));
              await batch.commit();
            }
          },
          async () => {
            const restDocs = await firestoreRestQueryAll(col);
            if (Array.isArray(restDocs)) {
              await Promise.all(restDocs.map((doc: any) => {
                const docId = doc.id || (doc.name ? doc.name.split("/").pop() : "");
                return docId ? firestoreRestDeleteDoc(col, docId) : Promise.resolve(true);
              }));
            }
          }
        ).catch(() => {});
      }

      broadcastRealtimeEvent("ALL_UPDATED");
      broadcastRealtimeEvent("JOB_UPDATED");

      return res.json({ success: true, message: "All Job Cards and related data purged successfully." });
    } catch (err: any) {
      console.error("[JOB_CARDS] Error purging job cards:", err);
      return res.status(500).json({ success: false, error: "Failed to purge job cards" });
    }
  });

  // ----------------------------------------------------
  // SERVER-AUTHORITATIVE MATERIAL MOVEMENT & TRANSACTION ENDPOINT
  // ----------------------------------------------------

  // GET /api/audit-logs — Authoritative Server Audit Logs Fetch
  app.get("/api/audit-logs", requireFirebaseAuth, async (req, res) => {
    try {
      let logs: any[] = [];
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const snap = await dbAdmin.collection("mfr_audit_logs").orderBy("timestamp", "desc").limit(500).get();
          logs = snap.docs.map(d => d.data());
        }
      } catch (_) {}

      if (logs.length === 0) {
        const restResult = await firestoreRestQueryAll("mfr_audit_logs");
        if (Array.isArray(restResult)) {
          logs = restResult;
        }
      }

      const sorted = logs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()).slice(0, 500);
      return res.json({ success: true, logs: sorted });
    } catch (err: any) {
      console.error("[AUDIT] Error fetching audit logs:", err);
      return res.status(500).json({ success: false, error: "Failed to retrieve audit logs" });
    }
  });

  // GET /api/notifications — Authoritative Server Notifications Fetch
  app.get("/api/notifications", requireFirebaseAuth, async (req, res) => {
    try {
      let notifs: any[] = [];
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const snap = await dbAdmin.collection("mfr_notifications").orderBy("createdAt", "desc").limit(200).get();
          notifs = snap.docs.map(d => d.data());
        }
      } catch (_) {}

      if (notifs.length === 0) {
        const restResult = await firestoreRestQueryAll("mfr_notifications");
        if (Array.isArray(restResult)) {
          notifs = restResult;
        }
      }

      const sorted = notifs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 200);
      return res.json({ success: true, notifications: sorted });
    } catch (err: any) {
      console.error("[NOTIFICATIONS] Error fetching notifications:", err);
      return res.status(500).json({ success: false, error: "Failed to retrieve notifications" });
    }
  });

  // POST /api/audit-logs — Authoritative Server Audit Logging
  app.post("/api/audit-logs", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      const { id, userId, userName, action, details, timestamp } = req.body || {};
      if (!action || !details) {
        return res.status(400).json({ success: false, error: "Action and details are required." });
      }

      const auditId = id || `AL-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = timestamp || new Date().toISOString();
      const auditData = {
        id: auditId,
        timestamp: now,
        userId: authUid || userId || "system",
        userName: requester?.name || userName || "System",
        action,
        details
      };

      if (true) {
        try {
          const dbAdmin = getFirestoreAdmin();
          if (dbAdmin) {
            await dbAdmin.collection("mfr_audit_logs").doc(auditId).set(auditData);
            return res.json({ success: true, id: auditId });
          }
        } catch (adminErr) {
          console.warn("[AUDIT] Admin SDK write failed, falling back to REST:", adminErr);
        }
      }

      await firestoreRestSetDoc("mfr_audit_logs", auditId, auditData);
      return res.json({ success: true, id: auditId });
    } catch (err: any) {
      console.error("[AUDIT] Failed to write audit log:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to write audit log" });
    }
  });

  // POST /api/notifications — Authoritative Server Notification Dispatch
  app.post("/api/notifications", requireFirebaseAuth, async (req, res) => {
    try {
      const { notificationId, id, department, title, message, userId, read, createdAt } = req.body || {};
      if (!title || !message) {
        return res.status(400).json({ success: false, error: "Title and message are required." });
      }

      const notifId = notificationId || id || `N-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const now = createdAt || new Date().toISOString();
      const notifData = {
        notificationId: notifId,
        department: department || "All",
        title,
        message,
        userId: userId || "all",
        read: read || false,
        createdAt: now
      };

      if (true) {
        try {
          const dbAdmin = getFirestoreAdmin();
          if (dbAdmin) {
            await dbAdmin.collection("mfr_notifications").doc(notifId).set(notifData);
            broadcastRealtimeEvent("NOTIFICATION_UPDATED", { notificationId: notifId });
            return res.json({ success: true, notificationId: notifId });
          }
        } catch (adminErr) {
          console.warn("[NOTIFICATION] Admin SDK write failed, falling back to REST:", adminErr);
        }
      }

      await firestoreRestSetDoc("mfr_notifications", notifId, notifData);
      broadcastRealtimeEvent("NOTIFICATION_UPDATED", { notificationId: notifId });
      return res.json({ success: true, notificationId: notifId });
    } catch (err: any) {
      console.error("[NOTIFICATION] Failed to create notification:", err);
      return res.status(500).json({ success: false, error: err.message || "Failed to create notification" });
    }
  });


  async function handleAuthoritativeMovementCommit(req: express.Request, res: express.Response) {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      if (!authUid || !requester) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      }

      const body = req.body || {};
      const movement = body.movement || body;
      const operationId = String(body.operationId || movement.operationId || "").trim();
      const jobCardNo = String(movement.jobCardNo || body.jobCardNo || "").trim();
      const fromDepartment = String(movement.fromDepartment || body.fromDepartment || "").trim();
      const toDepartment = String(movement.toDepartment || body.toDepartment || "").trim();
      const quantity = movement.quantity !== undefined ? movement.quantity : body.quantity;

      const input = {
        operationId,
        movementId: movement.movementId || body.movementId,
        jobCardNo,
        fromDepartment,
        toDepartment,
        quantity,
        remarks: movement.remarks || body.remarks,
        processDetails: movement.processDetails || body.processDetails,
        isIssueRequest: Boolean(movement.isIssueRequest || body.isIssueRequest),
        requestedQty: movement.requestedQty || body.requestedQty,
        requestedUnit: movement.requestedUnit || body.requestedUnit,
        transactionType: movement.transactionType || body.transactionType,
        extra: movement,
        actor: {
          userId: authUid,
          userName: requester.name || requester.userId || "Authorized User",
          role: requester.role || "staff",
          department: requester.department || "",
          allowedDepartments: Array.isArray(requester.allowedDepartments) ? requester.allowedDepartments : [],
          accessList: Array.isArray(requester.accessList) ? requester.accessList : []
        }
      };

      let result;
      const db = getFirestoreAdmin();
      if (db) {
        try {
          result = await db.runTransaction(async (t: any) => {
            const txStore: SimpleStore = {
              async get(collection: string, id: string) {
                const snap = await t.get(db.collection(collection).doc(id));
                return snap.exists ? snap.data() : null;
              },
              async set(collection: string, id: string, data: any) {
                t.set(db.collection(collection).doc(id), data);
              },
              async list() {
                return [];
              }
            };
            return commitMaterialMovementTx(txStore, input);
          });
        } catch (txErr: any) {
          console.warn("[MOVEMENT COMMIT] Admin transaction failed, using exclusive persist fallback:", txErr?.message || txErr);
        }
      }

      if (result && !result.success) {
        return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      }

      if (!result) {
        const backing = createFirestoreSimpleStore();
        const preloadedMovements = await backing.list("mfr_movements");
        const store: SimpleStore = {
          get: (c, id) => backing.get(c, id),
          list: async () => preloadedMovements,
          set: async () => {}
        };
        result = await commitMaterialMovementTx(store, { ...input, preloadedMovements });
        if (result.success && !result.cached && result.writes && result.writes.length > 0) {
          await persistDocsExclusive(result.writes);
        }
      }

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      }

      if (result.movement) inMemoryMovements.set(result.movement.movementId, result.movement);
      if (result.updatedJobCard) {
        inMemoryJobCards.set(String(result.updatedJobCard.jobCardNo).toUpperCase(), result.updatedJobCard);
      }

      broadcastRealtimeEvent("MOVEMENT_UPDATED", { movementId: result.movement?.movementId, jobCardNo: result.movement?.jobCardNo });
      if (result.updatedJobCard) {
        broadcastRealtimeEvent("JOB_UPDATED", { jobCardNo: result.updatedJobCard.jobCardNo });
      }
      broadcastRealtimeEvent("NOTIFICATION_UPDATED", {});

      return res.json({
        success: true,
        cached: Boolean(result.cached),
        movement: result.movement,
        updatedJobCard: result.updatedJobCard,
        updatedJobCardVersion: result.updatedJobCard?.version
      });
    } catch (err: any) {
      console.error("[MOVEMENT COMMIT] error:", err);
      const status = err.statusCode || 500;
      return res.status(status).json({ success: false, error: err.message || "Material movement transaction failed." });
    }
  }

  app.post("/api/inventory/movement", requireFirebaseAuth, handleAuthoritativeMovementCommit);

  app.post("/api/movements/:movementId/accept", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      const movementId = req.params.movementId;
      const { remarks, allottedLocation, rackNo, quantity, issueStatus } = req.body || {};

      if (!authUid || !requester) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      }

      if (!movementId) {
        return res.status(400).json({ success: false, error: "Movement ID is required." });
      }

      const authoritativeUserId = authUid;
      const authoritativeUserName = requester.name || requester.userId || "Authorized User";
      const now = new Date().toISOString();

      let finalMovement: any = null;
      let finalJobCard: any = null;

      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const movRef = db.collection("mfr_movements").doc(movementId);

            const txPromise = db.runTransaction(async (transaction) => {
              // ============================================================
              // PHASE 1: ALL TRANSACTION READS (STRICTLY BEFORE ANY WRITES)
              // ============================================================
              const movSnap = await transaction.get(movRef);
              if (!movSnap.exists) {
                const err: any = new Error(`Movement ${movementId} not found.`);
                err.statusCode = 404;
                throw err;
              }

              const movData = movSnap.data() as any;
              if (movData.deletedDate || movData.status === 'deleted') {
                const err: any = new Error(`Movement ${movementId} has been cancelled or deleted.`);
                err.statusCode = 400;
                throw err;
              }

              // Idempotency: if already accepted and not rejected
              if (movData.accepted && movData.issueStatus !== 'Rejected') {
                return { isCached: true, movement: movData, jobCard: null };
              }

              // Department authorization verification
              const userRole = String(requester.role || "staff").toLowerCase();
              const userDept = String(requester.department || "").toLowerCase();
              const allowedDepts: string[] = [
                ...(Array.isArray(requester.allowedDepartments) ? requester.allowedDepartments : []),
                ...(Array.isArray(requester.accessList) ? requester.accessList : [])
              ].map((d: string) => String(d).toLowerCase());

              const isSuperOrAdmin = userRole === "super_admin" || userRole === "admin" || userDept === "admin" || userDept === "management";
              const targetDept = (movData.toDepartment || "").trim();
              const isTargetAuthorized = isSuperOrAdmin || 
                userDept === targetDept.toLowerCase() ||
                allowedDepts.includes(targetDept.toLowerCase());

              if (!isTargetAuthorized) {
                const err: any = new Error(`Forbidden: User '${authoritativeUserName}' (${requester.department}) is not authorized to accept material transfers for '${targetDept}'.`);
                err.statusCode = 403;
                throw err;
              }

              let jcSnap: any = null;
              let jcRef: any = null;
              const rawJobCardNo = String(movData.jobCardNo || "").trim();
              const targetJobCardNo = rawJobCardNo.toUpperCase();
              if (targetJobCardNo && !targetJobCardNo.startsWith("STOCK-IN-")) {
                const upperRef = db.collection("mfr_job_cards").doc(targetJobCardNo);
                const upperSnap = await transaction.get(upperRef);
                let asIsSnap: any = null;
                let asIsRef: any = null;
                if (rawJobCardNo && rawJobCardNo !== targetJobCardNo) {
                  asIsRef = db.collection("mfr_job_cards").doc(rawJobCardNo);
                  asIsSnap = await transaction.get(asIsRef);
                }
                const resolvedId = resolveExistingJobCardDocId(rawJobCardNo, (id) => {
                  if (id === targetJobCardNo) return Boolean(upperSnap.exists);
                  if (id === rawJobCardNo) return Boolean(asIsSnap?.exists);
                  return false;
                });
                if (resolvedId === targetJobCardNo) {
                  jcRef = upperRef;
                  jcSnap = upperSnap;
                } else if (resolvedId === rawJobCardNo && asIsRef) {
                  jcRef = asIsRef;
                  jcSnap = asIsSnap;
                }
              }

              // ============================================================
              // PHASE 2: ALL TRANSACTION WRITES (ONLY AFTER ALL READS DONE)
              // ============================================================
              const isRawMaterialStoreIssuing = movData.isIssueRequest && 
                                                movData.fromDepartment === 'Raw Material Store' && 
                                                movData.toDepartment === 'Production' && 
                                                issueStatus === 'Issued';

              const updatedMov: any = {
                ...movData,
                modifiedByUserId: authoritativeUserId,
                modifiedByUserName: authoritativeUserName,
                modifiedDate: now,
                modifiedAction: 'ACCEPT'
              };

              if (isRawMaterialStoreIssuing) {
                updatedMov.accepted = false;
                if (remarks) updatedMov.remarks = remarks;
                if (allottedLocation !== undefined) updatedMov.allottedLocation = allottedLocation;
                if (rackNo !== undefined) updatedMov.rackNo = rackNo;
                if (quantity !== undefined) updatedMov.quantity = Number(quantity);
                if (issueStatus !== undefined) updatedMov.issueStatus = issueStatus;
              } else {
                updatedMov.accepted = true;
                updatedMov.acceptedBy = authoritativeUserName;
                updatedMov.acceptedByUserId = authoritativeUserId;
                updatedMov.acceptedDate = now;
                if (remarks) updatedMov.remarks = remarks;
                if (allottedLocation !== undefined) updatedMov.allottedLocation = allottedLocation;
                if (rackNo !== undefined) updatedMov.rackNo = rackNo;
                if (quantity !== undefined) updatedMov.quantity = Number(quantity);
                if (issueStatus !== undefined) updatedMov.issueStatus = issueStatus;
                else if (movData.isIssueRequest) updatedMov.issueStatus = 'Issued';
              }

              transaction.set(movRef, updatedMov);

              let updatedJobCard: any = null;
              if (jcRef && jcSnap?.exists) {
                const jcData = jcSnap.data();
                if (jcData) {
                  const nextVersion = (jcData.version || 1) + 1;
                  const destDept = applyAcceptanceDepartment(updatedMov);
                  const nextStatus = nextStatusOnAccept(destDept || updatedMov.toDepartment);
                  const pendingOutbound = clearPendingOutbound(jcData, updatedMov);

                  updatedJobCard = {
                    ...jcData,
                    currentDepartment: destDept,
                    status: nextStatus,
                    currentQty: updatedMov.quantity || jcData.currentQty,
                    balanceQty: updatedMov.quantity || jcData.balanceQty,
                    version: nextVersion,
                    pendingOutbound,
                    updatedAt: now,
                    updatedBy: authoritativeUserName,
                    updatedByUserId: authoritativeUserId
                  };
                  transaction.set(jcRef, updatedJobCard);
                  inMemoryJobCards.set(String(jcRef.id), updatedJobCard);
                  inMemoryJobCards.set(targetJobCardNo, updatedJobCard);
                  if (rawJobCardNo) inMemoryJobCards.set(rawJobCardNo, updatedJobCard);
                }
              }

              // Audit Log (Immutable)
              const auditId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
              const auditRef = db.collection("mfr_audit_logs").doc(auditId);
              const auditData = {
                id: auditId,
                timestamp: now,
                userId: authoritativeUserId,
                userName: authoritativeUserName,
                action: "ACCEPT_MATERIAL",
                details: `User ${authoritativeUserName} accepted material movement ${movementId}: Confirmed transfer of ${updatedMov.quantity} KG for ${updatedMov.jobCardNo} at ${updatedMov.toDepartment}.`
              };
              transaction.set(auditRef, auditData);

              // Notification to sender department
              if (updatedMov.fromDepartment) {
                const notifId = `N-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                const notifRef = db.collection("mfr_notifications").doc(notifId);
                const notifData = {
                  notificationId: notifId,
                  department: updatedMov.fromDepartment,
                  title: 'Material Accepted',
                  message: `${authoritativeUserName} accepted ${updatedMov.quantity} KG for Job Card ${updatedMov.jobCardNo} at ${updatedMov.toDepartment}.`,
                  userId: `all_${updatedMov.fromDepartment.toLowerCase().replace(/\s+/g, '_')}`,
                  read: false,
                  createdAt: now
                };
                transaction.set(notifRef, notifData);
              }

              return {
                isCached: false,
                movement: updatedMov,
                jobCard: updatedJobCard
              };
            });

            const txResult: any = await Promise.race([
              txPromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK accept transaction timeout")), 3500))
            ]);

            finalMovement = txResult.movement;
            finalJobCard = txResult.jobCard;
          }
        } catch (adminErr: any) {
          if (adminErr.statusCode) {
            return res.status(adminErr.statusCode).json({ success: false, error: adminErr.message });
          }
          console.warn("[ACCEPT MOVEMENT] Admin SDK failed, falling back to REST:", adminErr);
        }
      }

      // REST Fallback if Admin SDK is offline
      if (!finalMovement) {
        let movData = inMemoryMovements.get(movementId);
        if (!movData) {
          movData = await firestoreRestGetDoc("mfr_movements", movementId);
        }
        if (!movData) {
          return res.status(404).json({ success: false, error: `Movement ${movementId} not found.` });
        }

        const userRole = String(requester.role || "staff").toLowerCase();
        const userDept = String(requester.department || "").toLowerCase();
        const allowedDepts: string[] = [
          ...(Array.isArray(requester.allowedDepartments) ? requester.allowedDepartments : []),
          ...(Array.isArray(requester.accessList) ? requester.accessList : [])
        ].map((d: string) => String(d).toLowerCase());

        const isSuperOrAdmin = userRole === "super_admin" || userRole === "admin" || userDept === "admin" || userDept === "management";
        const targetDept = (movData.toDepartment || "").trim();
        const isTargetAuthorized = isSuperOrAdmin || 
          userDept === targetDept.toLowerCase() ||
          allowedDepts.includes(targetDept.toLowerCase());

        if (!isTargetAuthorized) {
          return res.status(403).json({
            success: false,
            error: `Forbidden: User '${authoritativeUserName}' is not authorized to accept material transfers for '${targetDept}'.`
          });
        }

        const updatedMov: any = {
          ...movData,
          accepted: true,
          acceptedBy: authoritativeUserName,
          acceptedByUserId: authoritativeUserId,
          acceptedDate: now,
          modifiedByUserId: authoritativeUserId,
          modifiedByUserName: authoritativeUserName,
          modifiedDate: now,
          modifiedAction: 'ACCEPT'
        };
        if (remarks) updatedMov.remarks = remarks;
        if (quantity !== undefined) updatedMov.quantity = Number(quantity);

        await firestoreRestSetDoc("mfr_movements", movementId, updatedMov);
        finalMovement = updatedMov;

        const targetJobCardNo = movData.jobCardNo || '';
        if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
          let activeJobId = targetJobCardNo.toUpperCase();
          let jcData = inMemoryJobCards.get(activeJobId) || inMemoryJobCards.get(targetJobCardNo);
          if (!jcData) {
            jcData = await firestoreRestGetDoc("mfr_job_cards", activeJobId);
            if (!jcData) {
              jcData = await firestoreRestGetDoc("mfr_job_cards", targetJobCardNo);
              activeJobId = targetJobCardNo;
            }
          }
          if (jcData) {
            const destDept = applyAcceptanceDepartment(updatedMov);
            const nextStatus = nextStatusOnAccept(destDept || updatedMov.toDepartment);
            const updatedJc = {
              ...jcData,
              currentDepartment: destDept,
              status: nextStatus,
              currentQty: updatedMov.quantity || jcData.currentQty,
              balanceQty: updatedMov.quantity || jcData.balanceQty,
              version: (jcData.version || 1) + 1,
              pendingOutbound: clearPendingOutbound(jcData, updatedMov),
              updatedAt: now,
              updatedBy: authoritativeUserName,
              updatedByUserId: authoritativeUserId
            };
            await firestoreRestSetDoc("mfr_job_cards", activeJobId, updatedJc);
            inMemoryJobCards.set(activeJobId, updatedJc);
            inMemoryJobCards.set(targetJobCardNo.toUpperCase(), updatedJc);
            inMemoryJobCards.set(targetJobCardNo, updatedJc);
            finalJobCard = updatedJc;
          }
        }
      }

      if (finalMovement) inMemoryMovements.set(movementId, finalMovement);
      if (finalJobCard && finalJobCard.jobCardNo) {
        inMemoryJobCards.set(String(finalJobCard.jobCardNo).toUpperCase(), finalJobCard);
      }

      broadcastRealtimeEvent("MOVEMENT_UPDATED", { movementId, jobCardNo: finalMovement?.jobCardNo });
      if (finalMovement?.jobCardNo) {
        broadcastRealtimeEvent("JOB_UPDATED", { jobCardNo: finalMovement.jobCardNo });
      }
      broadcastRealtimeEvent("NOTIFICATION_UPDATED", {});

      return res.json({
        success: true,
        movement: finalMovement,
        jobCard: finalJobCard
      });
    } catch (err: any) {
      console.error("[ACCEPT MOVEMENT] Error:", err);
      const status = err.statusCode || 500;
      return res.status(status).json({ success: false, error: err.message || "Failed to accept material transfer." });
    }
  });

  // POST /api/movements/:movementId/reject — Authoritative Atomic Material Rejection
  app.post("/api/movements/:movementId/reject", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      const movementId = req.params.movementId;
      const { remarks } = req.body || {};

      if (!authUid || !requester) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      }

      const authoritativeUserId = authUid;
      const authoritativeUserName = requester.name || requester.userId || "Authorized User";
      const now = new Date().toISOString();

      let finalMovement: any = null;

      if (true) {
        try {
          const db = getFirestoreAdmin();
          if (db) {
            const movRef = db.collection("mfr_movements").doc(movementId);

            const txPromise = db.runTransaction(async (transaction) => {
              // --- 1. ALL READS FIRST ---
              const movSnap = await transaction.get(movRef);
              if (!movSnap.exists) {
                const err: any = new Error(`Movement ${movementId} not found.`);
                err.statusCode = 404;
                throw err;
              }

              const movData = movSnap.data() as any;
              let jcSnap: any = null;
              let jcRef: any = null;
              const targetJobCardNo = (movData.jobCardNo || '').toUpperCase().trim();

              if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
                jcRef = db.collection("mfr_job_cards").doc(targetJobCardNo);
                jcSnap = await transaction.get(jcRef);
              }

              // --- 2. ALL WRITES ---
              const updatedMov: any = {
                ...movData,
                accepted: false,
                issueStatus: 'Rejected',
                rejectionRemarks: remarks || '',
                rejectedBy: authoritativeUserName,
                rejectedByUserId: authoritativeUserId,
                rejectedDate: now,
                modifiedByUserId: authoritativeUserId,
                modifiedByUserName: authoritativeUserName,
                modifiedDate: now,
                modifiedAction: 'REJECT'
              };
              transaction.set(movRef, updatedMov);

              if (jcSnap && jcSnap.exists && jcRef) {
                const jcData = jcSnap.data() as any;
                const updatedJc = {
                  ...jcData,
                  status: 'Pending Acceptance',
                  remarks: `Transfer rejected from ${movData.fromDepartment} to ${movData.toDepartment}. Reason: ${remarks || 'Rejected'}`,
                  updatedAt: now,
                  updatedBy: authoritativeUserName,
                  updatedByUserId: authoritativeUserId
                };
                transaction.set(jcRef, updatedJc);
                inMemoryJobCards.set(targetJobCardNo, updatedJc);
              }

              const auditId = `AL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
              const auditRef = db.collection("mfr_audit_logs").doc(auditId);
              const auditData = {
                id: auditId,
                timestamp: now,
                userId: authoritativeUserId,
                userName: authoritativeUserName,
                action: "REJECT_MATERIAL",
                details: `User ${authoritativeUserName} rejected material movement ${movementId} for ${movData.jobCardNo}. Reason: ${remarks || 'None'}`
              };
              transaction.set(auditRef, auditData);

              if (movData.fromDepartment) {
                const notifId = `N-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                const notifRef = db.collection("mfr_notifications").doc(notifId);
                const notifData = {
                  notificationId: notifId,
                  department: movData.fromDepartment,
                  title: 'Material Transfer Rejected',
                  message: `${authoritativeUserName} rejected transfer for Job Card ${movData.jobCardNo}. Reason: ${remarks || 'Rejected'}`,
                  userId: `all_${movData.fromDepartment.toLowerCase().replace(/\s+/g, '_')}`,
                  read: false,
                  createdAt: now
                };
                transaction.set(notifRef, notifData);
              }

              return { movement: updatedMov };
            });

            const txResult: any = await Promise.race([
              txPromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK reject transaction timeout")), 3500))
            ]);

            finalMovement = txResult.movement;
          }
        } catch (adminErr: any) {
          if (adminErr.statusCode) {
            return res.status(adminErr.statusCode).json({ success: false, error: adminErr.message });
          }
          console.warn("[REJECT MOVEMENT] Admin SDK failed, falling back to REST:", adminErr);
        }
      }

      if (!finalMovement) {
        let movData = inMemoryMovements.get(movementId);
        if (!movData) {
          movData = await firestoreRestGetDoc("mfr_movements", movementId);
        }
        if (!movData) return res.status(404).json({ success: false, error: `Movement ${movementId} not found.` });

        const updatedMov = {
          ...movData,
          accepted: false,
          issueStatus: 'Rejected',
          rejectionRemarks: remarks || '',
          rejectedBy: authoritativeUserName,
          rejectedByUserId: authoritativeUserId,
          rejectedDate: now,
          modifiedAction: 'REJECT'
        };
        await firestoreRestSetDoc("mfr_movements", movementId, updatedMov);
        finalMovement = updatedMov;
      }

      if (finalMovement) inMemoryMovements.set(movementId, finalMovement);

      broadcastRealtimeEvent("MOVEMENT_UPDATED", { movementId, jobCardNo: finalMovement?.jobCardNo });
      broadcastRealtimeEvent("NOTIFICATION_UPDATED", {});

      return res.json({ success: true, movement: finalMovement });
    } catch (err: any) {
      console.error("[REJECT MOVEMENT] Error:", err);
      const status = err.statusCode || 500;
      return res.status(status).json({ success: false, error: err.message || "Failed to reject material transfer." });
    }
  });

  // GET /api/movements — Authoritative Movements Retrieval
  app.get("/api/movements", requireFirebaseAuth, async (req, res) => {
    try {
      let movements: any[] = [];
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const snapPromise = dbAdmin.collection("mfr_movements").get();
          const snap: any = await Promise.race([
            snapPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK movements timeout")), 2500))
          ]);
          movements = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        }
      } catch (adminErr) {}

      if (movements.length === 0) {
        const restResult = await firestoreRestQueryAll("mfr_movements");
        if (Array.isArray(restResult)) {
          movements = restResult;
        }
      }

      // Merge in-memory movements
      inMemoryMovements.forEach((val, key) => {
        if (!movements.some((m: any) => (m.movementId || m.id) === key)) {
          movements.push(val);
        }
      });

      // Check deleted/tombstoned movements
      const deletedIds = new Set<string>();
      try {
        const dbAdmin = getFirestoreAdmin();
        if (dbAdmin) {
          const tombPromise = dbAdmin.collection("mfr_deleted_movements").get();
          const tombSnap: any = await Promise.race([
            tombPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Admin SDK tombstone timeout")), 1500))
          ]);
          tombSnap.docs.forEach((d: any) => deletedIds.add(d.id));
        }
      } catch (_) {}

      const activeMovements = movements.filter((m: any) => {
        if (!m || !m.movementId) return false;
        if (deletedIds.has(m.movementId) || m.isDeleted) return false;
        return true;
      }).sort((a, b) => new Date(b.transferDate || 0).getTime() - new Date(a.transferDate || 0).getTime());

      return res.json({ success: true, movements: activeMovements });
    } catch (err: any) {
      console.error("[MOVEMENTS] Error fetching movements:", err);
      return res.status(500).json({ success: false, error: "Failed to retrieve movements" });
    }
  });

  // POST /api/movements — Authoritative Movement Creation
  app.post("/api/movements", requireFirebaseAuth, handleAuthoritativeMovementCommit);

  // Global log for all triggered emails (in-memory persistent state)
  interface SentEmail {
    id: string;
    timestamp: string;
    subject: string;
    recipient: string;
    executiveSummary: string;
    criticalBottlenecks: string[];
    recommendedActions: string[];
    htmlBody: string;
    status: 'sent' | 'queued' | 'simulated';
    error?: string;
  }

  const sentEmailsLog: SentEmail[] = [
    {
      id: "se-1",
      timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
      subject: "[Daily Operations Summary] PMW Factory Yield: 97.4% with 2 Pending Completions",
      recipient: "pawan.kummar16@gmail.com",
      executiveSummary: "Factory operations run within normal limits. Materials dispatch and heat treatment schedules are on track. Minor scrap accumulation of 50 KG observed in JC-1002.",
      criticalBottlenecks: [
        "Moderate scrap loss (10%) detected in Production department for JC-1002."
      ],
      recommendedActions: [
        "Audit tool alignment on trimming machinery to prevent future edge fractures.",
        "Calibrate temperature levels on furnace B ahead of upcoming high-volume alloy run."
      ],
      htmlBody: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4F46E5; margin-bottom: 20px;">Daily Operations Summary Log</h2>
          <p><strong>Date:</strong> Yesterday</p>
          <p>This is a simulated entry documenting past scheduled runs of the automated reporting cloud function.</p>
        </div>
      `,
      status: "simulated"
    }
  ];

  // GET sent emails outbox
  app.get("/api/sent-emails", requireFirebaseAuth, (req, res) => {
    res.json(sentEmailsLog);
  });

  // POST trigger automated daily report email
  app.post("/api/trigger-daily-summary", requireFirebaseAuth, async (req, res) => {
    try {
      const { jobCards = [], movements = [], recipient } = req.body;
      const targetRecipient = recipient || process.env.ADMIN_EMAIL || "pawan.kummar16@gmail.com";
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not defined");
      }
      
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Prepare stats
      const totalJobCards = jobCards.length;
      const pendingJobs = jobCards.filter((c: any) => !c.completed);
      const completedJobs = jobCards.filter((c: any) => c.completed);
      
      const totalOrderQty = jobCards.reduce((acc: number, c: any) => acc + (c.orderQty || 0), 0);
      const totalPendingQty = pendingJobs.reduce((acc: number, c: any) => acc + (c.balanceQty || 0), 0);
      
      // Calculate department rejections
      const deptRejections: Record<string, { processed: number; rejected: number }> = {
        'Production': { processed: 0, rejected: 0 },
        'Heat Treatment': { processed: 0, rejected: 0 },
        'Plating': { processed: 0, rejected: 0 },
        'Packing': { processed: 0, rejected: 0 },
        'Store': { processed: 0, rejected: 0 }
      };

      jobCards.forEach((jc: any) => {
        deptRejections['Production'].processed += jc.orderQty || 0;
        if (jc.status === 'Rejected' && jc.currentDepartment === 'Production') {
          deptRejections['Production'].rejected += jc.orderQty || 0;
        }

        if (jc.heatTreatmentRequired) {
          const htDet = jc.heatTreatmentDetails;
          const htProcessed = htDet?.qtyReceivedFromProd || 0;
          const htRejections = htDet?.rejectionQty || 0;
          deptRejections['Heat Treatment'].processed += htProcessed;
          deptRejections['Heat Treatment'].rejected += htRejections;
        }

        const platDet = jc.platingDetails;
        const platProcessed = platDet?.qtyReceivedFromHt || 0;
        const platRejections = platDet?.rejectionQty || 0;
        deptRejections['Plating'].processed += platProcessed;
        deptRejections['Plating'].rejected += platRejections;

        const packDet = jc.packingDetails;
        const packProcessed = packDet?.qtyReceivedFromPlating || 0;
        const packRejections = packDet?.rejectionQty || 0;
        deptRejections['Packing'].processed += packProcessed;
        deptRejections['Packing'].rejected += packRejections;

        const storeDet = jc.storeDetails;
        const storeProcessed = storeDet?.qtyReceivedFromPacking || 0;
        const storeRejections = storeDet?.rejectionQty || 0;
        deptRejections['Store'].processed += storeProcessed;
        deptRejections['Store'].rejected += storeRejections;
      });

      const processedStats = Object.entries(deptRejections).map(([dept, val]) => {
        const rate = val.processed > 0 ? (val.rejected / val.processed) * 100 : 0;
        return {
          department: dept,
          processedKg: val.processed,
          rejectedKg: val.rejected,
          rejectionRate: `${rate.toFixed(2)}%`
        };
      });

      const activeJobsList = pendingJobs.map((c: any) => ({
        jobCardNo: c.jobCardNo,
        partyName: c.partyName,
        itemName: c.itemName,
        currentQty: c.currentQty,
        balanceQty: c.balanceQty,
        currentDepartment: c.currentDepartment,
        status: c.status,
        createdAt: c.createdAt
      }));

      const systemContext = `
        You are an advanced industrial operations and quality analysis AI daemon at Precision Metal Works.
        Your task is to review the active operations state, pending job cards, and departmental rejection statistics, and generate a comprehensive executive email notification.
        
        DATA FOR ANALYSIS:
        - Total Job Cards: ${totalJobCards}
        - Pending/In-Progress Job Cards: ${pendingJobs.length} (${totalPendingQty} KG remaining)
        - Completed Job Cards: ${completedJobs.length}
        - Department Rejection Metrics: ${JSON.stringify(processedStats)}
        - Active Job Cards: ${JSON.stringify(activeJobsList)}
      `;

      const promptText = `Generate a daily executive summary report for the admin team.
        Review all pending completions and departmental quality rates.
        Ensure your "htmlBody" is a stunningly designed responsive HTML template with inline styles, custom typography, slate-900 styled table rows, highlighted alert boxes for high rejection rates (e.g. over 5%), and visual sections for corrective recommendations. Make it look like a high-end email notification sent from a premium enterprise platform. Do not include external assets or image placeholders, only use clean HTML/CSS with standard colors (indigo \`#4F46E5\`, slate \`#1E293B\`, emerald \`#10B981\`, rose \`#EF4444\`).`;

      let reportData: any;
      try {
        const geminiResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: promptText,
          config: {
            systemInstruction: systemContext,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                subject: {
                  type: Type.STRING,
                  description: "The professional, concise subject line of the daily automated operations mail."
                },
                executiveSummary: {
                  type: Type.STRING,
                  description: "High-level summary of factory yield, completions, and operations for the admin dashboard (2-3 sentences)."
                },
                criticalBottlenecks: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Array of detected process anomalies, high-rejection departments, or overdue job cards."
                },
                recommendedActions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Strategic action steps the management team should execute to resolve bottlenecks."
                },
                htmlBody: {
                  type: Type.STRING,
                  description: "Complete, responsive, production-ready, beautifully designed inline-styled HTML email body."
                }
              },
              required: ["subject", "executiveSummary", "criticalBottlenecks", "recommendedActions", "htmlBody"]
            }
          }
        });

        const textOutput = geminiResponse.text;
        if (!textOutput) {
          throw new Error("Failed to receive structured report content from Gemini");
        }

        reportData = JSON.parse(textOutput);
      } catch (geminiError: any) {
        console.warn("Gemini compilation failed (quota/billing depleted). Initiating rule-based heuristic fallback generator:", geminiError);
        
        const highRejectionDepts = processedStats.filter((s: any) => parseFloat(s.rejectionRate) > 5.0).map((s: any) => s.department);
        const activeYield = totalJobCards > 0 ? ((completedJobs.length / totalJobCards) * 100).toFixed(1) : "100.0";
        
        const subject = `[Daily Operations Summary] PMW Factory Yield: ${activeYield}% with ${pendingJobs.length} Pending Completions`;
        const executiveSummary = `This automated report summary was generated via high-fidelity rule-based manufacturing heuristics. Currently, Precision Metal Works is tracking ${pendingJobs.length} pending/in-progress job cards representing a remaining material balance of ${totalPendingQty} KG. A total of ${completedJobs.length} job cards have been successfully closed and moved to the store. Current departmental material quality and throughput metrics are documented below.`;
        
        const criticalBottlenecks: string[] = [];
        if (highRejectionDepts.length > 0) {
          highRejectionDepts.forEach((dept: string) => {
            const stat = processedStats.find((s: any) => s.department === dept);
            criticalBottlenecks.push(`Elevated material rejection rate detected in ${dept} department: ${stat?.rejectionRate} (${stat?.rejectedKg} KG rejected out of ${stat?.processedKg} KG processed).`);
          });
        } else {
          criticalBottlenecks.push("All active production departments are performing within normal operational tolerances (rejections under 5.0%).");
        }
        
        const rejectedJobs = pendingJobs.filter((jc: any) => jc.status === 'Rejected');
        if (rejectedJobs.length > 0) {
          criticalBottlenecks.push(`${rejectedJobs.length} active job cards are flagged with "Rejected" status and require immediate rework evaluation (e.g., ${rejectedJobs.slice(0, 2).map((j: any) => j.jobCardNo).join(', ')}).`);
        }
        
        const recommendedActions: string[] = [];
        if (highRejectionDepts.length > 0) {
          recommendedActions.push(`Deploy quality assurance supervisors to review machine calibration and operator procedures in: ${highRejectionDepts.join(', ')}.`);
        } else {
          recommendedActions.push("Maintain standard production throughput speed with regular daily equipment maintenance checkups.");
        }
        recommendedActions.push("Prioritize processing for job cards with small remaining balances to expedite order completions and free floor space.");
        if (rejectedJobs.length > 0) {
          recommendedActions.push(`Initiate immediate material rework protocols or log scrap salvage transactions for rejected job cards: ${rejectedJobs.map((j: any) => j.jobCardNo).join(', ')}.`);
        }
        recommendedActions.push("Audit store receiving logs to verify that packing dispatch inventories perfectly sync with active ledger totals.");

        const statsRows = processedStats.map((s: any) => {
          const isHigh = parseFloat(s.rejectionRate) > 5.0;
          const rateColor = isHigh ? '#EF4444' : '#10B981';
          const rateWeight = isHigh ? 'bold' : 'normal';
          return `
            <tr style="border-bottom: 1px solid #E2E8F0;">
              <td style="padding: 12px; font-weight: 500; color: #1E293B;">${s.department}</td>
              <td style="padding: 12px; text-align: right; color: #475569;">${s.processedKg} KG</td>
              <td style="padding: 12px; text-align: right; color: #EF4444;">${s.rejectedKg} KG</td>
              <td style="padding: 12px; text-align: right; color: ${rateColor}; font-weight: ${rateWeight};">${s.rejectionRate}</td>
            </tr>
          `;
        }).join('');

        const bottleneckItems = criticalBottlenecks.map((b: string) => `
          <li style="margin-bottom: 8px; color: #E11D48; font-weight: 500;">
            <span style="color: #475569; font-weight: normal;">${b}</span>
          </li>
        `).join('');

        const recommendationItems = recommendedActions.map((a: string) => `
          <li style="margin-bottom: 8px; color: #4F46E5; font-weight: 500;">
            <span style="color: #475569; font-weight: normal;">${a}</span>
          </li>
        `).join('');

        const htmlBody = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>PMW Automated Operations Report</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; color: #334155;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; padding: 24px 0;">
              <tr>
                <td align="center">
                  <table width="640" border="0" cellspacing="0" cellpadding="0" style="background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <tr style="background-color: #1E293B;">
                      <td style="padding: 32px 24px; text-align: left;">
                        <h1 style="margin: 0; color: #FFFFFF; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Precision Metal Works</h1>
                        <p style="margin: 4px 0 0 0; color: #94A3B8; font-size: 13px; font-weight: 500;">DAILY OPERATIONS & QUALITY LEDGER</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 32px 24px;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                          <tr>
                            <td width="31%" style="background-color: #F1F5F9; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #64748B; font-weight: 600; text-transform: uppercase;">Total Orders</span>
                              <span style="display: block; font-size: 24px; color: #1E293B; font-weight: 700; margin-top: 4px;">${totalJobCards}</span>
                            </td>
                            <td width="3%"></td>
                            <td width="32%" style="background-color: #EEF2FF; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #4F46E5; font-weight: 600; text-transform: uppercase;">Active / Pending</span>
                              <span style="display: block; font-size: 24px; color: #4F46E5; font-weight: 700; margin-top: 4px;">${pendingJobs.length}</span>
                            </td>
                            <td width="3%"></td>
                            <td width="31%" style="background-color: #ECFDF5; border-radius: 8px; padding: 16px; text-align: center;">
                              <span style="display: block; font-size: 11px; color: #059669; font-weight: 600; text-transform: uppercase;">Completed</span>
                              <span style="display: block; font-size: 24px; color: #059669; font-weight: 700; margin-top: 4px;">${completedJobs.length}</span>
                            </td>
                          </tr>
                        </table>
                        <h2 style="font-size: 15px; color: #1E293B; font-weight: 600; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">Executive Summary</h2>
                        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin-top: 0; margin-bottom: 24px;">
                          ${executiveSummary}
                        </p>
                        <h2 style="font-size: 15px; color: #1E293B; font-weight: 600; margin-top: 0; margin-bottom: 12px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px;">Departmental Material Quality Audit</h2>
                        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
                          <tr style="background-color: #F8FAFC; border-bottom: 2px solid #E2E8F0;">
                            <th align="left" style="padding: 12px; color: #64748B; font-weight: 600;">Department</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Processed (KG)</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Rejected (KG)</th>
                            <th align="right" style="padding: 12px; color: #64748B; font-weight: 600;">Rejection Rate</th>
                          </tr>
                          ${statsRows}
                        </table>
                        <div style="background-color: #FFF1F2; border-left: 4px solid #F43F5E; border-radius: 4px; padding: 16px; margin-bottom: 24px;">
                          <h3 style="font-size: 14px; color: #9F1239; font-weight: 600; margin-top: 0; margin-bottom: 8px;">Critical Bottlenecks & Anomalies</h3>
                          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.5; color: #475569;">
                            ${bottleneckItems}
                          </ul>
                        </div>
                        <div style="background-color: #F5F3FF; border-left: 4px solid #8B5CF6; border-radius: 4px; padding: 16px; margin-bottom: 0;">
                          <h3 style="font-size: 14px; color: #5B21B6; font-weight: 600; margin-top: 0; margin-bottom: 8px;">Recommended Operational Actions</h3>
                          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.5; color: #475569;">
                            ${recommendationItems}
                          </ul>
                        </div>
                      </td>
                    </tr>
                    <tr style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0;">
                      <td style="padding: 24px; text-align: center; font-size: 11px; color: #94A3B8;">
                        <p style="margin: 0 0 4px 0;">This email is an automated transmission from the PMW Manufacturing Ledger platform.</p>
                        <p style="margin: 0;">Precision Metal Works © 2026. All rights reserved.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        reportData = {
          subject,
          executiveSummary,
          criticalBottlenecks,
          recommendedActions,
          htmlBody
        };
      }

      // Attempt to transmit email via Nodemailer if SMTP secrets are defined
      let mailStatus: 'sent' | 'queued' | 'simulated' = 'queued';
      let mailError: string | undefined = undefined;

      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          });

          await transporter.sendMail({
            from: `"PMW Automated Operations" <${process.env.SMTP_USER}>`,
            to: targetRecipient,
            subject: reportData.subject,
            html: reportData.htmlBody,
          });

          mailStatus = 'sent';
          console.log(`Daily operations report sent successfully to ${targetRecipient}`);
        } catch (err: any) {
          mailStatus = 'queued';
          mailError = err instanceof Error ? err.message : String(err);
          console.warn("SMTP send failed, email logged to system outbox queue:", mailError);
        }
      } else {
        mailStatus = 'queued';
        console.info(`SMTP credentials not defined. Report successfully compiled and queued in simulated Outbox. Recipient: ${targetRecipient}`);
      }

      const newEmailRecord: SentEmail = {
        id: `se-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subject: reportData.subject,
        recipient: targetRecipient,
        executiveSummary: reportData.executiveSummary,
        criticalBottlenecks: reportData.criticalBottlenecks,
        recommendedActions: reportData.recommendedActions,
        htmlBody: reportData.htmlBody,
        status: mailStatus,
        error: mailError
      };

      sentEmailsLog.unshift(newEmailRecord);

      res.json({
        success: true,
        record: newEmailRecord,
        smtpConfigured: !!process.env.SMTP_HOST
      });

    } catch (error: any) {
      console.error("Daily summary compile error:", error);
      res.status(500).json({ error: "Failed to compile automated daily summary", details: error.message });
    }
  });

  // ----------------------------------------------------
  // STORE PROCESS TRANSFERS (REPACKING & REPLATING)
  // ----------------------------------------------------

  // GET /api/process-transfers
  app.get("/api/process-transfers", requireFirebaseAuth, async (req, res) => {
    try {
      let transfersList: any[] = [];
      let readViaAdmin = false;
      try {
        const admin = getFirestoreAdmin();
        if (admin) {
          const snap = await admin.collection("mfr_process_transfers").orderBy("createdAt", "desc").get();
          transfersList = snap.docs.map((d: any) => d.data());
          readViaAdmin = true;
        }
      } catch (adminErr) {}

      if (!readViaAdmin) {
        const restResult = await firestoreRestQueryAll("mfr_process_transfers");
        if (Array.isArray(restResult)) {
          transfersList = restResult;
        }
      }

      return res.json({ success: true, transfers: transfersList });
    } catch (err: any) {
      console.error("GET /api/process-transfers error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/process-transfers
  app.post("/api/process-transfers", requireFirebaseAuth, async (req, res) => {
    try {
      const authUid = (req as any).authUid;
      const requester = (req as any).user;
      const body = req.body || {};
      const { jobCardNo, quantity, unit, toProcess, remarks, idempotencyKey } = body;

      if (!jobCardNo || !quantity || Number(quantity) <= 0) {
        return res.status(400).json({ success: false, error: "Valid Job Card and quantity > 0 are required." });
      }
      if (toProcess !== "Repacking" && toProcess !== "Replating") {
        return res.status(400).json({ success: false, error: "Process destination must be either 'Repacking' or 'Replating'." });
      }

      const userRole = String(requester?.role || "").toLowerCase();
      const userDept = String(requester?.department || "").toLowerCase();
      const allowed = [...(requester?.allowedDepartments || []), ...(requester?.accessList || [])].map((d: string) => String(d).toLowerCase());
      const isAdmin = userRole === "super_admin" || userRole === "admin" || userDept === "admin";
      if (!isAdmin && userDept !== "store" && !allowed.includes("store")) {
        return res.status(403).json({ success: false, error: "Forbidden: Store department authorization is required to create process transfers." });
      }

      const idemp = String(idempotencyKey || "").trim();
      if (idemp) {
        const existing = await firestoreRestGetDoc("mfr_idempotency_keys", `pt-${idemp}`);
        if (existing?.result?.transfer) {
          return res.json({ success: true, cached: true, transfer: existing.result.transfer });
        }
      }

      const job = await firestoreRestGetDoc("mfr_job_cards", String(jobCardNo).toUpperCase())
        || await firestoreRestGetDoc("mfr_job_cards", jobCardNo);
      if (!job) {
        return res.status(404).json({ success: false, error: `Job Card '${jobCardNo}' not found.` });
      }
      const available = Number(job.storeDetails?.qtyRemaining ?? job.currentQty ?? job.orderQty ?? 0);
      if (Number(quantity) > available) {
        return res.status(400).json({ success: false, error: `Insufficient store quantity. Requested ${quantity}, available ${available}.` });
      }

      const db = getFirestoreAdmin();
      let nextSeq = 1;
      if (db) {
        await db.runTransaction(async (t: any) => {
          const seqRef = db.collection("mfr_system_state").doc("process_transfer_seq");
          const snap = await t.get(seqRef);
          nextSeq = (snap.exists ? Number(snap.data()?.next || 1) : 1);
          t.set(seqRef, { next: nextSeq + 1, updatedAt: new Date().toISOString() }, { merge: true });
        });
      } else {
        const seqDoc = await firestoreRestGetDoc("mfr_system_state", "process_transfer_seq");
        nextSeq = Number(seqDoc?.next || 1);
        await persistDocsExclusive([{ collection: "mfr_system_state", id: "process_transfer_seq", data: { next: nextSeq + 1, updatedAt: new Date().toISOString() } }]);
      }

      const now = new Date();
      const transferId = `STP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const kind = toProcess as ProcessKind;
      const createdDoc = {
        transferId,
        transferNo: formatStpNumber(nextSeq),
        jobCardNo,
        poNumber: body.poNumber || "",
        orderNo: body.orderNo || "",
        customer: body.customer || "",
        itemName: body.itemName || "",
        itemCode: body.itemCode || "",
        material: body.material || "",
        currentLocation: body.currentLocation || "",
        quantity: Number(quantity),
        unit: unit || "PCS",
        fromLocation: "Store",
        toProcess,
        status: initialProcessTransferStatus(kind),
        transferDate: now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
        transferTime: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        createdBy: requester?.name || "Store User",
        createdByUserId: authUid,
        remarks: remarks || "",
        idempotencyKey: idemp,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      const docs: any[] = [{ collection: "mfr_process_transfers", id: transferId, data: createdDoc }];
      if (idemp) {
        docs.push({ collection: "mfr_idempotency_keys", id: `pt-${idemp}`, data: { operationId: `pt-${idemp}`, result: { transfer: createdDoc }, createdAt: now.toISOString() } });
      }
      await persistDocsExclusive(docs);
      return res.json({ success: true, transfer: createdDoc });
    } catch (err: any) {
      console.error("POST /api/process-transfers error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  async function mutateProcessTransfer(id: string, action: "receive" | "start" | "complete", req: express.Request, res: express.Response) {
    const authUid = (req as any).authUid;
    const requester = (req as any).user;
    const body = req.body || {};
    const db = getFirestoreAdmin();
    let currentData = null as any;
    if (db) {
      const snap = await db.collection("mfr_process_transfers").doc(id).get();
      if (snap.exists) currentData = snap.data();
    }
    if (!currentData) currentData = await firestoreRestGetDoc("mfr_process_transfers", id);
    if (!currentData) {
      return res.status(404).json({ success: false, error: "Transfer not found" });
    }
    const kind = currentData.toProcess as ProcessKind;
    const gate = assertProcessTransferTransition(kind, currentData.status, action);
    if (gate.ok === false) {
      return res.status(400).json({ success: false, error: gate.error });
    }
    const nowIso = new Date().toISOString();
    let updates: any = { ...currentData, status: nextStatusForAction(kind, action), updatedAt: nowIso };
    if (action === "receive") {
      updates.receivedBy = requester?.name;
      updates.receivedByUserId = authUid;
      updates.receivedAt = nowIso;
    } else if (action === "start") {
      updates.inProcessBy = requester?.name;
      updates.inProcessByUserId = authUid;
      updates.inProcessAt = nowIso;
    } else {
      updates.status = "Returned to Store";
      updates.completedBy = requester?.name;
      updates.completedByUserId = authUid;
      updates.completedAt = nowIso;
      updates.completedQty = Number(body.completedQty);
      updates.rejectionQty = Number(body.rejectionQty || 0);
      updates.rejectionReason = body.rejectionReason || "";
      updates.returnedBy = requester?.name;
      updates.returnedByUserId = authUid;
      updates.returnedAt = nowIso;
      updates.returnedQty = Number(body.completedQty);
      updates.returnLocationBin = body.returnBin || "";
      updates.returnRackNo = body.returnRack || "";
    }
    if (body.remarks) {
      updates.remarks = `${currentData.remarks ? currentData.remarks + " | " : ""}${action}: ${body.remarks}`;
    }
    const docs: Array<{ collection: string; id: string; data: any }> = [
      { collection: "mfr_process_transfers", id: currentData.transferId || id, data: updates }
    ];
    if (action === "complete") {
      const auditId = `AL-${Date.now()}-pt`;
      docs.push({
        collection: "mfr_audit_logs",
        id: auditId,
        data: {
          id: auditId,
          timestamp: nowIso,
          userId: authUid,
          userName: requester?.name || authUid,
          action: "PROCESS_TRANSFER_COMPLETE",
          details: `Completed process transfer ${currentData.transferNo || id} and returned ${updates.completedQty || 0} to Store.`
        }
      });
      const notifId = `N-${Date.now()}-pt`;
      docs.push({
        collection: "mfr_notifications",
        id: notifId,
        data: {
          notificationId: notifId,
          department: "Store",
          title: "Process Transfer Returned",
          message: `${requester?.name || "Store"} returned ${updates.completedQty || 0} of ${currentData.jobCardNo} to Store from ${currentData.toProcess}.`,
          userId: "all_store",
          read: false,
          createdAt: nowIso
        }
      });
    }
    await persistDocsExclusive(docs);
    return res.json({ success: true, transfer: updates });
  }

  app.post("/api/process-transfers/:id/receive", requireFirebaseAuth, (req, res) => mutateProcessTransfer(req.params.id, "receive", req, res));
  app.post("/api/process-transfers/:id/start", requireFirebaseAuth, (req, res) => mutateProcessTransfer(req.params.id, "start", req, res));
  app.post("/api/process-transfers/:id/complete", requireFirebaseAuth, (req, res) => mutateProcessTransfer(req.params.id, "complete", req, res));

  app.get("/api/rm-sku-master", requireFirebaseAuth, async (_req, res) => {
    try {
      const capturedAt = new Date().toISOString();
      const list: any[] = [];
      for (const seed of INVENTORY_RAW_MATERIALS_SEED) {
        let existing: any = null;
        const db = getFirestoreAdmin();
        if (db) {
          try {
            const snap = await db.collection("mfr_rm_sku_master").doc(seed.code).get();
            if (snap.exists) existing = snap.data();
          } catch (_) {}
        }
        if (!existing) {
          existing = await firestoreRestGetDoc("mfr_rm_sku_master", seed.code);
        }
        const incoming = seedToMasterDoc(seed, capturedAt);
        const merged = mergeCreateIfMissing(existing, incoming);
        if (!existing) {
          await persistDocsExclusive([{ collection: "mfr_rm_sku_master", id: seed.code, data: merged }]);
        }
        list.push(existing ? existing : merged);
      }
      return res.json({ success: true, skus: list });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Unmatched API routes return 404 JSON (preventing Vite SPA HTML fallback on API endpoints)
  app.all("/api/*", (req, res) => {
    res.status(404).json({ success: false, error: `API endpoint ${req.method} ${req.path} not found.` });
  });

  // Static asset serving for production / compiled frontend with aggressive immutable caching
  const distPath = path.join(process.cwd(), 'dist');
  if (process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true
    }));
    app.use(express.static(distPath, {
      maxAge: '1h',
      etag: true
    }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Initialize system state (load active reset generation) before accepting requests
  await initSystemState().catch(e => console.warn("[SYSTEM] Startup system state init error:", e));

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
