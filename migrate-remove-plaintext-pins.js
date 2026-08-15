/**
 * migrate-remove-plaintext-pins.js
 *
 * ONE-TIME migration script.
 * Reads every document in mfr_users, and for any that still has a
 * plaintext `pin` field:
 *   1. Hashes it with bcrypt and saves it as `pinHash` (if not already set).
 *   2. Deletes the `pin` field.
 *
 * Run ONCE from your project root:
 *   node migrate-remove-plaintext-pins.js
 *
 * Requirements:
 *   npm install firebase-admin bcryptjs   (already in your package.json)
 *
 * The script uses the Firebase Admin SDK so it bypasses Firestore security
 * rules — it needs to run server-side, not in the browser.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const configPath = join(__dirname, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(readFileSync(configPath, 'utf8'));
const projectId = firebaseConfig.projectId;
const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
// ─────────────────────────────────────────────────────────────────────────────

if (!projectId) {
  console.error('ERROR: Could not read projectId from firebase-applet-config.json');
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ projectId });
}

const db = dbId !== '(default)'
  ? getFirestore(dbId)
  : getFirestore();

async function migrate() {
  const snapshot = await db.collection('mfr_users').get();

  if (snapshot.empty) {
    console.log('No users found in mfr_users. Nothing to migrate.');
    return;
  }

  let migrated = 0;
  let alreadyClean = 0;
  let errors = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const userId = docSnap.id;
    const name = data.name || userId;

    if (!data.pin) {
      // Already clean — no plaintext PIN
      alreadyClean++;
      continue;
    }

    try {
      const updates = {
        pin: FieldValue.delete(),  // Remove plaintext field
      };

      // Only hash and save if pinHash not already set
      if (!data.pinHash) {
        const hash = await bcrypt.hash(data.pin.trim(), 10);
        updates.pinHash = hash;
        console.log(`  [MIGRATED] ${name} (${userId}) — hashed PIN and removed plaintext`);
      } else {
        console.log(`  [CLEANED]  ${name} (${userId}) — pinHash already exists, removed plaintext pin only`);
      }

      await db.collection('mfr_users').doc(userId).update(updates);
      migrated++;
    } catch (err) {
      console.error(`  [ERROR]    ${name} (${userId}):`, err.message);
      errors++;
    }
  }

  console.log('\n── Migration complete ──────────────────────────────');
  console.log(`  Migrated : ${migrated}`);
  console.log(`  Already clean : ${alreadyClean}`);
  console.log(`  Errors   : ${errors}`);

  if (errors > 0) {
    console.warn('\nSome users failed. Re-run this script to retry.');
    process.exit(1);
  } else {
    console.log('\nAll plaintext PINs have been removed from Firestore. ✓');
  }
}

migrate().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
