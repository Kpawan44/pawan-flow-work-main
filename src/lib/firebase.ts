import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut, onAuthStateChanged, GoogleAuthProvider } from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc, 
  getDocFromServer, 
  collection, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  runTransaction
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { UserProfile, JobCard, MaterialMovement, AppNotification, AuditLog, Department, CompanyConfig, JobCardStatus, SavedItem, SyncQueueItem, SyncQueueOperation, OutsourceOrder, ProcessTransfer } from '../types';
import { 
  logJobCardToSheets, 
  logDepartmentUpdateToSheets, 
  logMaterialMovementToSheets, 
  logActionToSheets 
} from './googleSheets';

// Directly use configuration from firebase-applet-config.json
export { firebaseConfig };

// Check if the configuration consists of placeholders
const isPlaceholder = 
  !firebaseConfig || 
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey === 'placeholder-api-key' || 
  firebaseConfig.apiKey.includes('placeholder') ||
  firebaseConfig.apiKey.includes('remixed');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

// Helper function to sanitize objects before sending to Firestore (removes undefined fields)
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

// Global offline/error state tracker for UI
export let isFirestoreOffline = false;

export function setFirestoreOffline(status: boolean) {
  isFirestoreOffline = status;
  window.dispatchEvent(new CustomEvent('firestore-status-change', { detail: { isOffline: status } }));
}

// Global handleFirestoreError to wrap Firestore operations
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Check if this error is an expected offline/unreachable state
  const isOfflineError = 
    errorMessage.includes('offline') || 
    errorMessage.includes('Failed to get document because the client is offline') || 
    errorMessage.includes('unavailable') ||
    errorMessage.includes('could not be reached') ||
    errorMessage.includes('Could not reach Cloud Firestore backend') ||
    errorMessage.includes('network') ||
    errorMessage.toLowerCase().includes('deadline-exceeded');

  if (isOfflineError) {
    setFirestoreOffline(true);
  }

  const currentAuthUser = authInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: isPlaceholder ? 'mock-user' : (currentAuthUser?.uid || null),
      email: isPlaceholder ? 'offline@terminal.local' : (currentAuthUser?.email || null),
      emailVerified: currentAuthUser?.emailVerified ?? true,
      isAnonymous: currentAuthUser?.isAnonymous ?? false,
    },
    operationType,
    path
  };

  if (isOfflineError) {
    console.info(`[Offline Mode] Firestore operation [${operationType}] for [${path}] deferred. Serving from high-fidelity local storage/cache fallback.`);
  } else {
    console.warn('Firestore Operation Error: ', JSON.stringify(errInfo));
  }
}

// Timeout wrapper for Firestore operations to prevent hanging when backend is unreachable
export function withTimeout<T>(promise: Promise<T>, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Could not reach Cloud Firestore backend within ${ms}ms. Device operating in fallback mode.`));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Setup real Firebase
let dbInstance: any = null;
let authInstance: any = null;
let useRealFirebase = false;

if (!isPlaceholder) {
  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const databaseId = (firebaseConfig as any).firestoreDatabaseId;
    
    // Initialize Firestore with autoDetectLongPolling and databaseId for reliable sandbox/web connection
    try {
      dbInstance = initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      }, databaseId);
    } catch (initErr) {
      // Fallback if already initialized
      dbInstance = getFirestore(app, databaseId);
    }

    authInstance = getAuth(app);
    useRealFirebase = true;
  } catch (error) {
    console.error("Failed to initialize real Firebase:", error);
  }
} else {
  console.log("Starting app in HIGH-FIDELITY LOCAL STORAGE EMULATION mode (Real Firebase disabled).");
}

export { useRealFirebase, signInWithCustomToken, signOut, onAuthStateChanged };
export const db = dbInstance;
export const auth = authInstance;

// ============================================
// EMPTY DATASET DEFAULTS (ZERO-RESURRECTION ARCHITECTURE)
// ============================================

const defaultSavedItems: SavedItem[] = [];
const defaultJobCards: JobCard[] = [];
const defaultMovements: MaterialMovement[] = [];
const defaultNotifications: AppNotification[] = [];
const defaultAuditLogs: AuditLog[] = [];
const defaultOutsourceOrders: OutsourceOrder[] = [];

const defaultCompanyConfig: CompanyConfig = {
  companyName: 'PMW Manufacturing Tracker',
  details: 'Precision Metal Works Industrial Unit',
  phone: '+91 98765 43210',
  address: 'Precision Metal Works Industrial Unit, Pune, MH, India',
  gstIn: '27AAAAA1111A1Z1',
  logoUrl: '',
  whatsappEnabled: true,
  whatsappPhoneNumber: '+91 98765 43210',
  whatsappApiUrl: '',
  whatsappAutoOpenShare: true,
  updatedBy: 'System Init',
  updatedAt: new Date().toISOString()
};



// Helper to load or initialize local storage collections
function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  const item = localStorage.getItem(key);
  if (!item) {
    localStorage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(item);
  } catch (e) {
    return defaultValue;
  }
}

function setLocalStorageItem<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[CACHE] Failed to write key ${key} to localStorage:`, e);
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && Boolean(
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location?.protocol === 'capacitor:' ||
    window.location?.protocol === 'file:' ||
    (typeof navigator !== 'undefined' && navigator.userAgent?.toLowerCase?.()?.includes('electron')) ||
    (window.location?.hostname === 'localhost' && window.location?.port !== '3000' && window.location?.port !== '5173')
  )) {
    return 'https://pmw-tracker-928410476586.asia-south1.run.app';
  }
  return '';
}

// Unified API for direct retrieval (works for both modes, defaulting to local persistence during preview)
export class DBService {
  private static seedingPromise: Promise<void> | null = null;
  private static isSeededInSession = false;
  private static memCache: Record<string, { data: any; timestamp: number }> = {};
  private static CACHE_TTL_MS = 20000; // 20s in-memory SWR cache
  private static activeUnsubscribers: Set<() => void> = new Set();

  static registerUnsubscriber(unsub: () => void): () => void {
    this.activeUnsubscribers.add(unsub);
    return () => {
      this.activeUnsubscribers.delete(unsub);
      try {
        unsub();
      } catch (_) {}
    };
  }

  static unsubscribeAllListeners(): void {
    for (const unsub of Array.from(this.activeUnsubscribers)) {
      try {
        unsub();
      } catch (_) {}
    }
    this.activeUnsubscribers.clear();
  }

  static clearClientCaches(newGeneration?: string): void {
    this.unsubscribeAllListeners();
    this.memCache = {};

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('mfr_') || k.startsWith('firebase:') || k.startsWith('firestore:'))) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('mfr_') || k.startsWith('firebase:') || k.startsWith('firestore:'))) {
          sessionStorage.removeItem(k);
        }
      }
    } catch (_) {}

    if (newGeneration) {
      try {
        localStorage.setItem('mfr_system_generation', newGeneration);
        sessionStorage.setItem('mfr_system_generation', newGeneration);
      } catch (_) {}
    }
  }

  static getFromMemCache<T>(key: string): T | null {
    const entry = this.memCache[key];
    if (entry && (Date.now() - entry.timestamp) < this.CACHE_TTL_MS) {
      return entry.data as T;
    }
    return null;
  }

  static setMemCache<T>(key: string, data: T): void {
    this.memCache[key] = { data, timestamp: Date.now() };
  }

  static invalidateCache(key?: string): void {
    if (key) {
      delete this.memCache[key];
    } else {
      this.memCache = {};
    }
  }

  static isOfflineMode(): boolean {
    return !navigator.onLine || isFirestoreOffline || localStorage.getItem('mfr_force_offline') === 'true';
  }

  static setOnline(): void {
    setFirestoreOffline(false);
  }

  static async ensureSeeded(): Promise<void> {
    // Disabled permanently: Never inject mock personnel or seed data
    return;
  }

  // Shared helper to fetch a single job card for Sheets syncing
  private static async getJobCardByNo(jobCardNo: string): Promise<JobCard | null> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const snap = await getDoc(doc(db, 'mfr_job_cards', jobCardNo.toUpperCase()));
        return snap.exists() ? (snap.data() as JobCard) : null;
      } catch (err) {
        return null;
      }
    }
    const cards = await this.getJobCards();
    return cards.find(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase()) || null;
  }

  // Refactor Sheets trigger to a shared helper for clarity
  private static triggerSheetsSync(jobCardNo: string, updates: Partial<JobCard>, userName: string) {
    if (updates.heatTreatmentDetails) {
      logDepartmentUpdateToSheets(jobCardNo, 'Heat Treatment', userName, {
        hardnessSpec: updates.heatTreatmentDetails.hardnessRequired,
        tempPlating: updates.heatTreatmentDetails.temperature,
        cycleCoating: updates.heatTreatmentDetails.cycleTime,
        rejectionQty: updates.heatTreatmentDetails.rejectionQty,
        remarks: updates.heatTreatmentDetails.remarks,
        qtyReceivedFromProd: updates.heatTreatmentDetails.qtyReceivedFromProd,
        qtySentToPlating: updates.heatTreatmentDetails.qtySentToPlating,
        qtyRemainingAtProd: updates.heatTreatmentDetails.qtyRemaining
      }).catch(e => console.warn(e));
    }
    if (updates.platingDetails) {
      logDepartmentUpdateToSheets(jobCardNo, 'Plating', userName, {
        tempPlating: updates.platingDetails.platingType,
        cycleCoating: updates.platingDetails.micronThickness,
        styleInvoice: updates.platingDetails.durationMinutes,
        rejectionQty: updates.platingDetails.rejectionQty,
        remarks: updates.platingDetails.remarks,
        qtyReceivedFromProd: updates.platingDetails.qtyReceivedFromHt,
        qtySentToPlating: updates.platingDetails.qtySentToPacking,
        qtyRemainingAtProd: updates.platingDetails.qtyRemaining
      }).catch(e => console.warn(e));
    }
    if (updates.packingDetails) {
      logDepartmentUpdateToSheets(jobCardNo, 'Packing', userName, {
        boxBin: String(updates.packingDetails.boxCount),
        styleInvoice: updates.packingDetails.packingType,
        rejectionQty: updates.packingDetails.rejectionQty,
        remarks: updates.packingDetails.remarks,
        qtyReceivedFromProd: updates.packingDetails.qtyReceivedFromPlating,
        qtySentToPlating: updates.packingDetails.qtySentToStore,
        qtyRemainingAtProd: updates.packingDetails.qtyRemaining
      }).catch(e => console.warn(e));
    }
    if (updates.storeDetails) {
      logDepartmentUpdateToSheets(jobCardNo, 'Store', userName, {
        boxBin: updates.storeDetails.locationBin,
        rejectionQty: updates.storeDetails.rejectionQty,
        remarks: updates.storeDetails.remarks,
        qtyReceivedFromProd: updates.storeDetails.qtyReceivedFromPacking,
        qtySentToPlating: updates.storeDetails.qtySentToDispatch,
        qtyRemainingAtProd: updates.storeDetails.qtyRemaining
      }).catch(e => console.warn(e));
    }
    if (updates.dispatchDetails) {
      logDepartmentUpdateToSheets(jobCardNo, 'Dispatch', userName, {
        styleInvoice: updates.dispatchDetails.invoiceNo,
        remarks: updates.dispatchDetails.remarks
      }).catch(e => console.warn(e));
    }
    this.getJobCardByNo(jobCardNo).then(card => {
      if (card) {
        logJobCardToSheets(card).catch(err => console.warn('Google Sheets job card log failed: ', err));
      }
    });
  }

  // --- USERS ---
  static async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (auth && auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch (e) {
        console.warn("Could not retrieve Firebase ID token:", e);
      }
    }
    if (!headers['Authorization']) {
      try {
        const sessionToken = sessionStorage.getItem('mfr_auth_token') || localStorage.getItem('mfr_auth_token');
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
        }
      } catch (e) {}
    }
    return headers;
  }

  static async getUsers(forceFresh = false): Promise<UserProfile[]> {
    if (!forceFresh) {
      const mem = this.getFromMemCache<UserProfile[]>('mfr_users');
      if (mem && mem.length > 0) return mem;
    }
    let usersList: UserProfile[] = [];

    // 1. Authoritative API Fetch
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/users`, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.users)) {
          if (resData.users.length === 0) {
            setLocalStorageItem('mfr_users', []);
            this.setMemCache('mfr_users', []);
            return [];
          }
          let foundSuperAdmin = false;
          usersList = resData.users.map((u: any) => {
            let r = u.role || 'staff';
            if (r === 'super_admin') {
              if (!foundSuperAdmin) {
                foundSuperAdmin = true;
              } else {
                r = 'admin';
              }
            }
            return {
              userId: u.userId,
              name: u.name || '',
              email: u.email || '',
              role: r,
              department: u.department || 'Production',
              allowedDepartments: u.allowedDepartments || [],
              accessList: u.accessList || [],
              canOutsource: u.canOutsource || false,
              isDepartmentHead: Boolean(u.isDepartmentHead),
              active: u.active !== false,
              createdAt: u.createdAt || new Date().toISOString(),
              updatedAt: u.updatedAt || u.createdAt || new Date().toISOString()
            };
          });
          setLocalStorageItem('mfr_users', usersList);
          this.setMemCache('mfr_users', usersList);
          return usersList;
        }
      }
    } catch (apiErr) {
      // API unavailable or network timeout; fall through to direct Firestore or cache
    }

    // 2. Direct Firestore Fast Fetch (Read only without overwriting cache on empty)
    if (useRealFirebase && db) {
      try {
        const snapshot = await getDocs(collection(db, 'mfr_users'));
        if (!snapshot.empty) {
          let foundSuperAdmin = false;
          usersList = snapshot.docs
            .map(d => {
              const data = d.data();
              return { data, id: d.id };
            })
            .filter(({ data }) => data.active !== false && data.status !== 'deleted' && !data.deletedAt)
            .map(({ data, id }) => {
              let r = data.role || 'staff';
              if (r === 'super_admin') {
                if (!foundSuperAdmin) {
                  foundSuperAdmin = true;
                } else {
                  r = 'admin';
                }
              }
              return {
                userId: data.userId || id,
                name: data.name || '',
                email: data.email || '',
                role: r,
                department: data.department || 'Production',
                allowedDepartments: data.allowedDepartments || [],
                accessList: data.accessList || [],
                canOutsource: data.canOutsource || false,
                isDepartmentHead: Boolean(data.isDepartmentHead),
                active: true,
                createdAt: data.createdAt || new Date().toISOString(),
                updatedAt: data.updatedAt || data.createdAt || new Date().toISOString()
              };
            });
          if (usersList.length > 0) {
            setLocalStorageItem('mfr_users', usersList);
            this.setMemCache('mfr_users', usersList);
            return usersList;
          }
        }
      } catch (dbErr) {
        // Direct Firestore fallback failed; fall back to local storage cache
      }
    }

    // 3. Fall back to local storage offline cache
    const LEGACY_PURGE_IDS = new Set(['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-6', 'u-7', 'u-8', 'u-2301', 'u-7857']);
    let foundSuperAdminCache = false;
    const cachedUsers = getLocalStorageItem<UserProfile[]>('mfr_users', []);
    const cleanList = cachedUsers
      .filter(u => u && u.userId && !LEGACY_PURGE_IDS.has(String(u.userId).toLowerCase().trim()) && u.active !== false && (u as any).status !== 'deleted' && !(u as any).deletedAt)
      .map((u: any) => {
        let r = u.role || 'staff';
        if (r === 'super_admin') {
          if (!foundSuperAdminCache) {
            foundSuperAdminCache = true;
          } else {
            r = 'admin';
          }
        }
        return {
          userId: u.userId,
          name: u.name || '',
          email: u.email || '',
          role: r,
          department: u.department || 'Production',
          allowedDepartments: u.allowedDepartments || [],
          accessList: u.accessList || [],
          canOutsource: u.canOutsource || false,
          isDepartmentHead: Boolean(u.isDepartmentHead),
          active: true,
          createdAt: u.createdAt || new Date().toISOString(),
          updatedAt: u.updatedAt || u.createdAt || new Date().toISOString()
        };
      });
    if (cleanList.length > 0) {
      this.setMemCache('mfr_users', cleanList);
    }
    return cleanList;
  }

  static async getUserProfile(userId: string): Promise<UserProfile | null> {
    if (!userId) return null;

    // 1. Direct Firestore fallback
    if (useRealFirebase && db) {
      try {
        const userDoc = await getDoc(doc(db, 'mfr_users', userId));
        if (userDoc.exists()) {
          const data = userDoc.data();
          return {
            userId: data.userId || userDoc.id,
            name: data.name || '',
            email: data.email || '',
            role: data.role || 'staff',
            department: data.department || 'Production',
            allowedDepartments: data.allowedDepartments || [],
            accessList: data.accessList || [],
            canOutsource: data.canOutsource || false,
            active: data.active !== false,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || data.createdAt || new Date().toISOString()
          };
        }
      } catch (e) {}
    }

    // 2. Fallback to cached list
    const users = await this.getUsers();
    return users.find(u => u.userId === userId) || null;
  }

  static async authenticateUser(nameOrId: string, pin: string): Promise<{ user: UserProfile; token?: string }> {
    const cleanKey = nameOrId.trim();
    const cleanPin = pin.trim();

    if (!cleanKey) {
      throw new Error('Please enter your Registered Full Name or select an account.');
    }
    if (cleanPin.length !== 4) {
      throw new Error('Please enter your 4-digit Security PIN.');
    }

    const apiBase = getApiBaseUrl();

    // 1. Try server-authoritative API
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanKey, userId: cleanKey, pin: cleanPin }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success && result.user) {
        const authToken = result.token || result.customToken || result.sessionToken;
        if (authToken) {
          sessionStorage.setItem('mfr_auth_token', authToken);
          localStorage.setItem('mfr_auth_token', authToken);
        }
        return {
          user: result.user as UserProfile,
          token: authToken
        };
      }
      if (response.status === 401 || response.status === 403 || (result && result.error && !result.error.includes('Failed to fetch'))) {
        throw new Error(result.error || 'Invalid credentials. Please verify your Name and Security PIN.');
      }
    } catch (err: any) {
      if (err.message && (err.message.includes('Invalid credentials') || err.message.includes('deactivated') || err.message.includes('not found in system') || err.message.includes('Security PIN'))) {
        throw err;
      }
    }

    // 2. Direct Instant Firestore / Offline Authentication fallback
    if (useRealFirebase && db) {
      let matchedUser: any = null;
      let matchedUid: string = '';

      // Check in-memory / local storage cache first (0ms)
      const cachedUsers = getLocalStorageItem<UserProfile[]>('mfr_users', []);
      const targetLower = cleanKey.toLowerCase();
      const cachedMatch = cachedUsers.find(u => 
        (u.name || '').trim().toLowerCase() === targetLower || 
        (u.userId || '').trim().toLowerCase() === targetLower ||
        (u.email || '').trim().toLowerCase() === targetLower
      );

      if (cachedMatch) {
        matchedUser = cachedMatch;
        matchedUid = cachedMatch.userId;
      } else {
        // Document fetch
        try {
          const directDoc = await getDoc(doc(db, 'mfr_users', cleanKey));
          if (directDoc.exists()) {
            matchedUser = directDoc.data();
            matchedUid = directDoc.id;
          }
        } catch (e) {}

        if (!matchedUser) {
          try {
            const usersSnap = await getDocs(collection(db, 'mfr_users'));
            for (const docSnap of usersSnap.docs) {
              const data = docSnap.data();
              const dName = (data.name || '').trim().toLowerCase();
              const dEmail = (data.email || '').trim().toLowerCase();
              const dUserId = (data.userId || docSnap.id).trim().toLowerCase();

              if (dName === targetLower || dUserId === targetLower || dEmail === targetLower || docSnap.id.toLowerCase() === targetLower || (targetLower.includes('pawan') && (dName.includes('pawan') || dUserId.includes('pawan')))) {
                matchedUser = data;
                matchedUid = data.userId || docSnap.id;
                break;
              }
            }
          } catch (_) {}
        }
      }

      if (!matchedUser || !matchedUid) {
        throw new Error(`User profile "${cleanKey}" not found in database.`);
      }

      if (matchedUser.active === false || matchedUser.status === 'deleted' || matchedUser.deletedAt) {
        throw new Error(`Your profile (${matchedUser.name}) is deactivated. Please contact an administrator.`);
      }
    }

    throw new Error('Authentication service unavailable. Please check your internet connection.');
  }

  static async setUserPin(userId: string, pin: string): Promise<{ success: boolean; message?: string }> {
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/users/${encodeURIComponent(userId)}/set-pin`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pin })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        return data;
      }
      throw new Error(data.error || 'Failed to update Security PIN.');
    } catch (e: any) {
      throw new Error(e.message || 'Failed to update Security PIN.');
    }
  }

  static async saveUser(user: UserProfile, initialPin?: string): Promise<void> {
    const { pinHash: _ph, pin: _p, ...sanitizedUser } = user as any;
    const cleanUser: UserProfile = sanitizedUser as UserProfile;
    const pin = initialPin || (user as any).pin;

    // 1. Send to server API with authoritative admin privileges
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...cleanUser,
          pin: pin || '1234'
        })
      });

      if (res.status === 409) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "This user has been permanently deleted and cannot be restored.");
      }

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.success && data.user) {
          if (pin) {
            await this.setUserPin(cleanUser.userId, pin).catch(() => {});
          }
          this.invalidateCache('mfr_users');
          await this.getUsers(true);
          await this.logAction(cleanUser.userId, cleanUser.name, 'CREATE_USER', `Created user profile '${cleanUser.name}'`);
          return;
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes("permanently deleted")) {
        throw err;
      }
      console.warn("[API] User creation note:", err);
    }

    // 2. Direct Firestore fallback
    if (useRealFirebase && db) {
      try {
        // Check tombstone first
        const tombSnap = await getDoc(doc(db, 'mfr_deleted_users', cleanUser.userId)).catch(() => null);
        if (tombSnap && tombSnap.exists()) {
          throw new Error("This user has been permanently deleted and cannot be restored.");
        }

        await setDoc(doc(db, 'mfr_users', cleanUser.userId), cleanUser, { merge: true });
        if (pin) {
          await this.setUserPin(cleanUser.userId, pin).catch(() => {});
        }
      } catch (err: any) {
        if (err.message && err.message.includes("permanently deleted")) {
          throw err;
        }
        handleFirestoreError(err, OperationType.WRITE, `mfr_users/${cleanUser.userId}`);
      }
    }

    // 3. Force authoritative fresh fetch
    this.invalidateCache('mfr_users');
    await this.getUsers(true);
    await this.logAction(cleanUser.userId, cleanUser.name, 'CREATE_USER', `Created user profile '${cleanUser.name}'`);
  }

  static async updateUser(userId: string, updates: Partial<UserProfile>): Promise<void> {
    const { pinHash: _ph, pin: _p, ...cleanUpdates } = updates as any;
    const list = await this.getUsers();

    // Enforce only one super_admin in the system
    if (cleanUpdates.role === 'super_admin') {
      for (let i = 0; i < list.length; i++) {
        if (list[i].userId !== userId && list[i].role === 'super_admin') {
          list[i].role = 'admin';
          if (useRealFirebase && db) {
            try {
              const { pinHash: _dPh, pin: _dP, ...demotedClean } = list[i] as any;
              await setDoc(doc(db, 'mfr_users', list[i].userId), demotedClean, { merge: true });
            } catch (_) {}
          }
        }
      }
    }

    const idx = list.findIndex(u => u.userId === userId);
    if (idx !== -1) {
      const updatedUser: UserProfile = { ...list[idx], ...cleanUpdates };
      list[idx] = updatedUser;
      setLocalStorageItem('mfr_users', list);
      if (useRealFirebase && db) {
        try {
          await updateDoc(doc(db, 'mfr_users', userId), cleanUpdates as any);
        } catch (err) {
          try {
            await setDoc(doc(db, 'mfr_users', userId), updatedUser, { merge: true });
          } catch (e) {
            handleFirestoreError(err, OperationType.WRITE, `mfr_users/${userId}`);
          }
        }
      }
    }
  }

  private static async verifyAdmin(userId: string): Promise<void> {
    const users = await this.getUsers();
    const user = users.find(u => u.userId === userId);
    if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
      throw new Error("Unauthorized: Only Admin/Super Admin users are authorized to delete or clear data.");
    }
  }

  static async deleteUser(userId: string, operatorName: string, performerId: string, performerName: string): Promise<void> {
    const users = await this.getUsers();
    const performer = users.find(u => 
      u.userId === performerId || 
      u.userId?.toLowerCase() === performerId?.toLowerCase() || 
      u.name?.toLowerCase() === performerName?.toLowerCase()
    );

    const isPerformerAdmin = 
      performer?.role === 'super_admin' || 
      performer?.role === 'admin' || 
      performer?.department === 'Admin' || 
      performerName?.toLowerCase() === 'admin' ||
      performerId?.toLowerCase() === 'admin';

    if (!isPerformerAdmin) {
      throw new Error("Unauthorized: Only Admins or Super Admins are authorized to delete users.");
    }

    const targetUser = users.find(u => u.userId === userId || u.userId?.toLowerCase() === userId?.toLowerCase());
    if (targetUser) {
      if (performer?.role === 'admin' && performer.department !== 'Admin') {
        if (targetUser.department !== performer.department) {
          throw new Error(`Unauthorized: As Department Head of ${performer.department}, you can only delete users within your own department.`);
        }
        if (targetUser.role !== 'staff') {
          throw new Error("Unauthorized: Department heads can only delete staff-level employees under their own department.");
        }
      }
      if (userId === performerId || (performer && targetUser.userId === performer.userId)) {
        throw new Error("Unauthorized: You cannot delete your own active user profile.");
      }
    }

    // Enforce online connection for user deletions
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error("User deletion requires an online connection.");
    }
    if (this.isOfflineMode()) {
      throw new Error("User deletion requires an online connection.");
    }

    // 1. Scrub offline sync queue of any operations associated with this user
    try {
      const queue = this.getSyncQueue();
      const cleanedQueue = queue.filter(item => {
        const hasTarget = item.operations.some(op => 
          op.collection === 'mfr_users' && 
          (op.docId === userId || op.docId?.toLowerCase() === userId.toLowerCase())
        );
        return !hasTarget;
      });
      setLocalStorageItem('mfr_sync_queue', cleanedQueue);
    } catch (e) {}

    // 2. Update Local Storage and in-memory cache immediately (0ms instant UI update)
    this.invalidateCache('mfr_users');
    const cachedUsers = getLocalStorageItem<UserProfile[]>('mfr_users', []);
    const newList = cachedUsers.filter(u => 
      u.userId !== userId && 
      u.userId?.toLowerCase() !== userId.toLowerCase() &&
      u.name?.toLowerCase() !== (operatorName || '').toLowerCase()
    );
    setLocalStorageItem('mfr_users', newList);
    this.setMemCache('mfr_users', newList);

    // 3. Authoritative backend & Firestore tombstone
    const tombstoneData = {
      userId,
      deletedAt: new Date().toISOString(),
      deletedBy: performerId,
      tombstone: true
    };

    const deleteTasks: Promise<any>[] = [];

    // Backend API delete
    deleteTasks.push(
      this.getAuthHeaders().then(headers => 
        fetch(`${getApiBaseUrl()}/api/users/${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers
        })
      ).catch(() => {})
    );

    // Firestore direct tombstone and deletion
    if (useRealFirebase && db) {
      deleteTasks.push(setDoc(doc(db, 'mfr_deleted_users', userId), tombstoneData, { merge: true }).catch(() => {}));
      deleteTasks.push(deleteDoc(doc(db, 'mfr_users', userId)).catch(() => {}));
      deleteTasks.push(deleteDoc(doc(db, 'mfr_user_credentials', userId)).catch(() => {}));
      if (userId.toLowerCase() !== userId) {
        deleteTasks.push(setDoc(doc(db, 'mfr_deleted_users', userId.toLowerCase()), tombstoneData, { merge: true }).catch(() => {}));
        deleteTasks.push(deleteDoc(doc(db, 'mfr_users', userId.toLowerCase())).catch(() => {}));
        deleteTasks.push(deleteDoc(doc(db, 'mfr_user_credentials', userId.toLowerCase())).catch(() => {}));
      }
    }

    await Promise.all(deleteTasks);
    await this.getUsers(true);

    await this.logAction(performerId, performerName, 'DELETE_USER', `Deleted user account '${operatorName || userId}' (ID: ${userId})`);
  }

  // --- JOB CARDS ---
  static async getJobCards(forceFresh = false): Promise<JobCard[]> {
    if (!forceFresh) {
      const mem = this.getFromMemCache<JobCard[]>('mfr_job_cards');
      if (mem && mem.length > 0) return mem;
    }

    // Read local tombstones for immediate filter
    const localTombs = new Set(getLocalStorageItem<string[]>('mfr_deleted_job_cards', []).map(t => t.toLowerCase().trim()));

    // 1. Authoritative API Fetch
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/job-cards`, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.jobCards)) {
          const activeList: JobCard[] = resData.jobCards.filter((c: any) => {
            if (!c || !c.jobCardNo) return false;
            const jcNo = String(c.jobCardNo).toLowerCase().trim();
            return !localTombs.has(jcNo);
          });
          setLocalStorageItem('mfr_job_cards', activeList);
          this.setMemCache('mfr_job_cards', activeList);
          return activeList;
        }
      }
    } catch (apiErr) {
      // API unavailable or offline; fall through to direct Firestore or cache
    }

    // 2. Direct Firestore Fast Fetch
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_job_cards'));
        const cards: JobCard[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as JobCard;
          if (data && data.jobCardNo) {
            const jcNo = String(data.jobCardNo).toLowerCase().trim();
            if (!localTombs.has(jcNo) && (data as any).active !== false && (data as any).status !== 'deleted' && !(data as any).deletedAt) {
              cards.push(data);
            }
          }
        });
        const sorted = cards.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setLocalStorageItem('mfr_job_cards', sorted);
        this.setMemCache('mfr_job_cards', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_job_cards');
      }
    }

    // 3. Fall back to local storage cache
    const cached = getLocalStorageItem<JobCard[]>('mfr_job_cards', [])
      .filter(c => c && c.jobCardNo && !localTombs.has(String(c.jobCardNo).toLowerCase().trim()) && (c as any).active !== false && (c as any).status !== 'deleted' && !(c as any).deletedAt);
    this.setMemCache('mfr_job_cards', cached);
    return cached;
  }

  static async createJobCard(
    job: Omit<JobCard, 'jobCardNo' | 'orderNo' | 'createdAt' | 'completed' | 'balanceQty'>, 
    creatorId: string, 
    creatorName: string,
    initialMovementOverride?: Partial<MaterialMovement>
  ): Promise<JobCard> {
    const cards = await this.getJobCards();
    
    const isPurchase = job.processType === 'Purchase';
    const prefix = isPurchase ? 'PUR' : 'JC';

    // Filter cards belonging to this series
    const sameSeriesCards = cards.filter(card => {
      if (isPurchase) {
        return card.processType === 'Purchase' || card.jobCardNo.startsWith('PUR-');
      } else {
        return card.processType !== 'Purchase' && !card.jobCardNo.startsWith('PUR-');
      }
    });

    // Auto-generate sequentially
    const currentMaxNo = sameSeriesCards.reduce((acc, card) => {
      const parts = card.jobCardNo.split('-');
      const num = parts.length > 0 ? parseInt(parts[parts.length - 1]) : 1000;
      return !isNaN(num) && num > acc ? num : acc;
    }, 1000);
    let newNo = currentMaxNo + 1;
    let jobCardNo = `${prefix}-${newNo}`;
    while (cards.some(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase())) {
      newNo++;
      jobCardNo = `${prefix}-${newNo}`;
    }
    const orderNo = isPurchase ? `ORD-PUR-${5000 + (newNo - 1000)}` : `ORD-${5000 + (newNo - 1000)}`;

    const newJob: JobCard = {
      ...job,
      status: job.status || 'Pending Acceptance',
      createdBy: creatorName,
      createdByUserId: creatorId,
      jobCardNo,
      orderNo,
      balanceQty: job.orderQty,
      createdAt: new Date().toISOString(),
      completed: false
    } as JobCard;

    const movements = await this.getMovements();
    const newMovementId = `M-${2000 + movements.length + 1}`;
    const unitLabel = job.unit || 'KG';
    const defaultMovement: MaterialMovement = isPurchase ? {
      movementId: newMovementId,
      jobCardNo,
      fromDepartment: 'Purchase',
      toDepartment: (job.currentDepartment as Department) || 'Store',
      quantity: job.currentQty,
      transferBy: creatorName,
      transferDate: new Date().toISOString(),
      accepted: false,
      remarks: job.purchaseDetails?.remarks || `Material inwarded from Supplier: ${job.purchaseDetails?.supplierName || job.partyName}. Total Received: ${job.purchaseDetails?.receivedQty || job.orderQty} ${unitLabel}, Sent to ${job.currentDepartment || 'Store'}: ${job.currentQty} ${unitLabel}.`
    } : {
      movementId: newMovementId,
      jobCardNo,
      fromDepartment: 'Dispatch',
      toDepartment: (job.currentDepartment as Department) || 'Production',
      quantity: job.orderQty,
      transferBy: creatorName,
      transferDate: new Date().toISOString(),
      accepted: false,
      remarks: 'Order registered. Dispatching raw material and job ticket to Production.'
    };

    const initialMovement: MaterialMovement = {
      ...defaultMovement,
      ...(initialMovementOverride || {})
    };

    // 1. Authoritative Backend API Execution FIRST (Source of Truth)
    const apiBase = getApiBaseUrl();
    const headers = await this.getAuthHeaders();
    let authoritativeJob: JobCard | null = null;
    let authoritativeMovement: MaterialMovement | null = null;

    try {
      const res = await fetch(`${apiBase}/api/job-cards`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jobCard: newJob, initialMovement })
      });
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && resData.jobCard) {
          authoritativeJob = resData.jobCard;
          authoritativeMovement = resData.movement || initialMovement;
        }
      }
    } catch (apiErr) {
      console.warn("[JOB_CARD API] Backend API call failed, falling back to direct auth write:", apiErr);
    }

    if (!authoritativeJob) {
      // Direct Firestore write ONLY when client is actively authenticated
      if (useRealFirebase && db && auth?.currentUser) {
        try {
          await setDoc(doc(db, 'mfr_job_cards', jobCardNo), sanitizeForFirestore(newJob));
          await setDoc(doc(db, 'mfr_movements', newMovementId), sanitizeForFirestore(initialMovement));
          authoritativeJob = newJob;
          authoritativeMovement = initialMovement;
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `mfr_job_cards/${jobCardNo}`);
        }
      }
    }

    const finalJob = authoritativeJob || newJob;
    const finalMovement = authoritativeMovement || initialMovement;

    // 2. Reconcile Local Cache & Memory with Authoritative Server Result
    const freshCards = await this.getJobCards();
    const cardIdx = freshCards.findIndex(c => c.jobCardNo.toLowerCase() === finalJob.jobCardNo.toLowerCase());
    if (cardIdx >= 0) {
      freshCards[cardIdx] = finalJob;
    } else {
      freshCards.unshift(finalJob);
    }
    setLocalStorageItem('mfr_job_cards', freshCards);
    this.setMemCache('mfr_job_cards', freshCards);

    const freshMovements = await this.getMovements();
    const movIdx = freshMovements.findIndex(m => m.movementId === finalMovement.movementId);
    if (movIdx >= 0) {
      freshMovements[movIdx] = finalMovement;
    } else {
      freshMovements.unshift(finalMovement);
    }
    setLocalStorageItem('mfr_movements', freshMovements);
    this.setMemCache('mfr_movements', freshMovements);

    await this.logAction(creatorId, creatorName, 'CREATE_JOB_CARD', `Generated job card ${finalJob.jobCardNo} for ${job.partyName} (${job.orderQty} ${unitLabel})`);
    
    // Broadcast real-time SSE event to all connected devices (< 50ms sync)
    await this.broadcastEvent('JOB_UPDATED', { jobCardNo: finalJob.jobCardNo }).catch(() => {});
    await this.broadcastEvent('MOVEMENT_UPDATED', { movementId: finalMovement.movementId, jobCardNo: finalJob.jobCardNo }).catch(() => {});

    // Automatically save item name and code to master list
    try {
      await this.saveItem(job.itemName, job.itemCode, job.partyName);
    } catch (saveErr) {
      console.warn("Failed to automatically save item:", saveErr);
    }

    // Log to Google Sheets
    logJobCardToSheets(finalJob).catch(err => console.warn('Google Sheets log failed: ', err));
    logMaterialMovementToSheets(finalMovement).catch(err => console.warn('Google Sheets movement log failed: ', err));

    return finalJob;
  }

  static async updateJobCard(
    jobCardNo: string, 
    updates: Partial<JobCard>, 
    userId: string, 
    userName: string,
    expectedVersion?: number
  ): Promise<{ success: boolean; conflict?: boolean; currentData?: JobCard; message?: string }> {
    // 1. If physical Firestore is active and expectedVersion is supplied, run atomic OCC transaction check
    if (useRealFirebase && db && expectedVersion !== undefined) {
      try {
        const refUpper = doc(db, 'mfr_job_cards', jobCardNo.toUpperCase());
        let conflictDetected = false;
        let latestDbCard: JobCard | null = null;

        await runTransaction(db, async (transaction) => {
          let snap = await transaction.get(refUpper);
          let targetRef = refUpper;
          if (!snap.exists()) {
            const refAsIs = doc(db, 'mfr_job_cards', jobCardNo);
            snap = await transaction.get(refAsIs);
            targetRef = refAsIs;
          }

          if (!snap.exists()) {
            return;
          }

          const current = snap.data() as JobCard;
          latestDbCard = current;
          const currentVer = current.version || 1;

          // CONFLICT DETECTED: Database record has been modified since user loaded it
          if (currentVer !== expectedVersion) {
            conflictDetected = true;
            return;
          }

          const nextVersion = currentVer + 1;
          const nowIso = new Date().toISOString();
          transaction.update(targetRef, {
            ...updates,
            version: nextVersion,
            updatedAt: nowIso,
            updatedBy: userName || userId
          });
        });

        if (conflictDetected) {
          console.warn(`[OCC Conflict] Job Card ${jobCardNo} version mismatch. Expected: ${expectedVersion}, Current: ${latestDbCard?.version || 1}`);
          return {
            success: false,
            conflict: true,
            currentData: latestDbCard || undefined,
            message: `Record was updated by another user (${latestDbCard?.updatedBy || 'Another crew member'}).`
          };
        }
      } catch (err: any) {
        console.warn("OCC transaction verification error:", err);
      }
    }

    // 2. Authoritative Backend API Execution FIRST
    const apiBase = getApiBaseUrl();
    const headers = await this.getAuthHeaders();
    let authoritativeJob: JobCard | null = null;
    const cards = await this.getJobCards();
    const idx = cards.findIndex(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase());
    const nextVer = idx >= 0 ? (cards[idx].version || 1) + 1 : 1;
    const nowIso = new Date().toISOString();
    const finalPayload: Partial<JobCard> = {
      ...updates,
      version: nextVer,
      updatedAt: nowIso,
      updatedBy: userName || userId
    };

    try {
      const res = await fetch(`${apiBase}/api/job-cards/${encodeURIComponent(jobCardNo)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && resData.jobCard) {
          authoritativeJob = resData.jobCard;
        }
      }
    } catch (apiErr) {
      console.warn("[JOB_CARD API] Update backend call failed, falling back to direct auth write:", apiErr);
    }

    if (!authoritativeJob) {
      if (useRealFirebase && db && auth?.currentUser) {
        try {
          const refUpper = doc(db, 'mfr_job_cards', jobCardNo.toUpperCase());
          const snapUpper = await getDoc(refUpper);
          if (snapUpper.exists()) {
            await updateDoc(refUpper, sanitizeForFirestore(finalPayload) as any);
            authoritativeJob = { ...(snapUpper.data() as JobCard), ...finalPayload } as JobCard;
          } else {
            const refAsIs = doc(db, 'mfr_job_cards', jobCardNo);
            const snapAsIs = await getDoc(refAsIs);
            if (snapAsIs.exists()) {
              await updateDoc(refAsIs, sanitizeForFirestore(finalPayload) as any);
              authoritativeJob = { ...(snapAsIs.data() as JobCard), ...finalPayload } as JobCard;
            }
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `mfr_job_cards/${jobCardNo}`);
        }
      }
    }

    // 3. Reconcile Local Cache & Memory with Authoritative Result
    const freshCards = await this.getJobCards();
    const freshIdx = freshCards.findIndex(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase());
    if (freshIdx >= 0) {
      freshCards[freshIdx] = authoritativeJob || ({ ...freshCards[freshIdx], ...finalPayload } as JobCard);
      setLocalStorageItem('mfr_job_cards', freshCards);
      this.setMemCache('mfr_job_cards', freshCards);
    }

    await this.logAction(userId, userName, 'UPDATE_JOB_CARD', `Updated Job Card ${jobCardNo}. Status: ${updates.status || cards[idx].status}`);
    
    // Broadcast real-time SSE event to all connected devices (< 50ms sync)
    await this.broadcastEvent('JOB_UPDATED', { jobCardNo }).catch(() => {});

    // Check if total rejection quantity for the job card exceeds 10% of total order quantity
    try {
      const updatedCard = cards[idx];
      const totalRejections = (updatedCard.heatTreatmentDetails?.rejectionQty || 0) +
                              (updatedCard.platingDetails?.rejectionQty || 0) +
                              (updatedCard.packingDetails?.rejectionQty || 0) +
                              (updatedCard.storeDetails?.rejectionQty || 0);
      const orderQty = updatedCard.orderQty || 0;
      if (orderQty > 0 && totalRejections > orderQty * 0.10) {
        const currentNotifications = await this.getNotifications();
        const alreadyNotified = currentNotifications.some(n => 
          n.department === 'Production' &&
          n.title.includes('High Rejection') &&
          n.message.includes(jobCardNo)
        );
        if (!alreadyNotified) {
          await this.createNotification({
            department: 'Production',
            title: '⚠️ High Rejection Rate Alert',
            message: `Job Card ${jobCardNo} (${updatedCard.itemName}) has exceeded 10% rejection threshold. Total Rejections: ${totalRejections} KG / Order Qty: ${orderQty} KG (${((totalRejections / orderQty) * 100).toFixed(1)}%).`,
            userId: 'all_production'
          });
        }
      }
    } catch (e) {
      console.error("Error creating rejection rate alert", e);
    }

    this.triggerSheetsSync(jobCardNo, updates, userName);
  }

  static async bulkUpdateJobCardStatus(
    jobCardNos: string[], 
    newStatus: JobCardStatus, 
    userId: string, 
    userName: string
  ): Promise<void> {
    const cards = await this.getJobCards();
    const isCompleted = newStatus === 'Completed';

    // 1. Local storage batch update first
    for (const jobCardNo of jobCardNos) {
      const idx = cards.findIndex(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase());
      if (idx !== -1) {
        cards[idx] = {
          ...cards[idx],
          status: newStatus,
          completed: isCompleted
        };
      }
    }
    setLocalStorageItem('mfr_job_cards', cards);

    // 2. Physical Firestore write in parallel background batch
    const writePromises = jobCardNos.map(jobCardNo => {
      const updates = { status: newStatus, completed: isCompleted };
      return this.tryPhysicalWrite(
        'Bulk Update Job Card Status',
        `Bulk status update for ${jobCardNo} to ${newStatus}`,
        [
          { collection: 'mfr_job_cards', docId: jobCardNo.toUpperCase(), data: updates, operation: 'update' }
        ],
        async () => {
          const refUpper = doc(db, 'mfr_job_cards', jobCardNo.toUpperCase());
          const snapUpper = await getDoc(refUpper);
          if (snapUpper.exists()) {
            await updateDoc(refUpper, updates as any);
          } else {
            const refAsIs = doc(db, 'mfr_job_cards', jobCardNo);
            const snapAsIs = await getDoc(refAsIs);
            if (snapAsIs.exists()) {
              await updateDoc(refAsIs, updates as any);
            } else {
              await updateDoc(refUpper, updates as any);
            }
          }
        }
      );
    });
    Promise.all(writePromises).catch(err => console.warn('Bulk status sync warning:', err));

    await this.logAction(
      userId, 
      userName, 
      'BULK_UPDATE_JOB_STATUS', 
      `Bulk updated ${jobCardNos.length} job cards status to '${newStatus}': [${jobCardNos.join(', ')}]`
    );
  }

  static async deleteJobCard(jobCardNo: string, userId: string, userName: string): Promise<void> {
    await this.verifyAdmin(userId);

    // 1. Invalidate client caches and record local tombstone immediately (0ms instant UI update)
    this.invalidateCache('mfr_job_cards');
    this.invalidateCache('mfr_movements');
    this.invalidateCache('mfr_notifications');

    const upperNo = jobCardNo.toUpperCase();
    const localTombs = getLocalStorageItem<string[]>('mfr_deleted_job_cards', []);
    if (!localTombs.includes(upperNo)) {
      localTombs.push(upperNo);
      setLocalStorageItem('mfr_deleted_job_cards', localTombs);
    }

    const cachedCards = getLocalStorageItem<JobCard[]>('mfr_job_cards', []);
    const updatedCards = cachedCards.filter(c => c.jobCardNo.toLowerCase() !== jobCardNo.toLowerCase());
    setLocalStorageItem('mfr_job_cards', updatedCards);
    this.setMemCache('mfr_job_cards', updatedCards);

    const cachedMovements = getLocalStorageItem<MaterialMovement[]>('mfr_movements', []);
    const updatedMovements = cachedMovements.filter(m => m.jobCardNo.toLowerCase() !== jobCardNo.toLowerCase());
    setLocalStorageItem('mfr_movements', updatedMovements);
    this.setMemCache('mfr_movements', updatedMovements);

    const cachedNotifications = getLocalStorageItem<any[]>('mfr_notifications', []);
    const updatedNotifications = cachedNotifications.filter(n => !n.message?.toLowerCase().includes(jobCardNo.toLowerCase()));
    setLocalStorageItem('mfr_notifications', updatedNotifications);
    this.setMemCache('mfr_notifications', updatedNotifications);

    // 2. Authoritative API Deletion
    let apiDeleted = false;
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/job-cards/${encodeURIComponent(jobCardNo)}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        if (resData.success) {
          apiDeleted = true;
        }
      }
    } catch (apiErr) {
      // Fall through to direct Firestore
    }

    // 3. Direct Physical Firestore fallback with tombstone creation
    if (!apiDeleted && useRealFirebase && db) {
      try {
        const refUpper = doc(db, 'mfr_job_cards', upperNo);
        const refAsIs = doc(db, 'mfr_job_cards', jobCardNo);
        
        // Write tombstone
        const tombRef = doc(db, 'mfr_deleted_job_cards', upperNo);
        await setDoc(tombRef, {
          jobCardNo: upperNo,
          deletedAt: new Date().toISOString(),
          deletedBy: userId,
          deletedByName: userName,
          tombstone: true
        });

        const snapUpper = await getDoc(refUpper);
        if (snapUpper.exists()) {
          await deleteDoc(refUpper);
        }
        const snapAsIs = await getDoc(refAsIs);
        if (snapAsIs.exists()) {
          await deleteDoc(refAsIs);
        }

        // Cascade delete movements from Firestore
        const movementsSnap = await getDocs(query(collection(db, 'mfr_movements'), where('jobCardNo', '==', jobCardNo)));
        for (const docSnap of movementsSnap.docs) {
          await deleteDoc(doc(db, 'mfr_movements', docSnap.id));
        }

        // Cascade delete notifications mentioning this job card
        const notificationsSnap = await getDocs(collection(db, 'mfr_notifications'));
        for (const docSnap of notificationsSnap.docs) {
          const notif = docSnap.data();
          if (notif.message && notif.message.toLowerCase().includes(jobCardNo.toLowerCase())) {
            await deleteDoc(doc(db, 'mfr_notifications', docSnap.id));
          }
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `mfr_job_cards/${upperNo}`);
      }
    }

    // 4. Broadcast instant cross-device SSE synchronization
    await this.broadcastEvent('JOB_UPDATED').catch(() => {});
    await this.broadcastEvent('MOVEMENT_UPDATED').catch(() => {});

    await this.logAction(userId, userName, 'DELETE_JOB_CARD', `Deleted Job Card: ${jobCardNo} and all related material transitions/notifications`);
  }

  static async deleteAllJobCards(userId: string, userName: string): Promise<void> {
    await this.verifyAdmin(userId);

    // 1. Invalidate caches and clear Local Storage offline caches
    this.invalidateCache('mfr_job_cards');
    this.invalidateCache('mfr_movements');
    this.invalidateCache('mfr_notifications');
    this.invalidateCache('mfr_items');

    setLocalStorageItem('mfr_job_cards', []);
    setLocalStorageItem('mfr_movements', []);
    setLocalStorageItem('mfr_notifications', []);
    setLocalStorageItem('mfr_items', []);

    this.setMemCache('mfr_job_cards', []);
    this.setMemCache('mfr_movements', []);
    this.setMemCache('mfr_notifications', []);
    this.setMemCache('mfr_items', []);

    // 2. Authoritative API Deletion
    let apiPurged = false;
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/job-cards/delete-all`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        if (resData.success) {
          apiPurged = true;
        }
      }
    } catch (apiErr) {
      // Fall through to direct Firestore
    }

    // 3. Physical Firestore fallback
    if (!apiPurged && useRealFirebase && db) {
      try {
        const collectionsToPurge = ['mfr_job_cards', 'mfr_movements', 'mfr_notifications', 'mfr_items'];
        for (const colName of collectionsToPurge) {
          const querySnapshot = await getDocs(collection(db, colName));
          for (const docSnap of querySnapshot.docs) {
            await deleteDoc(doc(db, colName, docSnap.id));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'mfr_job_cards');
      }
    }

    // 4. Broadcast instant cross-device SSE synchronization
    await this.broadcastEvent('ALL_UPDATED').catch(() => {});
    await this.broadcastEvent('JOB_UPDATED').catch(() => {});

    await this.logAction(userId, userName, 'DELETE_ALL_JOB_CARDS', `Deleted all job card entries, material movements, notifications, and Raw Material Store item records from database`);
  }

  static async factoryReset(pin: string): Promise<{ success: boolean; resetOperationId?: string; factoryResetGeneration?: string; activeUsersCount?: number; firstRun?: boolean; message?: string }> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${getApiBaseUrl()}/api/admin/factory-reset`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin.trim() })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Factory reset failed with status ${res.status}`);
    }

    const newGen = data.factoryResetGeneration || `gen-${Date.now()}`;
    this.clearClientCaches(newGen);

    try {
      localStorage.setItem('mfr_is_first_run', 'true');
      sessionStorage.setItem('mfr_is_first_run', 'true');
      localStorage.setItem('mfr_system_generation', newGen);
      sessionStorage.setItem('mfr_system_generation', newGen);
    } catch (_) {}

    // Invalidate / reset IndexedDB Firestore persistence if active
    if (useRealFirebase && db) {
      try {
        const { terminate, clearIndexedDbPersistence } = await import('firebase/firestore');
        await terminate(db).catch(() => {});
        await clearIndexedDbPersistence(db).catch(() => {});
      } catch (_) {}
    }

    window.dispatchEvent(new CustomEvent('factory-reset-completed', { detail: { generation: newGen, firstRun: true } }));

    return data;
  }

  // --- MATERIAL MOVEMENTS ---
  static async getMovements(forceFresh = false): Promise<MaterialMovement[]> {
    if (!forceFresh) {
      const mem = this.getFromMemCache<MaterialMovement[]>('mfr_movements');
      if (mem && mem.length > 0) return mem;
    }

    // 1. Authoritative Cloud Run API Fetch FIRST
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/movements`, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.movements)) {
          setLocalStorageItem('mfr_movements', resData.movements);
          this.setMemCache('mfr_movements', resData.movements);
          return resData.movements;
        }
      }
    } catch (apiErr) {
      // API unavailable, fall back to direct Firestore or cache
    }

    // 2. Direct Firestore Client Fallback
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_movements'));
        const list: MaterialMovement[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as MaterialMovement;
          if (data && data.movementId) {
            list.push(data);
          }
        });
        const sorted = list.sort((a, b) => new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime());
        setLocalStorageItem('mfr_movements', sorted);
        this.setMemCache('mfr_movements', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_movements');
      }
    }

    // 3. Fall back to local storage cache
    const cached = getLocalStorageItem<MaterialMovement[]>('mfr_movements', []);
    this.setMemCache('mfr_movements', cached);
    return cached;
  }

  static async createMovement(movement: Omit<MaterialMovement, 'movementId' | 'transferDate' | 'accepted'>, userId: string, userName: string): Promise<MaterialMovement> {
    if (movement.quantity <= 0) {
      throw new Error(`Invalid movement quantity: ${movement.quantity}. Must be greater than 0.`);
    }

    const movements = await this.getMovements();

    // Check for duplicate pending transfer request for same job card between same departments
    if (!movement.isIssueRequest && !movement.jobCardNo.startsWith('STOCK-IN-')) {
      const pendingDup = movements.find(m => 
        !m.accepted && 
        !m.deletedDate &&
        m.jobCardNo.toLowerCase() === movement.jobCardNo.toLowerCase() &&
        m.fromDepartment === movement.fromDepartment &&
        m.toDepartment === movement.toDepartment
      );
      if (pendingDup) {
        throw new Error(`A transfer request for Job Card ${movement.jobCardNo} from ${movement.fromDepartment} to ${movement.toDepartment} is already pending acceptance.`);
      }
    }

    const newId = `M-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const nowIso = new Date().toISOString();
    
    const newMov: MaterialMovement = {
      ...movement,
      transferBy: movement.transferBy || userName || 'Staff',
      movementId: newId,
      transferDate: nowIso,
      accepted: false,
      initiatedByUserId: userId,
      initiatedByUserName: userName
    };

    // 1. Authoritative Backend API Execution FIRST
    const apiBase = getApiBaseUrl();
    const headers = await this.getAuthHeaders();
    let authoritativeMov: MaterialMovement | null = null;

    try {
      const res = await fetch(`${apiBase}/api/movements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ movement: newMov })
      });
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && resData.movement) {
          authoritativeMov = resData.movement;
        }
      }
    } catch (apiErr) {
      console.warn("[MOVEMENTS API] Create movement call failed, falling back to direct write:", apiErr);
    }

    if (!authoritativeMov) {
      if (useRealFirebase && db && auth?.currentUser) {
        try {
          await setDoc(doc(db, 'mfr_movements', newId), sanitizeForFirestore(newMov));
          authoritativeMov = newMov;
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `mfr_movements/${newId}`);
        }
      }
    }

    const finalMov = authoritativeMov || newMov;

    // 2. Reconcile Local Cache & Memory with Authoritative Server Result
    const freshMovements = await this.getMovements();
    const movIdx = freshMovements.findIndex(m => m.movementId === finalMov.movementId);
    if (movIdx >= 0) {
      freshMovements[movIdx] = finalMov;
    } else {
      freshMovements.unshift(finalMov);
    }
    setLocalStorageItem('mfr_movements', freshMovements);
    this.setMemCache('mfr_movements', freshMovements);
    
    // Update Job Card department & status to show pending placement (only if NOT a Dispatch Issue Request)
    if (!movement.isIssueRequest && !movement.jobCardNo.startsWith('STOCK-IN-')) {
      await this.updateJobCard(movement.jobCardNo, {
        status: 'Pending Acceptance',
        currentDepartment: movement.toDepartment as Department
      }, userId, userName).catch(() => {});
    }

    // Create Notification for the receiving department
    const isRawStoreReq = movement.isIssueRequest && movement.fromDepartment === 'Raw Material Store';
    await this.createNotification({
      department: isRawStoreReq ? 'Raw Material Store' : (movement.isIssueRequest ? 'Store' : (movement.toDepartment === 'Completed' ? 'Dispatch' : (movement.toDepartment as Department))),
      title: isRawStoreReq ? 'Raw Material Request' : (movement.isIssueRequest ? 'Dispatch Issue Request' : 'Material Sent'),
      message: isRawStoreReq
        ? `Job Card ${movement.jobCardNo}: Production requested raw material of ${movement.requestedQty} KG.`
        : (movement.isIssueRequest
          ? `Job Card ${movement.jobCardNo}: Dispatch requested issue of ${movement.requestedQty} ${(movement as any).requestedUnit || 'KG'} from Store.`
          : `Job Card ${movement.jobCardNo}: ${movement.quantity} KG transferred from ${movement.fromDepartment} to ${movement.toDepartment}.`),
      userId: isRawStoreReq ? 'all_raw_material_store' : (movement.isIssueRequest ? 'all_store' : `all_${movement.toDepartment.toLowerCase().replace(' ', '_')}`)
    }).catch(() => {});

    await this.logAction(
      userId, 
      userName, 
      'MATERIAL_TRANSFER', 
      `Dispatched ${movement.quantity} KG of Job Card ${movement.jobCardNo} from ${movement.fromDepartment} to ${movement.toDepartment}.`
    );

    // Broadcast SSE Events AFTER COMMIT
    await this.broadcastEvent('MOVEMENT_UPDATED', { movementId: finalMov.movementId, jobCardNo: movement.jobCardNo }).catch(() => {});
    if (!movement.jobCardNo.startsWith('STOCK-IN-')) {
      await this.broadcastEvent('JOB_UPDATED', { jobCardNo: movement.jobCardNo }).catch(() => {});
    }

    // Log to Google Sheets
    logMaterialMovementToSheets(finalMov).catch(err => console.warn('Google Sheets movement log failed:', err));

    return finalMov;
  }

  static async acceptMovement(
    movementId: string, 
    acceptedByUserId: string, 
    acceptedByName: string, 
    remarks?: string,
    extraFields?: { allottedLocation?: string; rackNo?: string; quantity?: number; issueStatus?: 'Issued' | 'Rejected' }
  ): Promise<void> {
    const list = await this.getMovements();
    const localIdx = list.findIndex(m => m.movementId === movementId);
    let localMov = localIdx >= 0 ? list[localIdx] : null;

    let targetJobCardNo = localMov?.jobCardNo || '';
    let finalMovement: MaterialMovement | null = null;
    let finalJobCardUpdates: Partial<JobCard> | null = null;
    const nowIso = new Date().toISOString();

    // 1. Authoritative Backend API Call (Primary Protected Mutation Path)
    const apiBase = getApiBaseUrl();
    const headers = await this.getAuthHeaders();
    let apiSucceeded = false;

    try {
      const res = await fetch(`${apiBase}/api/movements/${encodeURIComponent(movementId)}/accept`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          remarks,
          allottedLocation: extraFields?.allottedLocation,
          rackNo: extraFields?.rackNo,
          quantity: extraFields?.quantity,
          issueStatus: extraFields?.issueStatus
        })
      });

      if (res.ok) {
        const apiData = await res.json();
        if (apiData && apiData.success) {
          apiSucceeded = true;
          finalMovement = apiData.movement;
          finalJobCardUpdates = apiData.jobCard;
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error("Your session has expired. Please log in again.");
        }
        if (res.status === 403) {
          throw new Error(errJson.error || "Your account is not authorized to receive this material.");
        }
        if (res.status === 404) {
          throw new Error("Movement not found or already deleted.");
        }
        if (res.status === 409) {
          throw new Error("Material transfer has already been accepted.");
        }
        throw new Error(errJson.error || `Failed to accept cargo (status ${res.status}).`);
      }
    } catch (apiErr: any) {
      if (apiErr.message && (apiErr.message.includes("authorized") || apiErr.message.includes("session") || apiErr.message.includes("already been accepted") || apiErr.message.includes("not found"))) {
        throw apiErr;
      }
      console.warn("[ACCEPT API] Backend API call failed:", apiErr);
    }

    // Direct Firestore write ONLY when client is actively authenticated in Firebase Auth
    if (!apiSucceeded && useRealFirebase && db && auth?.currentUser && !this.isOfflineMode()) {
      try {
        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'mfr_movements', movementId);
          const movSnap = await transaction.get(movRef);

          let currentMovData: MaterialMovement;
          if (movSnap.exists()) {
            currentMovData = movSnap.data() as MaterialMovement;
          } else if (localMov) {
            currentMovData = localMov;
          } else {
            throw new Error(`Movement ${movementId} not found in database.`);
          }

          if (currentMovData.accepted && currentMovData.issueStatus !== 'Rejected') {
            finalMovement = currentMovData;
            return;
          }

          targetJobCardNo = currentMovData.jobCardNo;
          let jcSnap: any = null;
          let targetJcRef: any = null;

          if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
            const jcUpperRef = doc(db, 'mfr_job_cards', targetJobCardNo.toUpperCase());
            const snapUpper = await transaction.get(jcUpperRef);
            if (snapUpper.exists()) {
              jcSnap = snapUpper;
              targetJcRef = jcUpperRef;
            } else {
              const jcAsIsRef = doc(db, 'mfr_job_cards', targetJobCardNo);
              const snapAsIs = await transaction.get(jcAsIsRef);
              if (snapAsIs.exists()) {
                jcSnap = snapAsIs;
                targetJcRef = jcAsIsRef;
              }
            }
          }

          const updatedMov: MaterialMovement = {
            ...currentMovData,
            accepted: true,
            acceptedBy: acceptedByName || acceptedByUserId,
            acceptedDate: nowIso,
            modifiedByUserId: acceptedByUserId,
            modifiedByUserName: acceptedByName,
            modifiedDate: nowIso,
            modifiedAction: 'ACCEPT'
          };
          if (remarks) updatedMov.remarks = remarks;
          if (extraFields?.quantity !== undefined) updatedMov.quantity = extraFields.quantity;

          finalMovement = updatedMov;
          transaction.set(movRef, sanitizeForFirestore(updatedMov), { merge: true });

          if (targetJcRef && jcSnap && jcSnap.exists()) {
            const jcData = jcSnap.data() as JobCard;
            const nextVersion = (jcData.version || 1) + 1;
            const nextStatus: JobCardStatus = (updatedMov.toDepartment === 'Production' ? 'Pending' : (updatedMov.toDepartment === 'Completed' ? 'Completed' : 'In Process')) as JobCardStatus;
            const jcUpdates: Partial<JobCard> = {
              currentDepartment: updatedMov.toDepartment,
              status: nextStatus,
              currentQty: updatedMov.quantity || jcData.currentQty,
              version: nextVersion,
              updatedAt: nowIso,
              updatedBy: acceptedByName || acceptedByUserId
            };
            finalJobCardUpdates = jcUpdates;
            transaction.update(targetJcRef, sanitizeForFirestore(jcUpdates));
          }
        });
      } catch (txnErr) {
        console.warn("Direct Firestore fallback error:", txnErr);
      }
    }

    if (!apiSucceeded && !finalMovement && !this.isOfflineMode()) {
      throw new Error("Server connection unavailable. Data was not saved.");
    }

    // 2. Update Local Cache & Memory
    const currentMovements = await this.getMovements();
    const updatedMov = finalMovement || {
      ...localMov!,
      accepted: true,
      acceptedBy: acceptedByName || acceptedByUserId,
      acceptedDate: nowIso,
      modifiedByUserId: acceptedByUserId,
      modifiedByUserName: acceptedByName,
      modifiedDate: nowIso,
      modifiedAction: 'ACCEPT'
    };

    const movListIdx = currentMovements.findIndex(m => m.movementId === movementId);
    if (movListIdx >= 0) {
      currentMovements[movListIdx] = updatedMov;
    } else {
      currentMovements.unshift(updatedMov);
    }
    setLocalStorageItem('mfr_movements', currentMovements);
    this.setMemCache('mfr_movements', currentMovements);

    if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
      const cards = await this.getJobCards();
      const cardIdx = cards.findIndex(c => c.jobCardNo.toLowerCase() === targetJobCardNo.toLowerCase());
      if (cardIdx >= 0) {
        const existingCard = cards[cardIdx];
        const updatedCard = {
          ...existingCard,
          ...(finalJobCardUpdates || {
            currentDepartment: updatedMov.toDepartment,
            status: updatedMov.toDepartment === 'Production' ? 'Pending' : (updatedMov.toDepartment === 'Completed' ? 'Completed' : 'In Process'),
            currentQty: updatedMov.quantity,
            version: (existingCard.version || 1) + 1,
            updatedAt: nowIso,
            updatedBy: acceptedByName || acceptedByUserId
          })
        } as JobCard;
        cards[cardIdx] = updatedCard;
        setLocalStorageItem('mfr_job_cards', cards);
        this.setMemCache('mfr_job_cards', cards);
      }
    }

    // Audit Logging
    await this.logAction(
      acceptedByUserId, 
      acceptedByName, 
      'ACCEPT_MATERIAL', 
      `User ${acceptedByName} (ID: ${acceptedByUserId}) accepted material movement ${movementId}: Confirmed transfer of ${updatedMov.quantity} KG for ${updatedMov.jobCardNo} at ${updatedMov.toDepartment}.`
    );

    // Notification to previous department
    if (updatedMov.fromDepartment) {
      await this.createNotification({
        department: updatedMov.fromDepartment,
        title: 'Material Accepted',
        message: `${acceptedByName} accepted ${updatedMov.quantity} KG for Job Card ${updatedMov.jobCardNo} at ${updatedMov.toDepartment}.`,
        userId: `all_${updatedMov.fromDepartment.toLowerCase().replace(/\s+/g, '_')}`
      }).catch(() => {});
    }

    // Broadcast SSE Events AFTER COMMIT
    await this.broadcastEvent('MOVEMENT_UPDATED', { movementId, jobCardNo: updatedMov.jobCardNo }).catch(() => {});
    if (targetJobCardNo) {
      await this.broadcastEvent('JOB_UPDATED', { jobCardNo: targetJobCardNo }).catch(() => {});
    }

    // Log to Google Sheets
    logMaterialMovementToSheets(updatedMov).catch(err => console.warn('Google Sheets movement log failed:', err));
  }

  static async rejectMovement(movementId: string, rejectedByUserId: string, rejectedByName: string, remarks: string): Promise<void> {
    const list = await this.getMovements();
    const idx = list.findIndex(m => m.movementId === movementId);
    const localMov = idx >= 0 ? list[idx] : null;

    let targetJobCardNo = localMov?.jobCardNo || '';
    let finalMovement: MaterialMovement | null = null;
    const nowIso = new Date().toISOString();

    // 1. Authoritative Backend API Call
    const apiBase = getApiBaseUrl();
    const headers = await this.getAuthHeaders();
    let apiSucceeded = false;

    try {
      const res = await fetch(`${apiBase}/api/movements/${encodeURIComponent(movementId)}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ remarks })
      });

      if (res.ok) {
        const apiData = await res.json();
        if (apiData && apiData.success) {
          apiSucceeded = true;
          finalMovement = apiData.movement;
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("Your session has expired. Please log in again.");
        if (res.status === 403) throw new Error(errJson.error || "Your account is not authorized to reject this material.");
        throw new Error(errJson.error || `Failed to reject cargo (status ${res.status}).`);
      }
    } catch (apiErr: any) {
      if (apiErr.message && (apiErr.message.includes("authorized") || apiErr.message.includes("session"))) {
        throw apiErr;
      }
      console.warn("[REJECT API] Backend API call failed, falling back to direct write:", apiErr);
    }

    // Direct Firestore write ONLY when client is actively authenticated
    if (!apiSucceeded && useRealFirebase && db && auth?.currentUser && !this.isOfflineMode()) {
      try {
        await runTransaction(db, async (transaction) => {
          const movRef = doc(db, 'mfr_movements', movementId);
          const movSnap = await transaction.get(movRef);

          let currentMovData: MaterialMovement;
          if (movSnap.exists()) {
            currentMovData = movSnap.data() as MaterialMovement;
          } else if (localMov) {
            currentMovData = localMov;
          } else {
            return;
          }

          targetJobCardNo = currentMovData.jobCardNo;
          let jcSnap: any = null;
          let targetJcRef: any = null;

          if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
            const jcUpperRef = doc(db, 'mfr_job_cards', targetJobCardNo.toUpperCase());
            const snapUpper = await transaction.get(jcUpperRef);
            if (snapUpper.exists()) {
              jcSnap = snapUpper;
              targetJcRef = jcUpperRef;
            } else {
              const jcAsIsRef = doc(db, 'mfr_job_cards', targetJobCardNo);
              const snapAsIs = await transaction.get(jcAsIsRef);
              if (snapAsIs.exists()) {
                jcSnap = snapAsIs;
                targetJcRef = jcAsIsRef;
              }
            }
          }

          const updatedMov: MaterialMovement = {
            ...currentMovData,
            accepted: false,
            issueStatus: 'Rejected',
            remarks: remarks ? `REJECTED: ${remarks}` : (currentMovData.remarks || 'Rejected'),
            rejectedBy: rejectedByName || rejectedByUserId,
            rejectedByUserId,
            rejectedDate: nowIso,
            modifiedByUserId: rejectedByUserId,
            modifiedByUserName: rejectedByName,
            modifiedDate: nowIso,
            modifiedAction: 'REJECT'
          };
          finalMovement = updatedMov;
          transaction.set(movRef, sanitizeForFirestore(updatedMov), { merge: true });

          if (targetJcRef && jcSnap && jcSnap.exists()) {
            const jcData = jcSnap.data() as JobCard;
            transaction.update(targetJcRef, sanitizeForFirestore({
              status: 'Pending Acceptance' as JobCardStatus,
              updatedAt: nowIso,
              updatedBy: rejectedByName || rejectedByUserId
            }));
          }
        });
      } catch (txnErr) {
        console.warn("Direct Firestore reject fallback error:", txnErr);
      }
    }

    if (!apiSucceeded && !finalMovement && !this.isOfflineMode()) {
      throw new Error("Server connection unavailable. Data was not saved.");
    }

    // 2. Update Local Cache & Memory
    const currentMovements = await this.getMovements();
    const updatedMov = finalMovement || {
      ...localMov!,
      accepted: false,
      issueStatus: 'Rejected',
      remarks: remarks ? `REJECTED: ${remarks}` : (localMov?.remarks || 'Rejected'),
      rejectedBy: rejectedByName || rejectedByUserId,
      rejectedByUserId,
      rejectedDate: nowIso,
      modifiedByUserId: rejectedByUserId,
      modifiedByUserName: rejectedByName,
      modifiedDate: nowIso,
      modifiedAction: 'REJECT'
    };

    const movListIdx = currentMovements.findIndex(m => m.movementId === movementId);
    if (movListIdx >= 0) {
      currentMovements[movListIdx] = updatedMov;
    } else {
      currentMovements.unshift(updatedMov);
    }
    setLocalStorageItem('mfr_movements', currentMovements);
    this.setMemCache('mfr_movements', currentMovements);

    if (targetJobCardNo && !targetJobCardNo.startsWith('STOCK-IN-')) {
      const cards = await this.getJobCards();
      const cardIdx = cards.findIndex(c => c.jobCardNo.toLowerCase() === targetJobCardNo.toLowerCase());
      if (cardIdx >= 0) {
        cards[cardIdx] = {
          ...cards[cardIdx],
          status: 'Pending Acceptance',
          updatedAt: nowIso,
          updatedBy: rejectedByName || rejectedByUserId
        };
        setLocalStorageItem('mfr_job_cards', cards);
        this.setMemCache('mfr_job_cards', cards);
      }
    }

    await this.logAction(
      rejectedByUserId, 
      rejectedByName, 
      'REJECT_MATERIAL', 
      `User ${rejectedByName} (ID: ${rejectedByUserId}) rejected/deleted material movement ${movementId}: Sent ${localMov?.quantity || 0} KG of Job Card ${targetJobCardNo} back to ${localMov?.fromDepartment || 'origin'} from ${localMov?.toDepartment || 'destination'}. Reason: "${remarks}"`
    );

    // Broadcast SSE Events
    await this.broadcastEvent('MOVEMENT_UPDATED', { movementId, jobCardNo: targetJobCardNo }).catch(() => {});
    if (targetJobCardNo) {
      await this.broadcastEvent('JOB_UPDATED', { jobCardNo: targetJobCardNo }).catch(() => {});
    }

    // Log to Google Sheets
    if (localMov) {
      logMaterialMovementToSheets({
        ...localMov,
        accepted: false,
        remarks: `REJECTED: ${remarks}`
      }).catch(err => console.warn('Google Sheets movement log failed:', err));
    }
  }

  static async updateMovement(movementId: string, quantity: number, remarks: string, userId: string, userName: string): Promise<void> {
    const list = await this.getMovements();
    const idx = list.findIndex(m => m.movementId === movementId);
    if (idx === -1) throw new Error(`Movement ${movementId} not found`);
    const mov = list[idx];
    const oldQty = mov.quantity;
    
    mov.quantity = quantity;
    if (remarks) mov.remarks = remarks;
    
    mov.modifiedByUserId = userId;
    mov.modifiedByUserName = userName;
    mov.modifiedDate = new Date().toISOString();
    mov.modifiedAction = 'EDIT';

    // 1. Update Local Storage offline cache first
    setLocalStorageItem('mfr_movements', list);
    this.setMemCache('mfr_movements', list);

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'mfr_movements', movementId), sanitizeForFirestore(mov));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `mfr_movements/${movementId}`);
      }
    }

    // Also update current quantity on the job card if it is currently in the active department
    const cards = await this.getJobCards();
    const cardIdx = cards.findIndex(c => c.jobCardNo.toLowerCase() === mov.jobCardNo.toLowerCase());
    if (cardIdx >= 0) {
      const card = cards[cardIdx];
      if (card.currentDepartment === mov.toDepartment) {
        await this.updateJobCard(mov.jobCardNo, {
          currentQty: quantity
        }, userId, userName);
      }
    }

    await this.logAction(
      userId, 
      userName, 
      'MODIFY_MOVEMENT', 
      `User ${userName} (ID: ${userId}) modified material movement ${movementId} (Job Card ${mov.jobCardNo}): changed quantity from ${oldQty} KG to ${quantity} KG. Remarks: "${remarks}"`
    );

    // Log to Google Sheets
    logMaterialMovementToSheets(mov).catch(err => console.warn('Google Sheets movement log failed:', err));
  }

  static async deleteMovement(movementId: string, userId: string, userName: string): Promise<void> {
    const list = await this.getMovements();
    const idx = list.findIndex(m => m.movementId === movementId);
    if (idx === -1) throw new Error(`Movement ${movementId} not found`);
    const mov = list[idx];

    // Track deletion info before we delete it
    mov.deletedByUserId = userId;
    mov.deletedByUserName = userName;
    mov.deletedDate = new Date().toISOString();

    // 1. Remove from Local Storage list
    list.splice(idx, 1);
    setLocalStorageItem('mfr_movements', list);
    this.setMemCache('mfr_movements', list);

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        await deleteDoc(doc(db, 'mfr_movements', movementId));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `mfr_movements/${movementId}`);
      }
    }

    await this.logAction(
      userId, 
      userName, 
      'DELETE_MOVEMENT', 
      `User ${userName} (ID: ${userId}) deleted material movement ${movementId} for Job Card ${mov.jobCardNo}: Removed transit record of ${mov.quantity} KG from ${mov.fromDepartment} to ${mov.toDepartment}.`
    );
  }

  static async revertMovement(movementId: string, userId: string, userName: string): Promise<void> {
    const list = await this.getMovements();
    const mov = list.find(m => m.movementId === movementId);
    if (!mov) throw new Error(`Movement ${movementId} not found or already reverted.`);

    // 1. Delete movement record first
    await this.deleteMovement(movementId, userId, userName);

    // 2. Restore job card state to previous state if applicable
    if (!mov.isIssueRequest && !mov.jobCardNo.startsWith('STOCK-IN-')) {
      const remainingList = await this.getMovements();
      const otherMovs = remainingList.filter(m => m.jobCardNo.toLowerCase() === mov.jobCardNo.toLowerCase());
      
      const restoredDept: Department | 'Completed' = otherMovs.length > 0 
        ? (otherMovs[0].toDepartment as Department | 'Completed') 
        : (mov.fromDepartment as Department | 'Completed');
      const isCompleted = (restoredDept as string) === 'Completed';
      const restoredStatus: JobCardStatus = isCompleted ? 'Completed' : 'In Process';

      await this.updateJobCard(mov.jobCardNo, {
        currentDepartment: restoredDept,
        status: restoredStatus,
        completed: isCompleted
      }, userId, userName);
    }

    await this.logAction(
      userId,
      userName,
      'UNDO_TRANSFER',
      `Reverted material transfer ${movementId} for Job Card ${mov.jobCardNo} (${mov.quantity} KG from ${mov.fromDepartment} to ${mov.toDepartment})`
    );
  }

  // --- NOTIFICATIONS ---
  static async getNotifications(): Promise<AppNotification[]> {
    // 1. Authoritative Cloud Run API Fetch FIRST
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/notifications`, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.notifications)) {
          setLocalStorageItem('mfr_notifications', resData.notifications);
          this.setMemCache('mfr_notifications', resData.notifications);
          return resData.notifications;
        }
      }
    } catch (apiErr) {
      // fallback
    }

    // 2. Direct Firestore Client Fallback
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_notifications'));
        const list: AppNotification[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as AppNotification;
          if (data && data.notificationId) {
            list.push(data);
          }
        });
        const sorted = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setLocalStorageItem('mfr_notifications', sorted);
        this.setMemCache('mfr_notifications', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_notifications');
      }
    }
    return getLocalStorageItem<AppNotification[]>('mfr_notifications', []);
  }

  static async createNotification(notif: Omit<AppNotification, 'notificationId' | 'read' | 'createdAt'>): Promise<AppNotification> {
    const list = await this.getNotifications();
    const newId = `N-${3000 + list.length + 1}`;
    const newNotif: AppNotification = {
      ...notif,
      notificationId: newId,
      read: false,
      createdAt: new Date().toISOString()
    };

    // 1. Update Local Storage offline cache first
    list.unshift(newNotif);
    setLocalStorageItem('mfr_notifications', list);
    this.setMemCache('mfr_notifications', list);

    // 2. Send to backend server endpoint for secure authoritative notification dispatch
    const apiBase = getApiBaseUrl();
    try {
      fetch(`${apiBase}/api/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNotif)
      }).catch(async () => {
        // Direct client fallback ONLY if client is actively authenticated in Firebase Auth
        if (useRealFirebase && db && auth?.currentUser) {
          try {
            await setDoc(doc(db, 'mfr_notifications', newId), sanitizeForFirestore(newNotif));
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `mfr_notifications/${newId}`);
          }
        }
      });
    } catch (_) {
      if (useRealFirebase && db && auth?.currentUser) {
        try {
          await setDoc(doc(db, 'mfr_notifications', newId), sanitizeForFirestore(newNotif));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `mfr_notifications/${newId}`);
        }
      }
    }

    return newNotif;
  }

  static async deleteNotification(id: string): Promise<void> {
    // 1. Update Local Storage offline cache first
    const list = await this.getNotifications();
    const filtered = list.filter(n => n.notificationId !== id);
    setLocalStorageItem('mfr_notifications', filtered);
    this.setMemCache('mfr_notifications', filtered);

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        await deleteDoc(doc(db, 'mfr_notifications', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `mfr_notifications/${id}`);
      }
    }
  }

  static async markNotificationRead(id: string): Promise<void> {
    // 1. Update Local Storage offline cache first
    const list = await this.getNotifications();
    const idx = list.findIndex(n => n.notificationId === id);
    if (idx >= 0) {
      list[idx].read = true;
      setLocalStorageItem('mfr_notifications', list);
      this.setMemCache('mfr_notifications', list);
    }

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        await updateDoc(doc(db, 'mfr_notifications', id), { read: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `mfr_notifications/${id}`);
      }
    }
  }

  static async markAllNotificationsRead(department: Department | 'Admin' | 'All'): Promise<void> {
    // 1. Update Local Storage offline cache first
    const list = await this.getNotifications();
    const updated = list.map(n => {
      if (!n) return n;
      const notifDept = n.department || 'All';
      if (department === 'Admin' || department === 'All' || notifDept === department || notifDept === 'All') {
        return { ...n, read: true };
      }
      return n;
    });
    setLocalStorageItem('mfr_notifications', updated);
    this.setMemCache('mfr_notifications', updated);

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        for (const n of list) {
          if (!n) continue;
          const notifDept = n.department || 'All';
          if ((department === 'Admin' || department === 'All' || notifDept === department || notifDept === 'All') && !n.read) {
            await updateDoc(doc(db, 'mfr_notifications', n.notificationId), { read: true });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'mfr_notifications');
      }
    }
  }

  static async clearAllNotifications(department: Department | 'Admin' | 'All'): Promise<void> {
    // 1. Update Local Storage offline cache first
    const list = await this.getNotifications();
    const remaining = list.filter(n => {
      if (!n) return false;
      if (department === 'Admin' || department === 'All') {
        return false;
      }
      const notifDept = n.department || 'All';
      return notifDept !== department && notifDept !== 'All';
    });
    setLocalStorageItem('mfr_notifications', remaining);
    this.setMemCache('mfr_notifications', remaining);

    // 2. Write to physical Firestore
    if (useRealFirebase && db && auth?.currentUser) {
      try {
        for (const n of list) {
          if (!n) continue;
          const notifDept = n.department || 'All';
          if (department === 'Admin' || department === 'All' || notifDept === department || notifDept === 'All') {
            await deleteDoc(doc(db, 'mfr_notifications', n.notificationId));
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'mfr_notifications');
      }
    }
  }

  // --- AUDIT LOGS ---
  static async getAuditLogs(): Promise<AuditLog[]> {
    // 1. Authoritative Cloud Run API Fetch FIRST
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const headers = await this.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/audit-logs`, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.logs)) {
          setLocalStorageItem('mfr_audit_logs', resData.logs);
          this.setMemCache('mfr_audit_logs', resData.logs);
          return resData.logs;
        }
      }
    } catch (apiErr) {
      // fallback
    }

    // 2. Direct Firestore Client Fallback
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_audit_logs'));
        const list: AuditLog[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as AuditLog;
          if (data && data.id) {
            list.push(data);
          }
        });
        const sorted = list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 500);
        setLocalStorageItem('mfr_audit_logs', sorted);
        this.setMemCache('mfr_audit_logs', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_audit_logs');
      }
    }
    return getLocalStorageItem<AuditLog[]>('mfr_audit_logs', []);
  }

  static async logAction(userId: string, userName: string, action: string, details: string): Promise<void> {
    const logs = await this.getAuditLogs();
    const newId = `AL-${logs.length + 1}-${Date.now()}`;
    const authoritativeUid = (auth && auth.currentUser?.uid) ? auth.currentUser.uid : userId;
    const newLog: AuditLog = {
      id: newId,
      timestamp: new Date().toISOString(),
      userId: authoritativeUid,
      userName,
      action,
      details
    };

    logs.unshift(newLog);
    setLocalStorageItem('mfr_audit_logs', logs.slice(0, 500)); // keep last 500 logs
    this.setMemCache('mfr_audit_logs', logs.slice(0, 500));

    // 1. Post to authoritative backend server endpoint
    const apiBase = getApiBaseUrl();
    try {
      fetch(`${apiBase}/api/audit-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLog)
      }).catch(async () => {
        // 2. Direct client fallback ONLY if client is actively authenticated in Firebase Auth
        if (useRealFirebase && db && auth?.currentUser) {
          try {
            await setDoc(doc(db, 'mfr_audit_logs', newId), sanitizeForFirestore(newLog));
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `mfr_audit_logs/${newId}`);
          }
        }
      });
    } catch (_) {
      if (useRealFirebase && db && auth?.currentUser) {
        try {
          await setDoc(doc(db, 'mfr_audit_logs', newId), sanitizeForFirestore(newLog));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `mfr_audit_logs/${newId}`);
        }
      }
    }

    // 3. Log to Google Sheets asynchronously in background
    logActionToSheets(newLog).catch(err => console.warn('Google Sheets action log failed:', err));
  }

  static async deleteAuditLog(_logId: string, _performerId: string): Promise<void> {
    throw new Error("Audit logs are strictly append-only for enterprise regulatory compliance and cannot be modified or deleted.");
  }

  // --- SAVED ITEMS ---
  static async getSavedItems(): Promise<SavedItem[]> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_items'));
        const list: SavedItem[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as SavedItem;
          if (data && data.id) {
            list.push(data);
          }
        });
        const sorted = list.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
        setLocalStorageItem('mfr_items', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_items');
      }
    }
    return getLocalStorageItem<SavedItem[]>('mfr_items', []);
  }

  static async saveItem(itemName: string, itemCode?: string, partyName?: string): Promise<SavedItem> {
    if (!itemName) throw new Error("Item Name is required");
    const items = await this.getSavedItems();
    const normalizedName = itemName.trim().toLowerCase();
    const safeCode = (itemCode || '-').trim();
    const normalizedCode = safeCode.toLowerCase();
    const safeParty = (partyName || '').trim();
    const normalizedParty = safeParty.toLowerCase();
    
    const existing = items.find(item => 
      item.itemName.trim().toLowerCase() === normalizedName && 
      (item.itemCode || '-').trim().toLowerCase() === normalizedCode &&
      ((item.partyName || item.customerName || '').trim().toLowerCase() === normalizedParty || !normalizedParty)
    );

    if (existing) {
      if (safeParty && !existing.partyName) {
        existing.partyName = safeParty;
        existing.customerName = safeParty;
        setLocalStorageItem('mfr_items', items);
        this.tryPhysicalWrite(
          'Update Saved Item Customer',
          `Update Item ${existing.id} for Customer ${safeParty}`,
          [{ collection: 'mfr_items', docId: existing.id, data: existing, operation: 'set' }],
          async () => { await setDoc(doc(db, 'mfr_items', existing.id), existing); }
        ).catch(e => console.warn(e));
      }
      return existing;
    }

    const newId = `item-${Date.now()}`;
    const newItem: SavedItem = {
      id: newId,
      itemName: itemName.trim(),
      itemCode: safeCode,
      partyName: safeParty || undefined,
      customerName: safeParty || undefined,
      createdAt: new Date().toISOString()
    };

    items.unshift(newItem);
    setLocalStorageItem('mfr_items', items);

    await this.tryPhysicalWrite(
      'Save Item Autocomplete',
      `Save Item Autocomplete: ${itemName} (${itemCode}) [Customer: ${safeParty || 'General'}]`,
      [
        { collection: 'mfr_items', docId: newId, data: newItem, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_items', newId), newItem);
      }
    );

    return newItem;
  }

  static async deleteSavedItem(id: string): Promise<void> {
    const items = await this.getSavedItems();
    const filtered = items.filter(i => i.id !== id);
    setLocalStorageItem('mfr_items', filtered);

    await this.tryPhysicalWrite(
      'Delete Saved Item',
      `Delete Item ${id}`,
      [{ collection: 'mfr_items', docId: id, operation: 'delete' }],
      async () => { await deleteDoc(doc(db, 'mfr_items', id)); }
    );
  }

  // --- SYNC QUEUE MANAGEMENT ---
  private static async tryPhysicalWrite(
    action: string,
    description: string,
    operations: SyncQueueOperation[],
    physicalWriteFn: () => Promise<void>
  ): Promise<void> {
    if (useRealFirebase && db) {
      if (this.isOfflineMode()) {
        setFirestoreOffline(true);
        await this.addToSyncQueue(action, description, operations);
        return;
      }
      try {
        await physicalWriteFn();
      } catch (err: any) {
        handleFirestoreError(err, OperationType.WRITE, operations[0]?.collection || 'unknown');
        
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isOffline = 
          errorMessage.toLowerCase().includes('offline') || 
          errorMessage.toLowerCase().includes('unavailable') ||
          errorMessage.toLowerCase().includes('network') ||
          errorMessage.toLowerCase().includes('could not be reached') ||
          err.code === 'unavailable' ||
          err.code === 'deadline-exceeded';

        if (isOffline) {
          await this.addToSyncQueue(action, description, operations);
        }
      }
    } else {
      if (this.isOfflineMode()) {
        await this.addToSyncQueue(action, description, operations);
      }
    }
  }

  static getSyncQueue(): SyncQueueItem[] {
    return getLocalStorageItem<SyncQueueItem[]>('mfr_sync_queue', []);
  }

  static async addToSyncQueue(action: string, description: string, operations: SyncQueueOperation[]): Promise<void> {
    const queue = this.getSyncQueue();
    // Avoid duplicates of pending identical items
    const isDup = queue.some(item => 
      item.action === action && 
      item.description === description && 
      item.status === 'pending'
    );
    if (isDup) return;

    const currentGen = localStorage.getItem('mfr_system_generation') || sessionStorage.getItem('mfr_system_generation') || '';

    const newItem: SyncQueueItem = {
      id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      generation: currentGen,
      action,
      description,
      timestamp: new Date().toISOString(),
      status: 'pending',
      operations
    };
    queue.push(newItem);
    setLocalStorageItem('mfr_sync_queue', queue);
    window.dispatchEvent(new CustomEvent('sync-queue-updated'));
  }

  static async retrySyncItem(id: string): Promise<boolean> {
    const queue = this.getSyncQueue();
    const idx = queue.findIndex(item => item.id === id);
    if (idx === -1) return false;

    const item = queue[idx];

    // Generation protection: discard stale generation offline operations immediately
    const currentGen = localStorage.getItem('mfr_system_generation') || sessionStorage.getItem('mfr_system_generation') || '';
    if (item.generation && currentGen && item.generation !== currentGen) {
      console.warn(`[SYNC_QUEUE] Dropping operation from stale generation (${item.generation} vs ${currentGen}): ${item.action}`);
      const filtered = queue.filter(q => q.id !== id);
      setLocalStorageItem('mfr_sync_queue', filtered);
      window.dispatchEvent(new CustomEvent('sync-queue-updated'));
      return false;
    }

    item.status = 'pending';
    item.error = undefined;
    setLocalStorageItem('mfr_sync_queue', queue);
    window.dispatchEvent(new CustomEvent('sync-queue-updated'));

    if (useRealFirebase && db) {
      try {
        for (const op of item.operations) {
          if (op.collection === 'mfr_users') {
            // Guard: Never allow queued operations to recreate a deleted/tombstoned user
            const tombDocSnap = await getDoc(doc(db, 'mfr_deleted_users', op.docId)).catch(() => null);
            if (tombDocSnap && tombDocSnap.exists()) {
              continue;
            }
            const userDocSnap = await getDoc(doc(db, 'mfr_users', op.docId)).catch(() => null);
            if (userDocSnap && userDocSnap.exists()) {
              const uData = userDocSnap.data();
              if (uData && (uData.active === false || uData.status === 'deleted' || uData.deletedAt)) {
                continue;
              }
            }
          }
          if (op.collection === 'mfr_job_cards') {
            // Guard: Never allow queued operations to recreate a deleted/tombstoned job card
            const tombDocSnap = await getDoc(doc(db, 'mfr_deleted_job_cards', op.docId)).catch(() => null);
            if (tombDocSnap && tombDocSnap.exists()) {
              continue;
            }
            const localTombs = getLocalStorageItem<string[]>('mfr_deleted_job_cards', []);
            if (localTombs.map(t => t.toLowerCase().trim()).includes(op.docId.toLowerCase().trim())) {
              continue;
            }
            const jcDocSnap = await getDoc(doc(db, 'mfr_job_cards', op.docId)).catch(() => null);
            if (jcDocSnap && jcDocSnap.exists()) {
              const jData = jcDocSnap.data();
              if (jData && (jData.active === false || jData.status === 'deleted' || jData.deletedAt)) {
                continue;
              }
            } else if (op.operation === 'update') {
              // If document was already deleted on server, drop update operation
              continue;
            }
          }
          if (op.operation === 'set') {
            await setDoc(doc(db, op.collection, op.docId), op.data, { merge: true });
          } else if (op.operation === 'update') {
            await updateDoc(doc(db, op.collection, op.docId), op.data);
          } else if (op.operation === 'delete') {
            await deleteDoc(doc(db, op.collection, op.docId));
          }
        }
        const updatedQueue = this.getSyncQueue();
        const updatedIdx = updatedQueue.findIndex(q => q.id === id);
        if (updatedIdx !== -1) {
          updatedQueue[updatedIdx].status = 'synced';
          setLocalStorageItem('mfr_sync_queue', updatedQueue);
        }
        window.dispatchEvent(new CustomEvent('sync-queue-updated'));
        return true;
      } catch (err: any) {
        console.error(`Failed to sync queue item ${id}:`, err);
        const updatedQueue = this.getSyncQueue();
        const updatedIdx = updatedQueue.findIndex(q => q.id === id);
        if (updatedIdx !== -1) {
          updatedQueue[updatedIdx].status = 'failed';
          updatedQueue[updatedIdx].error = err instanceof Error ? err.message : String(err);
          setLocalStorageItem('mfr_sync_queue', updatedQueue);
        }
        window.dispatchEvent(new CustomEvent('sync-queue-updated'));
        return false;
      }
    } else {
      if (navigator.onLine) {
        const updatedQueue = this.getSyncQueue();
        const updatedIdx = updatedQueue.findIndex(q => q.id === id);
        if (updatedIdx !== -1) {
          updatedQueue[updatedIdx].status = 'synced';
          setLocalStorageItem('mfr_sync_queue', updatedQueue);
        }
        window.dispatchEvent(new CustomEvent('sync-queue-updated'));
        return true;
      } else {
        const updatedQueue = this.getSyncQueue();
        const updatedIdx = updatedQueue.findIndex(q => q.id === id);
        if (updatedIdx !== -1) {
          updatedQueue[updatedIdx].status = 'failed';
          updatedQueue[updatedIdx].error = "Still offline (simulated)";
          setLocalStorageItem('mfr_sync_queue', updatedQueue);
        }
        window.dispatchEvent(new CustomEvent('sync-queue-updated'));
        return false;
      }
    }
  }

  static async retryAllSyncItems(): Promise<void> {
    const queue = this.getSyncQueue();
    const pendingAndFailed = queue.filter(item => item.status === 'pending' || item.status === 'failed');
    for (const item of pendingAndFailed) {
      await this.retrySyncItem(item.id);
    }
  }

  static clearSyncQueue(): void {
    const queue = this.getSyncQueue();
    const remaining = queue.filter(item => item.status !== 'synced');
    setLocalStorageItem('mfr_sync_queue', remaining);
    window.dispatchEvent(new CustomEvent('sync-queue-updated'));
  }

  // --- OUTSOURCE ORDERS ---
  static async getOutsourceOrders(): Promise<OutsourceOrder[]> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        const querySnapshot = await getDocs(collection(db, 'mfr_outsource_orders'));
        const list: OutsourceOrder[] = [];
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data() as OutsourceOrder;
          if (data && data.orderId) {
            list.push(data);
          }
        });
        const sorted = list.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());
        setLocalStorageItem('mfr_outsource_orders', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_outsource_orders');
      }
    }
    return getLocalStorageItem<OutsourceOrder[]>('mfr_outsource_orders', []);
  }

  static async createOutsourceOrder(
    orderData: Omit<OutsourceOrder, 'orderId' | 'orderedAt' | 'status' | 'orderedByUserId' | 'orderedByUserName'>,
    userId: string,
    userName: string
  ): Promise<OutsourceOrder> {
    const list = await this.getOutsourceOrders();
    let orderSeq = list.length + 1;
    let orderId = `OUT-${new Date().getFullYear()}-${String(orderSeq).padStart(3, '0')}`;
    while (list.some(o => o.orderId.toUpperCase() === orderId.toUpperCase())) {
      orderSeq++;
      orderId = `OUT-${new Date().getFullYear()}-${String(orderSeq).padStart(3, '0')}`;
    }
    
    const newOrderRaw: OutsourceOrder = {
      ...orderData,
      orderId,
      orderedByUserId: userId,
      orderedByUserName: userName,
      orderedAt: new Date().toISOString(),
      status: 'Assigned',
      reconciliationStatus: 'Pending Receipt',
      remainingPoBalance: orderData.orderQty,
      netAcceptedQty: 0
    };
    const newOrder = sanitizeForFirestore(newOrderRaw);

    list.unshift(newOrder);
    setLocalStorageItem('mfr_outsource_orders', list);

    // Notify assigned person
    await this.createNotification({
      userId: newOrder.assignedToUserId,
      department: 'Purchase',
      title: '📦 New Outsource Order Assigned',
      message: `${userName} (Dispatch) assigned process outsource order ${orderId} (${newOrder.itemName}, ${newOrder.orderQty} ${newOrder.unit}) to you.`
    });

    await this.tryPhysicalWrite(
      'Create Outsource Order',
      `Placed process outsource order ${orderId} assigned to ${newOrder.assignedToUserName}`,
      [
        { collection: 'mfr_outsource_orders', docId: orderId, data: newOrder, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_outsource_orders', orderId), newOrder);
      }
    );

    await this.logAction(
      userId,
      userName,
      'CREATE_OUTSOURCE_ORDER',
      `Dispatch placed outsource order ${orderId} for ${newOrder.itemName} (${newOrder.orderQty} ${newOrder.unit}) assigned to ${newOrder.assignedToUserName}`
    );

    return newOrder;
  }

  static async updateOutsourceOrder(
    orderId: string,
    updates: Partial<OutsourceOrder>,
    userId: string,
    userName: string
  ): Promise<void> {
    const list = await this.getOutsourceOrders();
    const idx = list.findIndex(o => o.orderId === orderId);
    if (idx === -1) throw new Error(`Outsource order ${orderId} not found`);

    const existing = list[idx];

    // Compute cumulative PO reconciliation metrics
    let totalReceived = updates.receivedQty !== undefined ? updates.receivedQty : (existing.receivedQty || 0);
    let totalRejected = updates.rejectionQty !== undefined ? updates.rejectionQty : (existing.rejectionQty || 0);
    let netAccepted = Math.max(0, totalReceived - totalRejected);
    let remainingPoBalance = Math.max(0, existing.orderQty - totalReceived);

    let recStatus: 'Fully Reconciled' | 'Partially Reconciled' | 'Over-Delivered' | 'Pending Receipt' = 'Pending Receipt';
    if (totalReceived <= 0) {
      recStatus = 'Pending Receipt';
    } else if (totalReceived > existing.orderQty) {
      recStatus = 'Over-Delivered';
    } else if (totalReceived >= existing.orderQty) {
      recStatus = 'Fully Reconciled';
    } else {
      recStatus = 'Partially Reconciled';
    }

    let history = existing.poReceiptHistory ? [...existing.poReceiptHistory] : [];
    if (updates.receivedQty !== undefined && updates.receivedQty > (existing.receivedQty || 0)) {
      const addedQty = updates.receivedQty - (existing.receivedQty || 0);
      const addedRej = updates.rejectionQty !== undefined ? (updates.rejectionQty - (existing.rejectionQty || 0)) : 0;
      history.push({
        receivedQty: addedQty,
        rejectionQty: Math.max(0, addedRej),
        netAcceptedQty: Math.max(0, addedQty - Math.max(0, addedRej)),
        challanNo: updates.receivedChallanNo || existing.receivedChallanNo,
        date: new Date().toISOString(),
        remarks: updates.receiptRemarks
      });
    }

    const calculatedUpdates: Partial<OutsourceOrder> = {
      ...updates,
      netAcceptedQty: netAccepted,
      remainingPoBalance,
      reconciliationStatus: recStatus,
      poReceiptHistory: history
    };

    const updated = sanitizeForFirestore({ ...existing, ...calculatedUpdates });
    list[idx] = updated;
    setLocalStorageItem('mfr_outsource_orders', list);

    await this.tryPhysicalWrite(
      'Update Outsource Order',
      `Updated outsource order ${orderId} status to ${updated.status}`,
      [
        { collection: 'mfr_outsource_orders', docId: orderId, data: updated, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_outsource_orders', orderId), updated);
      }
    );

    await this.logAction(
      userId,
      userName,
      'UPDATE_OUTSOURCE_ORDER',
      `Updated outsource order ${orderId}: Status set to '${updated.status}'`
    );
  }

  static async deleteOutsourceOrder(
    orderId: string,
    userId: string,
    userName: string
  ): Promise<void> {
    const list = await this.getOutsourceOrders();
    const filtered = list.filter(o => o.orderId !== orderId);
    setLocalStorageItem('mfr_outsource_orders', filtered);

    await this.tryPhysicalWrite(
      'Delete Outsource Order',
      `Deleted outsource order ${orderId}`,
      [
        { collection: 'mfr_outsource_orders', docId: orderId, operation: 'delete' }
      ],
      async () => {
        await deleteDoc(doc(db, 'mfr_outsource_orders', orderId));
      }
    );

    await this.logAction(
      userId,
      userName,
      'DELETE_OUTSOURCE_ORDER',
      `Deleted outsource order ${orderId}`
    );
  }

  // --- COMPANY CONFIG ---
  static async getCompanyConfig(): Promise<CompanyConfig> {
    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        await this.ensureSeeded();
        const docRef = doc(db, 'mfr_company_config', 'global');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          return snap.data() as CompanyConfig;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'mfr_company_config/global');
      }
    }
    return getLocalStorageItem<CompanyConfig>('mfr_company_config', defaultCompanyConfig);
  }

  static async saveCompanyConfig(config: CompanyConfig, userId: string, userName: string): Promise<void> {
    if (useRealFirebase && db) {
      try {
        await setDoc(doc(db, 'mfr_company_config', 'global'), config);
        await this.logAction(userId, userName, 'UPDATE_COMPANY_CONFIG', `Updated Company details to: ${config.companyName}`);
        return;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'mfr_company_config/global');
      }
    }
    setLocalStorageItem('mfr_company_config', config);
    await this.logAction(userId, userName, 'UPDATE_COMPANY_CONFIG', `Updated Company details to: ${config.companyName}`);
  }

  static async exportDatabaseDump(): Promise<Record<string, any>> {
    const [users, jobCards, movements, notifications, auditLogs, items, companyConfig] = await Promise.all([
      this.getUsers(),
      this.getJobCards(),
      this.getMovements(),
      this.getNotifications(),
      this.getAuditLogs(),
      this.getSavedItems(),
      this.getCompanyConfig()
    ]);
    return {
      users,
      jobCards,
      movements,
      notifications,
      auditLogs,
      items,
      companyConfig,
      exportedAt: new Date().toISOString(),
      version: "1.0.0"
    };
  }

  static async restoreDatabaseDump(dump: Record<string, any>, userId: string, userName: string): Promise<void> {
    if (!dump || typeof dump !== 'object') {
      throw new Error("Invalid backup payload");
    }

    // Restore to local storage caches first
    if (Array.isArray(dump.users)) setLocalStorageItem('mfr_users', dump.users);
    if (Array.isArray(dump.jobCards)) setLocalStorageItem('mfr_job_cards', dump.jobCards);
    if (Array.isArray(dump.movements)) setLocalStorageItem('mfr_movements', dump.movements);
    if (Array.isArray(dump.notifications)) setLocalStorageItem('mfr_notifications', dump.notifications);
    if (Array.isArray(dump.auditLogs)) setLocalStorageItem('mfr_audit_logs', dump.auditLogs);
    if (Array.isArray(dump.items)) setLocalStorageItem('mfr_items', dump.items);
    if (dump.companyConfig) setLocalStorageItem('mfr_company_config', dump.companyConfig);

    // If live firebase is active, we can write them physically to Firestore as well!
    if (useRealFirebase && db) {
      try {
        // Write company config
        if (dump.companyConfig) {
          await setDoc(doc(db, 'mfr_company_config', 'global'), dump.companyConfig);
        }
        // Write users
        if (Array.isArray(dump.users)) {
          for (const u of dump.users) {
            await setDoc(doc(db, 'mfr_users', u.userId), u);
          }
        }
        // Write job cards
        if (Array.isArray(dump.jobCards)) {
          for (const j of dump.jobCards) {
            await setDoc(doc(db, 'mfr_job_cards', j.jobCardNo), j);
          }
        }
        // Write movements
        if (Array.isArray(dump.movements)) {
          for (const m of dump.movements) {
            await setDoc(doc(db, 'mfr_movements', m.movementId), m);
          }
        }
        // Write items
        if (Array.isArray(dump.items)) {
          for (const i of dump.items) {
            await setDoc(doc(db, 'mfr_items', i.id), i);
          }
        }
      } catch (err) {
        console.warn("Could not sync all backup collections to physical Firestore:", err);
      }
    }

    await this.logAction(
      userId,
      userName,
      'RESTORE_DATABASE',
      `Database restored from backup timestamped ${dump.exportedAt || 'unknown'}`
    );
  }

  // --- REAL-TIME SERVER-SENT EVENTS & INSTANT CROSS-USER SYNC ---
  static subscribeToRealtimeEvents(onEvent: (event: any) => void): () => void {
    const baseUrl = getApiBaseUrl();
    const sseUrl = `${baseUrl}/api/events`;
    let es: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isClosed = false;

    const connect = () => {
      if (isClosed) return;
      try {
        es = new EventSource(sseUrl);
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data && data.type && data.type !== 'CONNECTED') {
              onEvent(data);
            }
          } catch (_) {}
        };
        es.onerror = () => {
          if (es) {
            es.close();
            es = null;
          }
          if (!isClosed) {
            reconnectTimeout = setTimeout(connect, 3000);
          }
        };
      } catch (err) {
        if (!isClosed) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return this.registerUnsubscriber(() => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
    });
  }

  static async broadcastEvent(type: string, payload?: any): Promise<void> {
    try {
      const baseUrl = getApiBaseUrl();
      const headers = await this.getAuthHeaders();
      await fetch(`${baseUrl}/api/events/broadcast`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type, payload })
      });
    } catch (_) {}
  }

  // Realtime subscription emulation & Live Firestore triggers
  static subscribeToUpdates(collectionName: string, callback: () => void): () => void {
    let currentFirestoreUnsub: (() => void) | null = null;
    let isDisposed = false;
    let retryTimer: any = null;

    const startListener = () => {
      if (isDisposed) return;
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
        currentFirestoreUnsub = null;
      }

      if (useRealFirebase && db) {
        try {
          currentFirestoreUnsub = onSnapshot(collection(db, collectionName), () => {
            if (isDisposed) return;
            callback();
          }, (err) => {
            if (isDisposed) return;
            console.warn(`[Firestore Watch ${collectionName}] Connection state notice:`, err?.code || err?.message);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              if (!isDisposed) startListener();
            }, 3000);
          });
        } catch (err) {
          console.error(`Failed to register Firestore real-time listener for ${collectionName}:`, err);
        }
      }
    };

    startListener();

    let unsubAuth: (() => void) | null = null;
    if (useRealFirebase && auth) {
      unsubAuth = onAuthStateChanged(auth, (authUser) => {
        if (isDisposed) return;
        if (authUser) {
          startListener();
        }
      });
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === collectionName) {
        callback();
      }
    };
    window.addEventListener('mock-db-update', handler);

    return this.registerUnsubscriber(() => {
      isDisposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
      }
      if (unsubAuth) {
        try { unsubAuth(); } catch (_) {}
      }
      window.removeEventListener('mock-db-update', handler);
    });
  }

  static subscribeJobCardsIncremental(
    onInitial: (jobCards: JobCard[]) => void,
    onChanges: (changes: { type: 'added' | 'modified' | 'removed'; doc: JobCard }[]) => void
  ): () => void {
    let currentFirestoreUnsub: (() => void) | null = null;
    let isDisposed = false;
    let retryTimer: any = null;

    const startListener = () => {
      if (isDisposed) return;
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
        currentFirestoreUnsub = null;
      }

      if (useRealFirebase && db) {
        try {
          let isInitial = true;
          currentFirestoreUnsub = onSnapshot(collection(db, 'mfr_job_cards'), (snapshot) => {
            if (isDisposed) return;
            const localTombs = new Set(getLocalStorageItem<string[]>('mfr_deleted_job_cards', []).map(t => t.toLowerCase().trim()));
            if (isInitial) {
              isInitial = false;
              const all: JobCard[] = [];
              snapshot.forEach(d => {
                const data = d.data() as JobCard;
                if (data && data.jobCardNo) {
                  const jcNo = String(data.jobCardNo).toLowerCase().trim();
                  if (!localTombs.has(jcNo) && (data as any).active !== false && (data as any).status !== 'deleted' && !(data as any).deletedAt) {
                    all.push(data);
                  }
                }
              });
              const sorted = all.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
              onInitial(sorted);
            } else {
              const changes = snapshot.docChanges().map(change => {
                const docData = change.doc.data() as JobCard;
                return {
                  type: change.type as 'added' | 'modified' | 'removed',
                  doc: docData
                };
              }).filter(c => {
                if (!c.doc || !c.doc.jobCardNo) return false;
                const jcNo = String(c.doc.jobCardNo).toLowerCase().trim();
                if (localTombs.has(jcNo)) return false;
                if ((c.doc as any).active === false || (c.doc as any).status === 'deleted' || (c.doc as any).deletedAt) {
                  return false;
                }
                return true;
              });
              if (changes.length > 0) {
                onChanges(changes);
              }
            }
          }, (err) => {
            if (isDisposed) return;
            console.warn("[Firestore Watch mfr_job_cards] Connection state notice:", err?.code || err?.message);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              if (!isDisposed) startListener();
            }, 3000);
          });
        } catch (err) {
          console.error("Failed to register job cards incremental listener:", err);
        }
      }
    };

    startListener();

    let unsubAuth: (() => void) | null = null;
    if (useRealFirebase && auth) {
      unsubAuth = onAuthStateChanged(auth, (authUser) => {
        if (isDisposed) return;
        if (authUser) {
          console.info(`[Auth Lifecycle] Firebase Auth confirmed for UID [${authUser.uid}]. Refreshing Job Cards subscription stream.`);
          startListener();
        }
      });
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === 'mfr_job_cards') {
        this.getJobCards(true).then(onInitial);
      }
    };
    window.addEventListener('mock-db-update', handler);

    return this.registerUnsubscriber(() => {
      isDisposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
      }
      if (unsubAuth) {
        try { unsubAuth(); } catch (_) {}
      }
      window.removeEventListener('mock-db-update', handler);
    });
  }

  static subscribeMovementsIncremental(
    onInitial: (movements: MaterialMovement[]) => void,
    onChanges: (changes: { type: 'added' | 'modified' | 'removed'; doc: MaterialMovement }[]) => void
  ): () => void {
    let currentFirestoreUnsub: (() => void) | null = null;
    let isDisposed = false;
    let retryTimer: any = null;

    const startListener = () => {
      if (isDisposed) return;
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
        currentFirestoreUnsub = null;
      }

      if (useRealFirebase && db) {
        try {
          let isInitial = true;
          currentFirestoreUnsub = onSnapshot(collection(db, 'mfr_movements'), (snapshot) => {
            if (isDisposed) return;
            if (isInitial) {
              isInitial = false;
              const all: MaterialMovement[] = [];
              snapshot.forEach(d => all.push(d.data() as MaterialMovement));
              
              if (process.env.NODE_ENV !== 'production') {
                console.log(`[Firestore Movements Snapshot] Initial load: ${all.length} movements.`);
              }
              onInitial(all);
            } else {
              const changes = snapshot.docChanges().map(change => ({
                type: change.type as 'added' | 'modified' | 'removed',
                doc: change.doc.data() as MaterialMovement
              }));
              if (changes.length > 0) {
                if (process.env.NODE_ENV !== 'production') {
                  console.log(`[Firestore Movements Stream] Received ${changes.length} change(s):`, changes.map(c => ({
                    type: c.type,
                    id: c.doc.movementId,
                    job: c.doc.jobCardNo,
                    from: c.doc.fromDepartment,
                    to: c.doc.toDepartment,
                    accepted: c.doc.accepted
                  })));
                }
                onChanges(changes);
              }
            }
          }, (err) => {
            if (isDisposed) return;
            console.warn("[Firestore Watch mfr_movements] Connection state notice:", err?.code || err?.message);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              if (!isDisposed) startListener();
            }, 3000);
          });
        } catch (err) {
          console.error("Failed to register movements incremental listener:", err);
        }
      }
    };

    startListener();

    let unsubAuth: (() => void) | null = null;
    if (useRealFirebase && auth) {
      unsubAuth = onAuthStateChanged(auth, (authUser) => {
        if (isDisposed) return;
        if (authUser) {
          startListener();
        }
      });
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === 'mfr_movements') {
        this.getMovements(true).then(onInitial);
      }
    };
    window.addEventListener('mock-db-update', handler);

    return this.registerUnsubscriber(() => {
      isDisposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
      }
      if (unsubAuth) {
        try { unsubAuth(); } catch (_) {}
      }
      window.removeEventListener('mock-db-update', handler);
    });
  }

  static getDepartmentIncomingTransfers(department: Department, movementsList?: MaterialMovement[]): MaterialMovement[] {
    const list = movementsList || getLocalStorageItem<MaterialMovement[]>('mfr_movements', []);
    return list.filter(m => {
      // 1. Exclude tombstoned/deleted movements
      if (m.deletedDate || (m as any).status === 'deleted') return false;

      // 2. Special Issue Request from Raw Material Store to Production
      if (m.isIssueRequest && m.fromDepartment === 'Raw Material Store' && m.toDepartment === 'Production') {
        return department === 'Production' && !m.accepted && m.issueStatus === 'Issued';
      }

      // 3. Other pending issue requests belong to Issue Requests tab, not standard Ingress
      if (m.isIssueRequest) {
        return false;
      }

      // 4. Standard Department Incoming Transfer (Authoritative Department Inbox)
      // Belongs strictly to RECEIVING DEPARTMENT, regardless of creator user ID
      return m.toDepartment === department && !m.accepted;
    });
  }

  static subscribeIncomingTransfers(
    toDepartment: Department,
    onInitial: (transfers: MaterialMovement[]) => void,
    onChanges?: (changes: { type: 'added' | 'modified' | 'removed'; doc: MaterialMovement }[]) => void
  ): () => void {
    const computeAndNotify = (allMovements: MaterialMovement[]) => {
      const incoming = this.getDepartmentIncomingTransfers(toDepartment, allMovements);
      onInitial(incoming);
    };

    return this.subscribeMovementsIncremental(
      (allMovements) => computeAndNotify(allMovements),
      (changes) => {
        if (onChanges) {
          const relevantChanges = changes.filter(c => 
            c.doc.toDepartment === toDepartment || 
            (c.doc.isIssueRequest && c.doc.fromDepartment === 'Raw Material Store' && toDepartment === 'Production')
          );
          if (relevantChanges.length > 0) {
            onChanges(relevantChanges);
          }
        }
        this.getMovements(true).then(all => computeAndNotify(all));
      }
    );
  }

  static subscribeDepartmentIncomingTransfers(
    department: Department,
    onUpdate: (transfers: MaterialMovement[]) => void
  ): () => void {
    return this.subscribeIncomingTransfers(department, onUpdate);
  }

  static subscribeAuditLogsIncremental(
    onInitial: (logs: AuditLog[]) => void,
    onChanges: (changes: { type: 'added' | 'modified' | 'removed'; doc: AuditLog }[]) => void
  ): () => void {
    let currentFirestoreUnsub: (() => void) | null = null;
    let isDisposed = false;
    let retryTimer: any = null;

    const startListener = () => {
      if (isDisposed) return;
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
        currentFirestoreUnsub = null;
      }

      if (useRealFirebase && db) {
        try {
          let isInitial = true;
          currentFirestoreUnsub = onSnapshot(collection(db, 'mfr_audit_logs'), (snapshot) => {
            if (isDisposed) return;
            if (isInitial) {
              isInitial = false;
              const all: AuditLog[] = [];
              snapshot.forEach(d => all.push(d.data() as AuditLog));
              onInitial(all);
            } else {
              const changes = snapshot.docChanges().map(change => ({
                type: change.type as 'added' | 'modified' | 'removed',
                doc: change.doc.data() as AuditLog
              }));
              if (changes.length > 0) {
                onChanges(changes);
              }
            }
          }, (err) => {
            if (isDisposed) return;
            console.warn("[Firestore Watch mfr_audit_logs] Connection state notice:", err?.code || err?.message);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              if (!isDisposed) startListener();
            }, 3000);
          });
        } catch (err) {
          console.error("Failed to register audit logs incremental listener:", err);
        }
      }
    };

    startListener();

    let unsubAuth: (() => void) | null = null;
    if (useRealFirebase && auth) {
      unsubAuth = onAuthStateChanged(auth, (authUser) => {
        if (isDisposed) return;
        if (authUser) {
          startListener();
        }
      });
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === 'mfr_audit_logs') {
        this.getAuditLogs().then(onInitial);
      }
    };
    window.addEventListener('mock-db-update', handler);

    return this.registerUnsubscriber(() => {
      isDisposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
      }
      if (unsubAuth) {
        try { unsubAuth(); } catch (_) {}
      }
      window.removeEventListener('mock-db-update', handler);
    });
  }

  static subscribeProcessTransfersIncremental(
    onInitial: (transfers: ProcessTransfer[]) => void,
    onChanges: (changes: { type: 'added' | 'modified' | 'removed'; doc: ProcessTransfer }[]) => void
  ): () => void {
    let currentFirestoreUnsub: (() => void) | null = null;
    let isDisposed = false;
    let retryTimer: any = null;

    const startListener = () => {
      if (isDisposed) return;
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
        currentFirestoreUnsub = null;
      }

      if (useRealFirebase && db) {
        try {
          let isInitial = true;
          currentFirestoreUnsub = onSnapshot(collection(db, 'mfr_process_transfers'), (snapshot) => {
            if (isDisposed) return;
            if (isInitial) {
              isInitial = false;
              const all: ProcessTransfer[] = [];
              snapshot.forEach(d => all.push(d.data() as ProcessTransfer));
              onInitial(all);
            } else {
              const changes = snapshot.docChanges().map(change => ({
                type: change.type as 'added' | 'modified' | 'removed',
                doc: change.doc.data() as ProcessTransfer
              }));
              if (changes.length > 0) {
                onChanges(changes);
              }
            }
          }, (err) => {
            if (isDisposed) return;
            console.warn("[Firestore Watch mfr_process_transfers] Connection state notice:", err?.code || err?.message);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              if (!isDisposed) startListener();
            }, 3000);
          });
        } catch (err) {
          console.error("Failed to register process transfers incremental listener:", err);
        }
      }
    };

    startListener();

    let unsubAuth: (() => void) | null = null;
    if (useRealFirebase && auth) {
      unsubAuth = onAuthStateChanged(auth, (authUser) => {
        if (isDisposed) return;
        if (authUser) {
          startListener();
        }
      });
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === 'mfr_process_transfers') {
        this.getProcessTransfers().then(onInitial);
      }
    };
    window.addEventListener('mock-db-update', handler);

    return this.registerUnsubscriber(() => {
      isDisposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentFirestoreUnsub) {
        try { currentFirestoreUnsub(); } catch (_) {}
      }
      if (unsubAuth) {
        try { unsubAuth(); } catch (_) {}
      }
      window.removeEventListener('mock-db-update', handler);
    });
  }

  // ==========================================================
  // STORE PROCESS TRANSFERS (REPACKING & REPLATING WORKFLOWS)
  // ==========================================================

  static async getProcessTransfers(): Promise<ProcessTransfer[]> {
    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        const q = query(collection(db, 'mfr_process_transfers'), orderBy('createdAt', 'desc'));
        const snap = await withTimeout(getDocs(q), 4000);
        const list: ProcessTransfer[] = [];
        snap.forEach(d => list.push(d.data() as ProcessTransfer));
        setLocalStorageItem('mfr_process_transfers', list);
        return list;
      } catch (err) {
        console.warn("Falling back to local storage cache for process transfers:", err);
        handleFirestoreError(err, OperationType.LIST, 'mfr_process_transfers');
      }
    }
    return getLocalStorageItem<ProcessTransfer[]>('mfr_process_transfers', []);
  }

  static async createProcessTransfer(
    transfer: Omit<ProcessTransfer, 'transferId' | 'transferNo' | 'status' | 'transferDate' | 'transferTime' | 'createdAt' | 'updatedAt'> & { idempotencyKey?: string },
    userId: string,
    userName: string
  ): Promise<ProcessTransfer> {
    if (transfer.quantity <= 0) {
      throw new Error(`Invalid process transfer quantity: ${transfer.quantity}. Quantity must be greater than 0.`);
    }
    if (!transfer.toProcess || (transfer.toProcess !== 'Repacking' && transfer.toProcess !== 'Replating')) {
      throw new Error("Process destination is mandatory. Must select either 'Repacking' or 'Replating'.");
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const nowIso = now.toISOString();

    const existingTransfers = await this.getProcessTransfers();

    // Check duplicate idempotency
    if (transfer.idempotencyKey) {
      const dup = existingTransfers.find(t => t.idempotencyKey === transfer.idempotencyKey);
      if (dup) {
        console.warn(`Duplicate submission suppressed for idempotencyKey: ${transfer.idempotencyKey}`);
        return dup;
      }
    }

    // Generate unique sequential reference number: STP-000001, STP-000002...
    let nextNum = 1;
    existingTransfers.forEach(t => {
      if (t.transferNo && t.transferNo.startsWith('STP-')) {
        const numPart = parseInt(t.transferNo.replace('STP-', ''), 10);
        if (!isNaN(numPart) && numPart >= nextNum) {
          nextNum = numPart + 1;
        }
      }
    });

    const newTransferNo = `STP-${String(nextNum).padStart(6, '0')}`;
    const transferId = `STP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const initialStatus = transfer.toProcess === 'Repacking' ? 'Sent to Repacking' : 'Sent to Replating';

    const newRecord: ProcessTransfer = {
      ...transfer,
      transferId,
      transferNo: newTransferNo,
      status: initialStatus,
      fromLocation: 'Store',
      transferDate: dateStr,
      transferTime: timeStr,
      createdBy: userName || 'Store User',
      createdByUserId: userId || 'store_user',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // 1. Save to local storage first for offline / responsive instant UI
    existingTransfers.unshift(newRecord);
    setLocalStorageItem('mfr_process_transfers', existingTransfers);

    // 2. Add to Audit Log
    await this.logAction(
      userId,
      userName,
      `Send to ${transfer.toProcess} (${newTransferNo})`,
      `Store sent ${transfer.quantity.toLocaleString()} ${transfer.unit} of ${transfer.itemName} to ${transfer.toProcess} under ${newTransferNo}. Remarks: ${transfer.remarks || '-'}`
    );

    // 3. Create Department Notification
    const targetDept = transfer.toProcess === 'Repacking' ? 'Packing' : 'Plating';
    await this.createNotification({
      department: targetDept,
      title: `Store Transfer: ${transfer.toProcess}`,
      message: `${newTransferNo}: Store sent ${transfer.quantity.toLocaleString()} ${transfer.unit} of ${transfer.itemName} (Job Card: ${transfer.jobCardNo}) for ${transfer.toProcess}.`,
      userId: `all_${targetDept.toLowerCase()}`
    });

    // 4. Atomic Firestore write with Transaction
    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        await runTransaction(db, async (transaction) => {
          const docRef = doc(db, 'mfr_process_transfers', transferId);
          transaction.set(docRef, sanitizeForFirestore(newRecord));
        });
      } catch (err) {
        console.warn("Firestore transaction failed for process transfer, queued locally:", err);
        handleFirestoreError(err, OperationType.WRITE, 'mfr_process_transfers');
      }
    }

    return newRecord;
  }

  static async receiveProcessTransfer(
    transferId: string,
    userId: string,
    userName: string,
    remarks?: string
  ): Promise<ProcessTransfer> {
    const list = await this.getProcessTransfers();
    const idx = list.findIndex(t => t.transferId === transferId || t.transferNo === transferId);
    if (idx === -1) throw new Error(`Process Transfer ${transferId} not found`);

    const transfer = list[idx];
    const nowIso = new Date().toISOString();
    const newStatus = transfer.toProcess === 'Repacking' ? 'Received at Repacking' : 'Received at Replating';

    const updated: ProcessTransfer = {
      ...transfer,
      status: newStatus,
      receivedBy: userName,
      receivedByUserId: userId,
      receivedAt: nowIso,
      remarks: remarks ? `${transfer.remarks ? transfer.remarks + ' | ' : ''}Received: ${remarks}` : transfer.remarks,
      updatedAt: nowIso
    };

    list[idx] = updated;
    setLocalStorageItem('mfr_process_transfers', list);

    // Audit Log
    await this.logAction(
      userId,
      userName,
      `Received at ${transfer.toProcess} (${transfer.transferNo})`,
      `${userName} confirmed receipt of ${transfer.quantity.toLocaleString()} ${transfer.unit} at ${transfer.toProcess} under ${transfer.transferNo}.`
    );

    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'mfr_process_transfers', transfer.transferId), sanitizeForFirestore(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'mfr_process_transfers');
      }
    }

    return updated;
  }

  static async startProcessTransfer(
    transferId: string,
    userId: string,
    userName: string,
    remarks?: string
  ): Promise<ProcessTransfer> {
    const list = await this.getProcessTransfers();
    const idx = list.findIndex(t => t.transferId === transferId || t.transferNo === transferId);
    if (idx === -1) throw new Error(`Process Transfer ${transferId} not found`);

    const transfer = list[idx];
    const nowIso = new Date().toISOString();
    const newStatus = transfer.toProcess === 'Repacking' ? 'Repacking in Process' : 'Replating in Process';

    const updated: ProcessTransfer = {
      ...transfer,
      status: newStatus,
      inProcessBy: userName,
      inProcessByUserId: userId,
      inProcessAt: nowIso,
      remarks: remarks ? `${transfer.remarks ? transfer.remarks + ' | ' : ''}In-Process: ${remarks}` : transfer.remarks,
      updatedAt: nowIso
    };

    list[idx] = updated;
    setLocalStorageItem('mfr_process_transfers', list);

    // Audit Log
    await this.logAction(
      userId,
      userName,
      `${transfer.toProcess} in Process (${transfer.transferNo})`,
      `${userName} started ${transfer.toProcess} on ${transfer.quantity.toLocaleString()} ${transfer.unit} for ${transfer.transferNo}.`
    );

    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'mfr_process_transfers', transfer.transferId), sanitizeForFirestore(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'mfr_process_transfers');
      }
    }

    return updated;
  }

  static async completeAndReturnProcessTransfer(
    transferId: string,
    completedQty: number,
    rejectionQty: number,
    rejectionReason: string,
    returnBin: string,
    returnRack: string,
    userId: string,
    userName: string,
    remarks?: string
  ): Promise<ProcessTransfer> {
    const list = await this.getProcessTransfers();
    const idx = list.findIndex(t => t.transferId === transferId || t.transferNo === transferId);
    if (idx === -1) throw new Error(`Process Transfer ${transferId} not found`);

    const transfer = list[idx];
    const nowIso = new Date().toISOString();

    const updated: ProcessTransfer = {
      ...transfer,
      status: 'Returned to Store',
      completedBy: userName,
      completedByUserId: userId,
      completedAt: nowIso,
      completedQty,
      rejectionQty,
      rejectionReason: rejectionReason || undefined,
      returnedBy: userName,
      returnedByUserId: userId,
      returnedAt: nowIso,
      returnedQty: completedQty,
      returnLocationBin: returnBin || undefined,
      returnRackNo: returnRack || undefined,
      remarks: remarks ? `${transfer.remarks ? transfer.remarks + ' | ' : ''}Completed & Returned: ${remarks}` : transfer.remarks,
      updatedAt: nowIso
    };

    list[idx] = updated;
    setLocalStorageItem('mfr_process_transfers', list);

    // Audit Log
    await this.logAction(
      userId,
      userName,
      `Process Completed & Returned to Store (${transfer.transferNo})`,
      `${userName} completed ${transfer.toProcess} for ${transfer.transferNo} and returned ${completedQty.toLocaleString()} ${transfer.unit} (Rejections: ${rejectionQty.toLocaleString()}) to Store (Bin: ${returnBin || '-'}, Rack: ${returnRack || '-'}).`
    );

    // Notify Store
    await this.createNotification({
      department: 'Store',
      title: `${transfer.toProcess} Returned to Store`,
      message: `${transfer.transferNo}: ${completedQty.toLocaleString()} ${transfer.unit} of ${transfer.itemName} completed ${transfer.toProcess} and returned to Store.`,
      userId: 'all_store'
    });

    if (useRealFirebase && db && !this.isOfflineMode() && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'mfr_process_transfers', transfer.transferId), sanitizeForFirestore(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'mfr_process_transfers');
      }
    }

    return updated;
  }
}

