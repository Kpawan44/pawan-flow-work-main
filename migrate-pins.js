/**
 * PMW Manufacturing ERP - One-Time PIN Migration Script
 * Migrates all existing users in Firestore from plaintext `pin` to bcrypt `pinHash`.
 * 
 * Safety & Idempotency:
 * - Scans collection 'mfr_users'
 * - If `pin` (plaintext) exists, generates bcrypt salt & hash (saltRounds=10)
 * - Updates document with `pinHash` and deletes the plaintext `pin` field atomically
 * - If user already has `pinHash` and no `pin`, safely skips without modifying
 * - Safe to re-run multiple times without damaging existing records
 */

import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

async function runMigration() {
  console.log("=================================================");
  console.log("🔐 Starting PMW User PIN Bcrypt Hashing Migration");
  console.log("=================================================");

  // 1. Read Firebase configuration
  let firebaseConfig = null;
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.warn("Notice: Could not parse firebase-applet-config.json, falling back to environment variables.");
  }

  const projectId = firebaseConfig?.projectId || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || "my-project-9ca72";
  const databaseId = firebaseConfig?.firestoreDatabaseId || "(default)";

  console.log(`📡 Connecting to Firebase Project: ${projectId}`);
  console.log(`📦 Database ID: ${databaseId}`);

  let app;
  if (getApps().length === 0) {
    app = initializeApp({
      projectId: projectId
    });
  } else {
    app = getApp();
  }

  const db = databaseId && databaseId !== "(default)"
    ? getFirestore(app, databaseId)
    : getFirestore(app);

  console.log("🔍 Fetching all users from 'mfr_users' collection...");
  const usersSnapshot = await db.collection("mfr_users").get();

  if (usersSnapshot.empty) {
    console.log("ℹ️ No user records found in 'mfr_users' collection.");
    return;
  }

  let totalUsers = usersSnapshot.size;
  let migratedCount = 0;
  let alreadyMigratedCount = 0;
  let noPinCount = 0;

  console.log(`👥 Found ${totalUsers} user account(s) to inspect.\n`);

  for (const docSnap of usersSnapshot.docs) {
    const userId = docSnap.id;
    const data = docSnap.data();
    const userName = data.name || "Unknown Operator";

    const hasPlaintextPin = typeof data.pin === "string" && data.pin.trim().length > 0;
    const hasPinHash = typeof data.pinHash === "string" && data.pinHash.length > 0;

    if (hasPlaintextPin) {
      const plaintextPin = data.pin.trim();
      const saltRounds = 10;
      const hashedPin = await bcrypt.hash(plaintextPin, saltRounds);

      await docSnap.ref.update({
        pinHash: hashedPin,
        pin: FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });

      console.log(`  ✅ [MIGRATED] User: "${userName}" (ID: ${userId}) -> Plaintext PIN replaced with bcrypt hash`);
      migratedCount++;
    } else if (hasPinHash) {
      console.log(`  ⏭️  [SKIPPED / ALREADY DONE] User: "${userName}" (ID: ${userId}) -> Already secured with bcrypt pinHash`);
      alreadyMigratedCount++;
    } else {
      console.log(`  ⚠️  [NO PIN] User: "${userName}" (ID: ${userId}) -> Document contains neither plaintext pin nor pinHash`);
      noPinCount++;
    }
  }

  console.log("\n=================================================");
  console.log("📊 MIGRATION SUMMARY REPORT");
  console.log("=================================================");
  console.log(`Total Inspected Users:   ${totalUsers}`);
  console.log(`Successfully Migrated:   ${migratedCount}`);
  console.log(`Already Migrated:        ${alreadyMigratedCount}`);
  console.log(`No PIN Configured:       ${noPinCount}`);
  console.log("=================================================");
  console.log("🎉 Migration process completed successfully.\n");
}

runMigration().catch((error) => {
  console.error("❌ Fatal error during PIN migration:", error);
  process.exit(1);
});
