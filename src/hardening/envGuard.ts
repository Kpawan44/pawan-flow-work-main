/**
 * PMW Manufacturing ERP - Environment & Production Access Guard
 * 
 * FAIL-CLOSED SECURITY PROPERTY:
 * No local, test, development, emulator, desktop, mobile, CI, or staging execution
 * may silently connect to or mutate production Firestore, Auth, Storage, Cloud Run, or Hosting.
 * Missing or ambiguous environment configuration must FAIL CLOSED.
 */

export const PRODUCTION_PROJECT_ID = "my-project-9ca72";
export const PRODUCTION_DATABASE_ID = "ai-studio-remixraj-d7813b87-2e92-4313-844a-f71df5b7a8d";
export const PRODUCTION_CLOUD_RUN_URL = "https://pmw-tracker-928410476586.asia-south1.run.app";
export const PRODUCTION_HOSTING_URL = "https://my-project-9ca72.web.app";
export const STAGING_PROJECT_ID = "pmw-tracker-staging-9ca72";
export const STAGING_DATABASE_ID = "ai-studio-staging";
export const PRODUCTION_MESSAGING_SENDER_ID = "928410476586";
export const STAGING_MESSAGING_SENDER_ID = "818812911919";

export type AppEnvironment = 'production' | 'staging' | 'development' | 'test' | 'emulator';

/**
 * Determine effective application environment from process environment or overrides.
 */
export function resolveEnvironment(envOverride?: Record<string, string | undefined>): AppEnvironment {
  const env = envOverride || (typeof process !== 'undefined' ? process.env : {});
  
  if (env.FIRESTORE_EMULATOR_HOST) {
    return 'emulator';
  }

  const testEnv = env.TEST_ENV?.toLowerCase();
  const nodeEnv = env.NODE_ENV?.toLowerCase();
  const appEnv = env.APP_ENV?.toLowerCase();

  if (testEnv === 'test' || testEnv === 'emulator' || nodeEnv === 'test') {
    return 'test';
  }

  if (appEnv === 'staging') {
    return 'staging';
  }

  if (nodeEnv === 'production' && (env.ALLOW_EXPLICIT_PRODUCTION === 'true' || env.GCP_PROJECT === PRODUCTION_PROJECT_ID)) {
    return 'production';
  }

  return 'development';
}

/**
 * Returns true if the project ID matches the production GCP project ID.
 */
export function isProductionProject(projectId: string | null | undefined): boolean {
  if (!projectId) return false;
  return projectId.trim().toLowerCase() === PRODUCTION_PROJECT_ID.toLowerCase();
}

/**
 * Returns true if the database ID matches the production Firestore database ID.
 */
export function isProductionDatabase(databaseId: string | null | undefined): boolean {
  if (!databaseId) return false;
  return databaseId.trim().toLowerCase() === PRODUCTION_DATABASE_ID.toLowerCase();
}

/**
 * Returns true if the URL targets production Cloud Run or Hosting.
 */
export function isProductionUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith(PRODUCTION_CLOUD_RUN_URL.toLowerCase()) ||
    normalized.startsWith(PRODUCTION_HOSTING_URL.toLowerCase()) ||
    normalized.includes("928410476586.asia-south1.run.app") ||
    normalized.includes("my-project-9ca72.web.app")
  );
}

/**
 * Validate FIRESTORE_EMULATOR_HOST format (host:port).
 */
export function validateEmulatorHost(emulatorHost: string): { host: string; port: number } {
  const trimmed = emulatorHost.trim();
  if (!trimmed || !trimmed.includes(':')) {
    throw new Error(`Malformed FIRESTORE_EMULATOR_HOST: '${emulatorHost}'. Expected format host:port (e.g. 127.0.0.1:8080).`);
  }
  const parts = trimmed.split(':');
  const port = parseInt(parts[1], 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Malformed FIRESTORE_EMULATOR_HOST port: '${parts[1]}'. Expected valid port number (1-65535).`);
  }
  return { host: parts[0], port };
}

/**
 * Assert that non-production execution is not targeting production project, database, or URL.
 * FAIL CLOSED if production identifiers are detected in non-production mode.
 */
export function assertNotProductionTarget(options: {
  projectId?: string | null;
  databaseId?: string | null;
  url?: string | null;
  environment?: AppEnvironment;
}, envOverride?: Record<string, string | undefined>): void {
  const currentEnv = options.environment || resolveEnvironment(envOverride);

  if (currentEnv === 'production') {
    return; // Explicit production mode permits production targets
  }

  if (isProductionProject(options.projectId)) {
    throw new Error(
      `Production Firebase project '${PRODUCTION_PROJECT_ID}' detected in non-production environment ('${currentEnv}'). ` +
      `Execution blocked to prevent accidental production database mutation. Set FIRESTORE_EMULATOR_HOST or configure non-production project.`
    );
  }

  if (isProductionDatabase(options.databaseId)) {
    throw new Error(
      `Production Firestore database '${PRODUCTION_DATABASE_ID}' detected in non-production environment ('${currentEnv}'). ` +
      `Execution blocked to prevent accidental production connection.`
    );
  }

  if (isProductionUrl(options.url)) {
    throw new Error(
      `Production Cloud Run/Hosting endpoint '${options.url}' is forbidden in non-production mode. ` +
      `Configure VITE_API_BASE_URL or use local target.`
    );
  }
}

/**
 * Backend Server Firebase Project Resolver (FAIL-CLOSED)
 * 
 * Replaces the unsafe fallback:
 * firebaseConfig?.projectId || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT_ID || "my-project-9ca72"
 */
export function resolveServerFirebaseProject(
  firebaseConfig: { projectId?: string; firestoreDatabaseId?: string } | null,
  envOverride?: Record<string, string | undefined>
): { projectId: string; databaseId: string; isEmulator: boolean } {
  const env = envOverride || (typeof process !== 'undefined' ? process.env : {});
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;

  // 1. Emulator Mode
  if (emulatorHost) {
    validateEmulatorHost(emulatorHost);
    const projId = env.GCP_PROJECT || env.FIREBASE_PROJECT_ID || firebaseConfig?.projectId || "demo-pmw-emulator";
    return {
      projectId: projId,
      databaseId: "(default)",
      isEmulator: true
    };
  }

  const resolvedEnv = resolveEnvironment(envOverride);
  const candidateProjectId = env.GCP_PROJECT || env.FIREBASE_PROJECT_ID || firebaseConfig?.projectId;
  const candidateDatabaseId = env.FIRESTORE_DATABASE_ID || firebaseConfig?.firestoreDatabaseId || "(default)";

  // 2. Missing Project Configuration -> FAIL CLOSED
  if (!candidateProjectId) {
    throw new Error(
      "Non-production Firebase environment is not configured. Refusing to connect to production. " +
      "Specify GCP_PROJECT or set FIRESTORE_EMULATOR_HOST."
    );
  }

  // 3. Non-Production Mode Attempting Production Project/Database -> FAIL CLOSED
  if (resolvedEnv !== 'production') {
    assertNotProductionTarget({
      projectId: candidateProjectId,
      databaseId: candidateDatabaseId,
      environment: resolvedEnv
    }, envOverride);
  }

  return {
    projectId: candidateProjectId,
    databaseId: candidateDatabaseId,
    isEmulator: false
  };
}

/**
 * Client API Base URL Resolver (FAIL-CLOSED)
 * 
 * Replaces hardcoded fallback to production Cloud Run URL in getApiBaseUrl().
 */
export function resolveClientApiBaseUrl(options: {
  isDesktopOrMobile?: boolean;
  envApiUrl?: string;
}, envOverride?: Record<string, string | undefined>): string {
  const currentEnv = resolveEnvironment(envOverride);
  const configuredUrl = options.envApiUrl?.trim();

  if (configuredUrl) {
    if (currentEnv !== 'production' && isProductionUrl(configuredUrl)) {
      throw new Error(
        `Production Cloud Run endpoint '${configuredUrl}' is forbidden in non-production mode ('${currentEnv}'). ` +
        `Set VITE_API_BASE_URL to a local or staging target.`
      );
    }
    return configuredUrl;
  }

  // Electron / Capacitor / Desktop / Mobile require explicit VITE_API_BASE_URL
  if (options.isDesktopOrMobile) {
    if (currentEnv === 'production') {
      return PRODUCTION_CLOUD_RUN_URL;
    }
    throw new Error("Electron/Capacitor API target is not configured. Set VITE_API_BASE_URL or configure local target.");
  }

  // Web served from same-origin server uses relative endpoint path ''
  return '';
}

export interface ClientFirebaseAppletConfig {
  projectId: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
  [key: string]: unknown;
}

export function isStagingFirebaseTarget(
  env: Record<string, string | undefined> = {}
): boolean {
  const appEnv = String(env.VITE_APP_ENV || env.APP_ENV || "").trim().toLowerCase();
  if (appEnv === "staging") return true;
  const project = String(env.VITE_FIREBASE_PROJECT_ID || env.GCP_PROJECT || "").trim();
  const database = String(env.VITE_FIRESTORE_DATABASE_ID || env.FIRESTORE_DATABASE_ID || "").trim();
  return project === STAGING_PROJECT_ID || database === STAGING_DATABASE_ID;
}

/**
 * Copy Cloud Run / Docker GCP env into Vite-visible VITE_* keys before `vite build`.
 * Does not overwrite VITE_* values that are already set.
 */
export function applyViteClientFirebaseEnvFromProcess(
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  if (!env.VITE_FIREBASE_PROJECT_ID && env.GCP_PROJECT) {
    env.VITE_FIREBASE_PROJECT_ID = env.GCP_PROJECT;
  }
  if (!env.VITE_FIRESTORE_DATABASE_ID && env.FIRESTORE_DATABASE_ID) {
    env.VITE_FIRESTORE_DATABASE_ID = env.FIRESTORE_DATABASE_ID;
  }
  if (!env.VITE_APP_ENV && env.APP_ENV) {
    env.VITE_APP_ENV = env.APP_ENV;
  }
  if (
    !env.VITE_APP_ENV &&
    (env.VITE_FIREBASE_PROJECT_ID === STAGING_PROJECT_ID || env.GCP_PROJECT === STAGING_PROJECT_ID)
  ) {
    env.VITE_APP_ENV = "staging";
  }
  if (!env.VITE_FIREBASE_API_KEY && env.FIREBASE_API_KEY) {
    env.VITE_FIREBASE_API_KEY = env.FIREBASE_API_KEY;
  }
  if (!env.VITE_FIREBASE_APP_ID && env.FIREBASE_APP_ID) {
    env.VITE_FIREBASE_APP_ID = env.FIREBASE_APP_ID;
  }
  if (!env.VITE_FIREBASE_AUTH_DOMAIN && env.FIREBASE_AUTH_DOMAIN) {
    env.VITE_FIREBASE_AUTH_DOMAIN = env.FIREBASE_AUTH_DOMAIN;
  }
  if (!env.VITE_FIREBASE_STORAGE_BUCKET && env.FIREBASE_STORAGE_BUCKET) {
    env.VITE_FIREBASE_STORAGE_BUCKET = env.FIREBASE_STORAGE_BUCKET;
  }
  if (!env.VITE_FIREBASE_MESSAGING_SENDER_ID && env.FIREBASE_MESSAGING_SENDER_ID) {
    env.VITE_FIREBASE_MESSAGING_SENDER_ID = env.FIREBASE_MESSAGING_SENDER_ID;
  }
  return env;
}

export function stagingClientFirebaseSkeleton(): ClientFirebaseAppletConfig {
  return {
    projectId: STAGING_PROJECT_ID,
    firestoreDatabaseId: STAGING_DATABASE_ID,
    authDomain: `${STAGING_PROJECT_ID}.firebaseapp.com`,
    storageBucket: `${STAGING_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: STAGING_MESSAGING_SENDER_ID,
    apiKey: "",
    appId: "",
    measurementId: "",
    oAuthClientId: "",
    recaptchaSiteKey: ""
  };
}

export function usesProductionFirebaseWebCredentials(
  config: Partial<ClientFirebaseAppletConfig> | null | undefined
): boolean {
  const appId = String(config?.appId || "");
  const authDomain = String(config?.authDomain || "");
  const messagingSenderId = String(config?.messagingSenderId || "");
  const storageBucket = String(config?.storageBucket || "");
  const oAuth = String(config?.oAuthClientId || "");
  const projectId = String(config?.projectId || "");
  return (
    projectId === PRODUCTION_PROJECT_ID ||
    messagingSenderId === PRODUCTION_MESSAGING_SENDER_ID ||
    appId.includes(PRODUCTION_MESSAGING_SENDER_ID) ||
    authDomain.includes(PRODUCTION_PROJECT_ID) ||
    storageBucket.includes(PRODUCTION_PROJECT_ID) ||
    oAuth.includes(PRODUCTION_MESSAGING_SENDER_ID)
  );
}

function parseFirebaseWebAppJson(raw: string | undefined): Partial<ClientFirebaseAppletConfig> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<ClientFirebaseAppletConfig>;
  } catch {
    return null;
  }
}

/**
 * Browser Firebase config resolver.
 * Default: production applet JSON (unchanged).
 * Staging must use a complete staging web app config. Production apiKey/appId/authDomain
 * /storageBucket/messagingSenderId are never reused for staging.
 */
export function resolveClientFirebaseConfig(
  fileConfig: ClientFirebaseAppletConfig,
  envOverride?: Record<string, string | undefined>
): ClientFirebaseAppletConfig {
  const env = envOverride || (typeof process !== "undefined" ? process.env : {});
  const base: ClientFirebaseAppletConfig = { ...fileConfig };

  if (!isStagingFirebaseTarget(env)) {
    return {
      ...base,
      projectId: String(base.projectId || PRODUCTION_PROJECT_ID),
      firestoreDatabaseId: String(base.firestoreDatabaseId || PRODUCTION_DATABASE_ID)
    };
  }

  const fetched =
    parseFirebaseWebAppJson(env.FIREBASE_WEB_APP_CONFIG) ||
    parseFirebaseWebAppJson(env.FIREBASE_CONFIG);
  const skeleton = stagingClientFirebaseSkeleton();
  const projectId = String(
    env.VITE_FIREBASE_PROJECT_ID || env.GCP_PROJECT || fetched?.projectId || skeleton.projectId
  ).trim();
  const firestoreDatabaseId = String(
    env.VITE_FIRESTORE_DATABASE_ID || env.FIRESTORE_DATABASE_ID || skeleton.firestoreDatabaseId
  ).trim();

  assertNotProductionTarget(
    {
      projectId,
      databaseId: firestoreDatabaseId,
      environment: "staging"
    },
    { ...env, APP_ENV: "staging" }
  );

  const resolved: ClientFirebaseAppletConfig = {
    ...skeleton,
    projectId,
    firestoreDatabaseId,
    authDomain: String(
      env.VITE_FIREBASE_AUTH_DOMAIN || fetched?.authDomain || `${projectId}.firebaseapp.com`
    ).trim(),
    storageBucket: String(
      env.VITE_FIREBASE_STORAGE_BUCKET ||
        fetched?.storageBucket ||
        `${projectId}.firebasestorage.app`
    ).trim(),
    messagingSenderId: String(
      env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
        fetched?.messagingSenderId ||
        skeleton.messagingSenderId
    ).trim(),
    apiKey: String(env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY || fetched?.apiKey || "").trim(),
    appId: String(env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || fetched?.appId || "").trim(),
    measurementId: String(env.VITE_FIREBASE_MEASUREMENT_ID || fetched?.measurementId || "").trim(),
    oAuthClientId: String(env.VITE_FIREBASE_OAUTH_CLIENT_ID || fetched?.oAuthClientId || "").trim(),
    recaptchaSiteKey: String(fetched?.recaptchaSiteKey || "").trim()
  };

  if (usesProductionFirebaseWebCredentials(resolved)) {
    throw new Error(
      "Staging Firebase client config must not reuse production web credentials (apiKey/appId/authDomain/storageBucket/messagingSenderId)."
    );
  }

  return resolved;
}

export function publicClientFirebaseConfig(
  config: ClientFirebaseAppletConfig
): {
  projectId: string;
  firestoreDatabaseId: string;
  apiKey: string;
  appId: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
  oAuthClientId?: string;
} {
  return {
    projectId: String(config.projectId || ""),
    firestoreDatabaseId: String(config.firestoreDatabaseId || ""),
    apiKey: String(config.apiKey || ""),
    appId: String(config.appId || ""),
    authDomain: String(config.authDomain || ""),
    storageBucket: String(config.storageBucket || ""),
    messagingSenderId: String(config.messagingSenderId || ""),
    measurementId: String(config.measurementId || ""),
    oAuthClientId: String(config.oAuthClientId || "")
  };
}

export function injectClientFirebaseConfigScript(
  html: string,
  config: ClientFirebaseAppletConfig
): string {
  const payload = publicClientFirebaseConfig(config);
  const script = `<script>window.__PMW_FIREBASE_CLIENT__=${JSON.stringify(payload)};</script>`;
  if (html.includes("__PMW_FIREBASE_CLIENT__")) {
    return html.replace(
      /<script>window\.__PMW_FIREBASE_CLIENT__=.*?<\/script>/,
      script
    );
  }
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>${script}`);
  }
  return `${script}${html}`;
}
