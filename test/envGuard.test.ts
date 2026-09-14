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
  PRODUCTION_HOSTING_URL,
  PRODUCTION_MESSAGING_SENDER_ID,
  STAGING_PROJECT_ID,
  STAGING_DATABASE_ID,
  STAGING_MESSAGING_SENDER_ID,
  resolveClientFirebaseConfig,
  applyViteClientFirebaseEnvFromProcess,
  injectClientFirebaseConfigScript,
  usesProductionFirebaseWebCredentials
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

  const productionApplet = {
    projectId: PRODUCTION_PROJECT_ID,
    firestoreDatabaseId: PRODUCTION_DATABASE_ID,
    apiKey: "test-key",
    authDomain: "my-project-9ca72.firebaseapp.com"
  };

  const prodClient = resolveClientFirebaseConfig(productionApplet, {
    NODE_ENV: "production",
    ALLOW_EXPLICIT_PRODUCTION: "true",
    GCP_PROJECT: PRODUCTION_PROJECT_ID
  });
  assert(
    "TEST 11: Production client config remains production project/database",
    prodClient.projectId === PRODUCTION_PROJECT_ID &&
      prodClient.firestoreDatabaseId === PRODUCTION_DATABASE_ID
  );

  const stagingClient = resolveClientFirebaseConfig(productionApplet, {
    APP_ENV: "staging",
    VITE_APP_ENV: "staging",
    GCP_PROJECT: STAGING_PROJECT_ID,
    FIRESTORE_DATABASE_ID: STAGING_DATABASE_ID
  });
  assert(
    "TEST 12: Staging APP_ENV resolves client Firebase to staging project/database",
    stagingClient.projectId === STAGING_PROJECT_ID &&
      stagingClient.firestoreDatabaseId === STAGING_DATABASE_ID
  );
  assert(
    "TEST 12b: Staging config does not inherit production apiKey/appId/authDomain",
    stagingClient.apiKey !== "test-key" &&
      !usesProductionFirebaseWebCredentials(stagingClient) &&
      stagingClient.messagingSenderId === STAGING_MESSAGING_SENDER_ID
  );

  const stagingVite = resolveClientFirebaseConfig(productionApplet, {
    VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT_ID,
    VITE_FIRESTORE_DATABASE_ID: STAGING_DATABASE_ID
  });
  assert(
    "TEST 13: Staging VITE_ Firebase vars resolve to pmw-tracker-staging-9ca72 + ai-studio-staging",
    stagingVite.projectId === "pmw-tracker-staging-9ca72" &&
      stagingVite.firestoreDatabaseId === "ai-studio-staging"
  );

  const mapped = applyViteClientFirebaseEnvFromProcess({
    GCP_PROJECT: STAGING_PROJECT_ID,
    FIRESTORE_DATABASE_ID: STAGING_DATABASE_ID
  });
  assert(
    "TEST 14: Docker/Cloud Run GCP env is copied into VITE_ keys for the browser bundle",
    mapped.VITE_FIREBASE_PROJECT_ID === STAGING_PROJECT_ID &&
      mapped.VITE_FIRESTORE_DATABASE_ID === STAGING_DATABASE_ID &&
      mapped.VITE_APP_ENV === "staging"
  );

  const injectedHtml = injectClientFirebaseConfigScript(
    "<html><head></head><body></body></html>",
    {
      projectId: STAGING_PROJECT_ID,
      firestoreDatabaseId: STAGING_DATABASE_ID,
      apiKey: "staging-web-api-key",
      appId: `1:${STAGING_MESSAGING_SENDER_ID}:web:abc`,
      authDomain: `${STAGING_PROJECT_ID}.firebaseapp.com`,
      storageBucket: `${STAGING_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: STAGING_MESSAGING_SENDER_ID
    }
  );
  assert(
    "TEST 15: Cloud Run HTML injection exposes complete staging Firebase web config",
    injectedHtml.includes(STAGING_PROJECT_ID) &&
      injectedHtml.includes(STAGING_DATABASE_ID) &&
      injectedHtml.includes("staging-web-api-key") &&
      injectedHtml.includes(`1:${STAGING_MESSAGING_SENDER_ID}:web:abc`) &&
      !injectedHtml.includes(PRODUCTION_MESSAGING_SENDER_ID) &&
      injectedHtml.includes("__PMW_FIREBASE_CLIENT__")
  );

  try {
    resolveClientFirebaseConfig(productionApplet, {
      APP_ENV: "staging",
      GCP_PROJECT: PRODUCTION_PROJECT_ID,
      FIRESTORE_DATABASE_ID: PRODUCTION_DATABASE_ID
    });
    assert("TEST 16: Staging mode cannot target production Firebase", false, "Expected fail-closed");
  } catch (err: any) {
    assert(
      "TEST 16: Staging mode cannot target production Firebase",
      String(err.message || err).includes("Production Firebase")
    );
  }

  const stagingComplete = resolveClientFirebaseConfig(productionApplet, {
    GCP_PROJECT: STAGING_PROJECT_ID,
    FIRESTORE_DATABASE_ID: STAGING_DATABASE_ID,
    FIREBASE_WEB_APP_CONFIG: JSON.stringify({
      apiKey: "AIzaSyStagingOnlyKey0000000000000000000",
      appId: `1:${STAGING_MESSAGING_SENDER_ID}:web:seed`,
      authDomain: `${STAGING_PROJECT_ID}.firebaseapp.com`,
      storageBucket: `${STAGING_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: STAGING_MESSAGING_SENDER_ID
    })
  });
  assert(
    "TEST 17: Staging web app config supplies apiKey/appId instead of production applet credentials",
    stagingComplete.apiKey === "AIzaSyStagingOnlyKey0000000000000000000" &&
      stagingComplete.appId?.includes(STAGING_MESSAGING_SENDER_ID) === true &&
      stagingComplete.projectId === STAGING_PROJECT_ID &&
      stagingComplete.firestoreDatabaseId === STAGING_DATABASE_ID &&
      !usesProductionFirebaseWebCredentials(stagingComplete)
  );

  assert(
    "TEST 18: Production web credentials detector recognizes production sender/app ids",
    usesProductionFirebaseWebCredentials({
      projectId: PRODUCTION_PROJECT_ID,
      appId: `1:${PRODUCTION_MESSAGING_SENDER_ID}:web:b2a0ea5581df909548a353`,
      messagingSenderId: PRODUCTION_MESSAGING_SENDER_ID,
      authDomain: "my-project-9ca72.firebaseapp.com"
    }) === true
  );

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
