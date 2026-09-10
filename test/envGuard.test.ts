import {
  resolveEnvironment,
  isProductionProject,
  isProductionDatabase,
  isProductionUrl,
  validateEmulatorHost,
  assertNotProductionTarget,
  resolveServerFirebaseProject,
  resolveClientApiBaseUrl,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_CLOUD_RUN_URL,
  PRODUCTION_HOSTING_URL
} from "../src/hardening/envGuard";
import { MemoryStore } from "../src/hardening/memoryStore";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

async function runTests() {
  console.log("=================================================");
  console.log("🛡️ Running Environment Guard Fail-Closed Tests");
  console.log("=================================================");

  // TEST 1: Missing project configuration in non-production -> FAIL CLOSED
  try {
    resolveServerFirebaseProject(null, { NODE_ENV: "test" });
    assert("TEST 1: Missing project config in non-prod fails closed", false, "Expected error on missing project config");
  } catch (err: any) {
    assert("TEST 1: Missing project config in non-prod fails closed", err.message.includes("Non-production Firebase environment is not configured"));
  }

  // TEST 2: Non-production project explicitly configured -> ALLOWED
  try {
    const res = resolveServerFirebaseProject(null, { NODE_ENV: "development", GCP_PROJECT: "pmw-staging-project" });
    assert("TEST 2: Non-production project explicitly configured allowed", res.projectId === "pmw-staging-project" && !res.isEmulator);
  } catch (err: any) {
    assert("TEST 2: Non-production project explicitly configured allowed", false, err.message);
  }

  // TEST 3: Production project in test/local mode -> FAIL CLOSED
  try {
    resolveServerFirebaseProject(null, { NODE_ENV: "test", GCP_PROJECT: PRODUCTION_PROJECT_ID });
    assert("TEST 3: Production project in test/local mode fails closed", false, "Expected error on production project ID in test mode");
  } catch (err: any) {
    assert("TEST 3: Production project in test/local mode fails closed", err.message.includes(`Production Firebase project '${PRODUCTION_PROJECT_ID}' detected`));
  }

  // TEST 4: Production Firestore database in test/local mode -> FAIL CLOSED
  try {
    assertNotProductionTarget({ databaseId: PRODUCTION_DATABASE_ID, environment: "development" });
    assert("TEST 4: Production Firestore database in non-prod fails closed", false, "Expected error on production database ID");
  } catch (err: any) {
    assert("TEST 4: Production Firestore database in non-prod fails closed", err.message.includes(`Production Firestore database '${PRODUCTION_DATABASE_ID}' detected`));
  }

  // TEST 5: FIRESTORE_EMULATOR_HOST configured -> Emulator mode selected safely
  try {
    const res = resolveServerFirebaseProject(null, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    assert("TEST 5: FIRESTORE_EMULATOR_HOST selects emulator mode", res.isEmulator === true && res.projectId === "demo-pmw-emulator");
  } catch (err: any) {
    assert("TEST 5: FIRESTORE_EMULATOR_HOST selects emulator mode", false, err.message);
  }

  // TEST 6: Malformed emulator configuration -> FAIL CLOSED
  try {
    validateEmulatorHost("invalid-host-no-port");
    assert("TEST 6: Malformed emulator config fails closed", false, "Expected error on malformed emulator host");
  } catch (err: any) {
    assert("TEST 6: Malformed emulator config fails closed", err.message.includes("Malformed FIRESTORE_EMULATOR_HOST"));
  }

  // TEST 7: Missing VITE_API_BASE_URL for Electron/Capacitor -> FAIL CLOSED
  try {
    resolveClientApiBaseUrl({ isDesktopOrMobile: true }, { NODE_ENV: "development" });
    assert("TEST 7: Missing VITE_API_BASE_URL for Electron/Capacitor fails closed", false, "Expected error on missing API URL in desktop/mobile");
  } catch (err: any) {
    assert("TEST 7: Missing VITE_API_BASE_URL for Electron/Capacitor fails closed", err.message.includes("Electron/Capacitor API target is not configured"));
  }

  // TEST 8: Production Cloud Run URL supplied to non-production -> FAIL CLOSED
  try {
    resolveClientApiBaseUrl({ isDesktopOrMobile: true, envApiUrl: PRODUCTION_CLOUD_RUN_URL }, { NODE_ENV: "development" });
    assert("TEST 8: Production Cloud Run URL in non-prod fails closed", false, "Expected error on production Cloud Run URL");
  } catch (err: any) {
    assert("TEST 8: Production Cloud Run URL in non-prod fails closed", err.message.includes("Production Cloud Run endpoint"));
  }

  // TEST 9: Explicit production environment -> Production targeting allowed
  try {
    const res = resolveServerFirebaseProject(
      { projectId: PRODUCTION_PROJECT_ID, firestoreDatabaseId: PRODUCTION_DATABASE_ID },
      { NODE_ENV: "production", ALLOW_EXPLICIT_PRODUCTION: "true" }
    );
    assert("TEST 9: Explicit production environment permits production target", res.projectId === PRODUCTION_PROJECT_ID && !res.isEmulator);
  } catch (err: any) {
    assert("TEST 9: Explicit production environment permits production target", false, err.message);
  }

  // TEST 10: Unit tests continue using MemoryStore -> No Firebase production connection
  const store = new MemoryStore();
  await store.set("mfr_test", "doc-1", { status: "OK" });
  const fetched = await store.get("mfr_test", "doc-1");
  assert("TEST 10: MemoryStore remains completely isolated in memory", fetched?.status === "OK");

  console.log("=================================================");
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
