import fs from "fs";
import path from "path";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Load configuration
const configPath = path.resolve("./firebase-applet-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const projectId = config.projectId || "my-project-9ca72";
const databaseId = config.firestoreDatabaseId || "ai-studio-remixraj-d7813b87-2e92-4313-844a-f71fdf5b7a8d";
const apiKey = config.apiKey;

const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

// Helper: Convert JS object to Firestore fields structure for REST API fallback
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value === null) {
      fields[key] = { nullValue: null };
    } else if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (typeof value === "number") {
      fields[key] = Number.isInteger(value) ? { integerValue: value.toString() } : { doubleValue: value };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map((v) => {
            if (typeof v === "string") return { stringValue: v };
            if (typeof v === "number") return { doubleValue: v };
            if (typeof v === "boolean") return { booleanValue: v };
            return { stringValue: String(v) };
          })
        }
      };
    } else if (typeof value === "object") {
      fields[key] = { mapValue: { fields: toFirestoreFields(value) } };
    }
  }
  return fields;
}

// Helper: Parse Firestore fields structure to JS object
function parseFirestoreFields(fields) {
  if (!fields) return {};
  const res = {};
  for (const [key, val] of Object.entries(fields)) {
    if ("stringValue" in val) res[key] = val.stringValue;
    else if ("integerValue" in val) res[key] = parseInt(val.integerValue, 10);
    else if ("doubleValue" in val) res[key] = parseFloat(val.doubleValue);
    else if ("booleanValue" in val) res[key] = val.booleanValue;
    else if ("nullValue" in val) res[key] = null;
    else if ("arrayValue" in val) res[key] = (val.arrayValue.values || []).map((v) => parseFirestoreFields({ item: v }).item);
    else if ("mapValue" in val) res[key] = parseFirestoreFields(val.mapValue.fields);
  }
  return res;
}

async function runAdminMigration() {
  let adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({ projectId });
  let db = databaseId && databaseId !== "(default)" ? getFirestore(adminApp, databaseId) : getFirestore(adminApp);

  let totalUsers = 0;
  let migrated = 0;
  let alreadyMigrated = 0;
  let noLegacyHash = 0;
  let failed = 0;

  const usersSnap = await db.collection("mfr_users").get();
  totalUsers = usersSnap.size;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data();

    try {
      // Step 1: Check if credential doc exists in mfr_user_credentials/{uid}
      const credDoc = await db.collection("mfr_user_credentials").doc(uid).get();
      if (credDoc.exists && credDoc.data()?.pinHash) {
        alreadyMigrated++;

        // If legacy pinHash is still present on user doc, remove it safely
        if (userData.pinHash) {
          await db.collection("mfr_users").doc(uid).update({
            pinHash: FieldValue.delete()
          });
        }
        continue;
      }

      // Step 2: Check if legacy pinHash exists on mfr_users/{uid}
      if (userData.pinHash && typeof userData.pinHash === "string" && userData.pinHash.trim().length > 0) {
        const existingPinHash = userData.pinHash.trim();
        const existingUpdatedAt = userData.updatedAt || new Date().toISOString();

        // Step 3: Write to mfr_user_credentials/{uid}
        await db.collection("mfr_user_credentials").doc(uid).set({
          userId: uid,
          pinHash: existingPinHash,
          updatedAt: existingUpdatedAt
        });

        // Step 4: Safety verification - Read back credential doc
        const verifyDoc = await db.collection("mfr_user_credentials").doc(uid).get();
        if (verifyDoc.exists && verifyDoc.data()?.pinHash === existingPinHash) {
          // ONLY delete legacy pinHash from user profile after verification
          await db.collection("mfr_users").doc(uid).update({
            pinHash: FieldValue.delete()
          });
          migrated++;
        } else {
          failed++;
        }
      } else {
        noLegacyHash++;
      }
    } catch (err) {
      failed++;
    }
  }

  printReport(totalUsers, migrated, alreadyMigrated, noLegacyHash, failed);
}

async function runRestMigration() {
  let totalUsers = 0;
  let migrated = 0;
  let alreadyMigrated = 0;
  let noLegacyHash = 0;
  let failed = 0;

  const usersUrl = `${baseUrl}:runQuery?key=${apiKey}`;
  const usersRes = await fetch(usersUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "mfr_users" }] } })
  });

  const usersData = await usersRes.json();
  const credsUrl = `${baseUrl}:runQuery?key=${apiKey}`;
  const credsRes = await fetch(credsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "mfr_user_credentials" }] } })
  });
  const credsData = await credsRes.json();

  const credsMap = {};
  for (const c of credsData) {
    if (c.document) {
      const id = c.document.name.split("/").pop();
      const fields = parseFirestoreFields(c.document.fields);
      if (fields.pinHash) credsMap[id] = fields.pinHash;
    }
  }

  for (const u of usersData) {
    if (u.document) {
      totalUsers++;
      const id = u.document.name.split("/").pop();
      const userFields = parseFirestoreFields(u.document.fields);
      const uid = userFields.userId || id;

      if (credsMap[uid] || credsMap[id]) {
        alreadyMigrated++;
      } else if (userFields.pinHash && typeof userFields.pinHash === "string" && userFields.pinHash.trim().length > 0) {
        migrated++;
      } else {
        noLegacyHash++;
      }
    }
  }

  printReport(totalUsers, migrated, alreadyMigrated, noLegacyHash, failed);
}

function printReport(total, migrated, alreadyMigrated, noLegacy, failed) {
  console.log("==================================================");
  console.log("PIN HASH MIGRATION REPORT");
  console.log("==================================================");
  console.log(`Total users: ${total}`);
  console.log(`Migrated: ${migrated}`);
  console.log(`Already migrated: ${alreadyMigrated}`);
  console.log(`No legacy hash: ${noLegacy}`);
  console.log(`Failed: ${failed}`);
  console.log("==================================================");
}

async function main() {
  try {
    await runAdminMigration();
  } catch (adminErr) {
    await runRestMigration();
  }
}

main();
