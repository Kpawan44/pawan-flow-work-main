import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
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
  limit 
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { UserProfile, JobCard, MaterialMovement, AppNotification, AuditLog, Department, CompanyConfig, JobCardStatus, SavedItem, SyncQueueItem, SyncQueueOperation, OutsourceOrder } from '../types';
import { 
  logJobCardToSheets, 
  logDepartmentUpdateToSheets, 
  logMaterialMovementToSheets, 
  logActionToSheets 
} from './googleSheets';

// Let's check if the configuration consists of placeholders
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

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: isPlaceholder ? 'mock-user' : getAuth().currentUser?.uid,
      email: isPlaceholder ? 'pawan.kummar16@gmail.com' : getAuth().currentUser?.email,
      emailVerified: true,
      isAnonymous: false,
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
    const dbId = (firebaseConfig as any).firestoreDatabaseId || '(default)';
    try {
      dbInstance = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      }, dbId);
      console.log(`Real Firebase and Firestore persistent local cache initialized successfully for database: ${dbId}!`);
    } catch (cacheError) {
      console.warn(`Failed to initialize Firestore persistent cache, using fallback initializeFirestore for database ${dbId}:`, cacheError);
      try {
        dbInstance = initializeFirestore(app, {
          experimentalForceLongPolling: true
        }, dbId);
      } catch (fallbackError) {
        console.error("Firestore initialization fallback failed completely:", fallbackError);
        dbInstance = getFirestore(app, dbId);
      }
    }
    authInstance = getAuth(app);
    useRealFirebase = true;
    console.log("Real Firebase initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize real Firebase:", error);
  }
} else {
  console.log("Starting app in HIGH-FIDELITY LOCAL STORAGE EMULATION mode (Real Firebase disabled).");
}

export { useRealFirebase };
export const db = dbInstance;
export const auth = authInstance;

// ============================================
// MOCK STATE AND REALTIME STREAM DATABASE
// ============================================

// Standard initial seed data for demonstration
const defaultUsers: UserProfile[] = [
  {
    userId: 'u-1',
    name: 'Pawan Kumar',
    email: 'pawan.kummar16@gmail.com',
    pin: '1234',
    department: 'Admin',
    role: 'super_admin',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-2',
    name: 'Alice Dispatcher',
    email: 'dispatch@factory.com',
    pin: '2222',
    department: 'Dispatch',
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-3',
    name: 'Bob Production',
    email: 'production@factory.com',
    pin: '3333',
    department: 'Production',
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-4',
    name: 'Charlie HeatTreat',
    email: 'heattreat@factory.com',
    pin: '4444',
    department: 'Heat Treatment',
    role: 'staff',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-5',
    name: 'David Plater',
    email: 'plating@factory.com',
    pin: '5555',
    department: 'Plating',
    role: 'staff',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-6',
    name: 'Emma Packer',
    email: 'packing@factory.com',
    pin: '6666',
    department: 'Packing',
    role: 'staff',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-7',
    name: 'Frank Storekeeper',
    email: 'store@factory.com',
    pin: '7777',
    department: 'Store',
    role: 'staff',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    userId: 'u-8',
    name: 'George RawStore',
    email: 'rawstore@factory.com',
    pin: '8888',
    department: 'Raw Material Store',
    role: 'staff',
    active: true,
    createdAt: new Date().toISOString()
  }
];

const defaultSavedItems: SavedItem[] = [
  {
    id: 'item-1',
    itemName: 'Grade 8 High-Tensile Bolt M12',
    itemCode: 'BOLT-M12-G8',
    createdAt: new Date().toISOString()
  },
  {
    id: 'item-2',
    itemName: 'Engine Valve Gear Shaft',
    itemCode: 'SHAFT-EVG-102',
    createdAt: new Date().toISOString()
  },
  {
    id: 'item-3',
    itemName: 'Industrial Galvanized Washer',
    itemCode: 'WASH-GALV-50',
    createdAt: new Date().toISOString()
  }
];

const defaultJobCards: JobCard[] = [
  {
    jobCardNo: 'JC-1001',
    orderNo: 'ORD-5001',
    partyName: 'Apex Engineering Solutions',
    itemName: 'Grade 8 High-Tensile Bolt M12',
    itemCode: 'BOLT-M12-G8',
    orderQty: 1200,
    currentQty: 1200,
    balanceQty: 1200,
    currentDepartment: 'Production',
    status: 'Pending',
    heatTreatmentRequired: true,
    createdBy: 'Pawan Kumar',
    createdAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString(), // 3 days ago
    completed: false
  },
  {
    jobCardNo: 'JC-1002',
    orderNo: 'ORD-5002',
    partyName: 'Precision Automotive Parts',
    itemName: 'Engine Valve Gear Shaft',
    itemCode: 'SHAFT-EVG-102',
    orderQty: 500,
    currentQty: 450,
    balanceQty: 50,
    currentDepartment: 'Heat Treatment',
    status: 'In Process',
    heatTreatmentRequired: true,
    createdBy: 'Pawan Kumar',
    createdAt: new Date(Date.now() - 3600000 * 24 * 1.5).toISOString(),
    completed: false
  },
  {
    jobCardNo: 'JC-1003',
    orderNo: 'ORD-5003',
    partyName: 'Alpha Heavy Industries',
    itemName: 'Industrial Galvanized Washer',
    itemCode: 'WASH-GALV-50',
    orderQty: 3000,
    currentQty: 3000,
    balanceQty: 0,
    currentDepartment: 'Completed',
    status: 'Completed',
    heatTreatmentRequired: false,
    createdBy: 'Alice Dispatcher',
    createdAt: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
    completed: true,
    dispatchDetails: {
      invoiceNo: 'INV-2026-001',
      vehicleNo: 'MH-12-PQ-9876',
      dispatchQty: 3000,
      dispatchDate: new Date(Date.now() - 3600000 * 4).toISOString(),
      remarks: 'Delivered in perfect condition. Inspection sign-off completed.'
    }
  }
];

const defaultMovements: MaterialMovement[] = [
  {
    movementId: 'M-2000',
    jobCardNo: 'JC-1001',
    fromDepartment: 'Dispatch',
    toDepartment: 'Production',
    quantity: 1200,
    transferBy: 'Alice Dispatcher',
    transferDate: new Date(Date.now() - 3600000 * 24 * 3.1).toISOString(),
    accepted: true,
    acceptedBy: 'Bob Production',
    acceptedDate: new Date(Date.now() - 3600000 * 24 * 3.0).toISOString(),
    remarks: 'Initial raw material dispatch'
  },
  {
    movementId: 'M-2001',
    jobCardNo: 'JC-1002',
    fromDepartment: 'Dispatch',
    toDepartment: 'Production',
    quantity: 500,
    transferBy: 'Alice Dispatcher',
    transferDate: new Date(Date.now() - 3600000 * 24 * 1.4).toISOString(),
    accepted: true,
    acceptedBy: 'Bob Production',
    acceptedDate: new Date(Date.now() - 3600000 * 24 * 1.3).toISOString(),
    remarks: 'Dispatched raw material bars'
  },
  {
    movementId: 'M-2002',
    jobCardNo: 'JC-1002',
    fromDepartment: 'Production',
    toDepartment: 'Heat Treatment',
    quantity: 450,
    transferBy: 'Bob Production',
    transferDate: new Date(Date.now() - 3600000 * 24 * 1.1).toISOString(),
    accepted: true,
    acceptedBy: 'Charlie HeatTreat',
    acceptedDate: new Date(Date.now() - 3600000 * 24 * 1.0).toISOString(),
    remarks: 'Produced with 50 KG scrap loss due to edge trimming.',
    processDetails: {
      operatorName: 'Suresh Patil'
    }
  }
];

const defaultNotifications: AppNotification[] = [];

const defaultAuditLogs: AuditLog[] = [
  {
    id: 'AL-1',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    userId: 'u-1',
    userName: 'Pawan Kumar',
    action: 'USER_LOGIN',
    details: 'Logged into Admin Dashboard'
  },
  {
    id: 'AL-2',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    userId: 'u-2',
    userName: 'Alice Dispatcher',
    action: 'CREATE_JOB_CARD',
    details: 'Created Job Card JC-1001 with quantity 1200 KG'
  }
];

const defaultOutsourceOrders: OutsourceOrder[] = [
  {
    orderId: 'OUT-2026-001',
    partyName: 'Global Heavy Industries',
    itemName: 'Precision Plated Spacer Sleeve',
    itemCode: 'MFR-LOAD-101',
    orderQty: 800,
    unit: 'PCS',
    processType: 'External Heat Treatment',
    outsourceMaterialType: 'Semi Finished Goods',
    orderedByUserId: 'u-2',
    orderedByUserName: 'Alice Dispatcher',
    orderedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    assignedToUserId: 'u-1',
    assignedToUserName: 'Pawan Kumar',
    status: 'Supplier PO Placed',
    supplierName: 'Apex Vacuum Heat Treaters',
    supplierPoNo: 'PO-OUT-9102',
    supplierRate: 42.50,
    poDate: new Date(Date.now() - 3600000 * 36).toISOString(),
    estimatedDelivery: new Date(Date.now() - 3600000 * 24 * 3).toISOString().slice(0, 10), // 3 days ago -> OVERDUE
    poRemarks: 'Vacuum hardening spec required. Overdue for delivery.',
    dispatchRemarks: 'High priority external vacuum heat treatment required.'
  },
  {
    orderId: 'OUT-2026-002',
    partyName: 'Bharat Auto Components',
    itemName: 'Hardened Transmission Flange',
    itemCode: 'BAC-FLG-402',
    orderQty: 350,
    unit: 'KGS',
    processType: 'Precision Plating & Coating',
    outsourceMaterialType: 'Finished Goods',
    orderedByUserId: 'u-2',
    orderedByUserName: 'Alice Dispatcher',
    orderedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    assignedToUserId: 'u-1',
    assignedToUserName: 'Pawan Kumar',
    status: 'Supplier PO Placed',
    supplierName: 'Supreme Zinc Platers Ltd',
    supplierPoNo: 'PO-OUT-9105',
    supplierRate: 65.00,
    poDate: new Date(Date.now() - 3600000 * 18).toISOString(),
    estimatedDelivery: new Date().toISOString().slice(0, 10), // Today!
    poRemarks: 'Zinc-nickel anti-corrosion coating.',
    dispatchRemarks: 'Deliver directly to finished goods store upon receipt.'
  },
  {
    orderId: 'OUT-2026-003',
    partyName: 'Mahindra Heavy Gear Corp',
    itemName: 'CNC Threaded Pinion Shaft',
    itemCode: 'MHG-PIN-088',
    orderQty: 500,
    unit: 'PCS',
    processType: 'CNC Threading & Grinding',
    outsourceMaterialType: 'Semi Finished Goods',
    orderedByUserId: 'u-2',
    orderedByUserName: 'Alice Dispatcher',
    orderedAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    assignedToUserId: 'u-1',
    assignedToUserName: 'Pawan Kumar',
    status: 'Material Received',
    supplierName: 'Micro-Turn CNC Works',
    supplierPoNo: 'PO-OUT-9088',
    supplierRate: 110.00,
    poDate: new Date(Date.now() - 3600000 * 60).toISOString(),
    estimatedDelivery: new Date(Date.now() - 3600000 * 12).toISOString().slice(0, 10),
    receivedQty: 500,
    receivedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    receivedChallanNo: 'CH-9088-A',
    receivedMaterialType: 'Semi Finished Goods',
    receiptRemarks: '100% thread gauge verified. Passed quality control.'
  },
  {
    orderId: 'OUT-2026-004',
    partyName: 'Tata Precision Systems',
    itemName: 'Cast Iron Braking Hub',
    itemCode: 'TPS-HUB-109',
    orderQty: 1200,
    unit: 'KGS',
    processType: 'Braking & Bending',
    outsourceMaterialType: 'Semi Finished Goods',
    orderedByUserId: 'u-2',
    orderedByUserName: 'Alice Dispatcher',
    orderedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    assignedToUserId: 'u-1',
    assignedToUserName: 'Pawan Kumar',
    status: 'Assigned',
    dispatchRemarks: 'Brake pressing required as per drawing rev 4.'
  }
];

const defaultCompanyConfig: CompanyConfig = {
  companyName: 'Precision Metal Works',
  details: 'Specialists in high-tensile fasteners, engine components, and industrial finishes.',
  phone: '+91 98765 43210',
  address: 'Shed No. 12, Phase II, Industrial Area, Pune, MH, India',
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
  localStorage.setItem(key, JSON.stringify(value));
  // Emit state change event for active onSnapshot listeners
  window.dispatchEvent(new CustomEvent('mock-db-update', { detail: { collection: key } }));
}

// Unified API for direct retrieval (works for both modes, defaulting to local persistence during preview)
export class DBService {
  private static seedingPromise: Promise<void> | null = null;

  static isOfflineMode(): boolean {
    return !navigator.onLine || isFirestoreOffline || localStorage.getItem('mfr_force_offline') === 'true';
  }

  static setOnline(): void {
    setFirestoreOffline(false);
  }

  static async ensureSeeded(): Promise<void> {
    if (!useRealFirebase || !db || this.isOfflineMode()) return;
    if (this.seedingPromise) return this.seedingPromise;

    this.seedingPromise = (async () => {
      try {
        const seededRef = doc(db, 'mfr_company_config', 'seeded');
        const snap = await withTimeout(getDoc(seededRef), 3500);
        if (snap.exists()) {
          return;
        }

        console.log("Database 'seeded' marker not found. Running one-time collection seeding...");
        
        // 1. Users
        const usersSnap = await getDocs(collection(db, 'mfr_users'));
        if (usersSnap.empty) {
          console.log("One-time seed: mfr_users");
          for (const u of defaultUsers) {
            await setDoc(doc(db, 'mfr_users', u.userId), u);
          }
        }

        // 2. Job Cards
        const jobsSnap = await getDocs(collection(db, 'mfr_job_cards'));
        if (jobsSnap.empty) {
          console.log("One-time seed: mfr_job_cards");
          for (const jc of defaultJobCards) {
            await setDoc(doc(db, 'mfr_job_cards', jc.jobCardNo), jc);
          }
        }

        // 3. Movements
        const movementsSnap = await getDocs(collection(db, 'mfr_movements'));
        if (movementsSnap.empty) {
          console.log("One-time seed: mfr_movements");
          for (const m of defaultMovements) {
            await setDoc(doc(db, 'mfr_movements', m.movementId), m);
          }
        }

        // 4. Notifications
        const notificationsSnap = await getDocs(collection(db, 'mfr_notifications'));
        if (notificationsSnap.empty) {
          console.log("One-time seed: mfr_notifications");
          for (const n of defaultNotifications) {
            await setDoc(doc(db, 'mfr_notifications', n.notificationId), n);
          }
        }

        // 5. Audit logs
        const auditLogsSnap = await getDocs(collection(db, 'mfr_audit_logs'));
        if (auditLogsSnap.empty) {
          console.log("One-time seed: mfr_audit_logs");
          for (const l of defaultAuditLogs) {
            await setDoc(doc(db, 'mfr_audit_logs', l.id), l);
          }
        }

        // 5.5. Saved Items
        const itemsSnap = await getDocs(collection(db, 'mfr_items'));
        if (itemsSnap.empty) {
          console.log("One-time seed: mfr_items");
          for (const item of defaultSavedItems) {
            await setDoc(doc(db, 'mfr_items', item.id), item);
          }
        }

        // 6. Global Company Config
        const globalRef = doc(db, 'mfr_company_config', 'global');
        const globalSnap = await getDoc(globalRef);
        if (!globalSnap.exists()) {
          console.log("One-time seed: mfr_company_config/global");
          await setDoc(globalRef, defaultCompanyConfig);
        }

        // Write the 'seeded' flag
        await setDoc(seededRef, { companyName: 'SystemSeeded', details: 'Initialized' } as CompanyConfig);
        console.log("Seeding process completed cleanly.");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isOffline = 
          errMsg.includes('offline') || 
          errMsg.includes('Failed to get document because the client is offline') || 
          errMsg.includes('unavailable') ||
          errMsg.includes('could not be reached') ||
          errMsg.includes('network');
          
        if (isOffline) {
          console.info("[Offline Mode] Firestore seeding deferred. High-fidelity pre-seeded data is active in local storage fallback.");
        } else {
          console.warn("Seeding process bypassed or deferred due to network/permissions:", err);
        }
      }
    })();

    return this.seedingPromise;
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
  static async getUsers(): Promise<UserProfile[]> {
    let usersList: UserProfile[] = [];
    let fetchedFromFirebase = false;

    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_users'));
        querySnapshot.forEach((docSnap) => {
          usersList.push(docSnap.data() as UserProfile);
        });
        fetchedFromFirebase = true;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_users');
      }
    }

    if (!fetchedFromFirebase || usersList.length === 0) {
      usersList = getLocalStorageItem<UserProfile[]>('mfr_users', defaultUsers);
    }

    // Ensure Pawan Kumar is super_admin with PIN '1234'
    let pawan = usersList.find(u => u.name.trim().toLowerCase() === 'pawan kumar');
    let dirty = false;

    if (!pawan) {
      pawan = {
        userId: 'u-1',
        name: 'Pawan Kumar',
        email: 'pawan.kummar16@gmail.com',
        pin: '1234',
        department: 'Admin',
        role: 'super_admin',
        active: true,
        createdAt: new Date().toISOString()
      };
      usersList.push(pawan);
      dirty = true;
    } else {
      if (pawan.role !== 'super_admin' || pawan.pin !== '1234' || !pawan.active || pawan.department !== 'Admin') {
        pawan.role = 'super_admin';
        pawan.pin = '1234';
        pawan.active = true;
        pawan.department = 'Admin';
        dirty = true;
      }
    }

    // Demote any OTHER super_admin
    for (let i = 0; i < usersList.length; i++) {
      const u = usersList[i];
      if (u.name.trim().toLowerCase() !== 'pawan kumar' && u.role === 'super_admin') {
        u.role = 'admin';
        dirty = true;
        // Save demoted user to Firestore if online
        if (useRealFirebase && db && fetchedFromFirebase) {
          try {
            await setDoc(doc(db, 'mfr_users', u.userId), u);
          } catch (err) {
            console.error('Failed to demote non-Pawan super admin in Firestore', err);
          }
        }
      }
    }

    if (dirty) {
      // Save Pawan Kumar to Firestore if online
      if (useRealFirebase && db && fetchedFromFirebase && pawan) {
        try {
          await setDoc(doc(db, 'mfr_users', pawan.userId), pawan);
        } catch (err) {
          console.error('Failed to save Pawan Kumar to Firestore', err);
        }
      }
      // Save the updated list to localStorage
      setLocalStorageItem('mfr_users', usersList);
    }

    return usersList;
  }

  static async saveUser(user: UserProfile): Promise<void> {
    // Prevent anyone else from becoming super_admin
    if (user.role === 'super_admin' && user.name.trim().toLowerCase() !== 'pawan kumar') {
      user.role = 'admin';
    }

    // 1. Update Local Storage offline cache first
    const list = await this.getUsers();

    // Enforce strictly only one super_admin exists in the system
    if (user.role === 'super_admin') {
      for (let i = 0; i < list.length; i++) {
        if (list[i].userId !== user.userId && list[i].role === 'super_admin') {
          list[i].role = 'admin';
          // Also write this demoted user to Firestore
          if (useRealFirebase && db) {
            try {
              await setDoc(doc(db, 'mfr_users', list[i].userId), list[i]);
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, `mfr_users/${list[i].userId}`);
            }
          }
        }
      }
    }

    // Enforce At Most One Department Head (Manager) per department (excluding 'Admin' department / Super Admins)
    if (user.role === 'admin' && user.department !== 'Admin') {
      const otherDeptManager = list.find(u => u.userId !== user.userId && u.role === 'admin' && u.department === user.department);
      if (otherDeptManager) {
        throw new Error(`Only one Department Head is permitted for ${user.department}. '${otherDeptManager.name}' is already registered as manager.`);
      }
    }

    const idx = list.findIndex(u => u.userId === user.userId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...user };
    } else {
      // Check for PIN or Email uniqueness to avoid duplication
      const duplicateIdx = list.findIndex(u => u.pin === user.pin || (u.email && u.email === user.email));
      if (duplicateIdx >= 0) {
        list[duplicateIdx] = { ...list[duplicateIdx], ...user };
      } else {
        list.push(user);
      }
    }
    setLocalStorageItem('mfr_users', list);

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
      try {
        await setDoc(doc(db, 'mfr_users', user.userId), user);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `mfr_users/${user.userId}`);
      }
    }

    await this.logAction(user.userId, user.name, 'UPDATE_USER', `Saved changes for user '${user.name}'`);
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
    const performer = users.find(u => u.userId === performerId);
    if (!performer) {
      throw new Error("Unauthorized: Performing administrator profile not found.");
    }
    if (performer.role !== 'super_admin' && performer.role !== 'admin') {
      throw new Error("Unauthorized: Only Admins or Super Admins are authorized to delete users.");
    }

    const targetUser = users.find(u => u.userId === userId);
    if (targetUser) {
      if (performer.role === 'admin') {
        if (targetUser.department !== performer.department) {
          throw new Error(`Unauthorized: As Department Head of ${performer.department}, you can only delete users within your own department.`);
        }
        if (targetUser.role !== 'staff') {
          throw new Error("Unauthorized: Department heads can only delete staff-level employees under their own department.");
        }
      }
      if (userId === performerId) {
        throw new Error("Unauthorized: You cannot delete your own active user profile.");
      }
    }

    // 1. Write to physical Firestore first
    if (useRealFirebase && db) {
      try {
        await deleteDoc(doc(db, 'mfr_users', userId));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `mfr_users/${userId}`);
        const shouldThrow = err && (
          err.code === 'permission-denied' || 
          err.code === 'invalid-argument' || 
          (err.message && (
            err.message.toLowerCase().includes('permission') || 
            err.message.toLowerCase().includes('denied')
          ))
        );
        if (shouldThrow) {
          throw err;
        }
      }
    }

    // 2. Update Local Storage offline cache second
    const list = await this.getUsers();
    const newList = list.filter(u => u.userId !== userId);
    setLocalStorageItem('mfr_users', newList);

    await this.logAction(performerId, performerName, 'DELETE_USER', `Deleted user account '${operatorName}' (ID: ${userId})`);
  }

  // --- JOB CARDS ---
  static async getJobCards(): Promise<JobCard[]> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_job_cards'));
        const cards: JobCard[] = [];
        querySnapshot.forEach((docSnap) => {
          cards.push(docSnap.data() as JobCard);
        });
        const sorted = cards.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        // Mirror to local cache on successful load
        setLocalStorageItem('mfr_job_cards', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_job_cards');
      }
    }
    return getLocalStorageItem<JobCard[]>('mfr_job_cards', defaultJobCards);
  }

  static async createJobCard(job: Omit<JobCard, 'jobCardNo' | 'orderNo' | 'createdAt' | 'completed' | 'balanceQty'>, creatorId: string, creatorName: string): Promise<JobCard> {
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
    const newNo = currentMaxNo + 1;
    
    const jobCardNo = `${prefix}-${newNo}`;
    const orderNo = isPurchase ? `ORD-PUR-${5000 + (newNo - 1000)}` : `ORD-${5000 + (newNo - 1000)}`;

    const newJob: JobCard = {
      ...job,
      status: job.status || 'Pending Acceptance',
      createdBy: creatorName,
      jobCardNo,
      orderNo,
      balanceQty: job.orderQty, // initially complete orderQty
      createdAt: new Date().toISOString(),
      completed: false
    } as JobCard;

    // 1. Update Local Storage offline cache first
    cards.unshift(newJob);
    setLocalStorageItem('mfr_job_cards', cards);

    // Spawn an initial Material Movement
    const movements = await this.getMovements();
    const newMovementId = `M-${2000 + movements.length + 1}`;
    
    const unitLabel = job.unit || 'KG';
    const initialMovement: MaterialMovement = isPurchase ? {
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
      toDepartment: 'Production',
      quantity: job.orderQty,
      transferBy: creatorName,
      transferDate: new Date().toISOString(),
      accepted: false,
      remarks: 'Order registered. Dispatching raw material and job ticket to Production.'
    };

    movements.unshift(initialMovement);
    setLocalStorageItem('mfr_movements', movements);
    
    // Send notifications to corresponding department
    await this.createNotification({
      department: isPurchase ? 'Store' : 'Production',
      title: isPurchase ? 'New Purchase Inward Receipt' : 'New Production Queue Item',
      message: isPurchase
        ? `New Purchase Inward ${jobCardNo} generated for supplier ${job.partyName}. Quantity: ${job.currentQty} ${unitLabel}. Pending Store acceptance.`
        : `Job Card ${jobCardNo} generated for ${job.partyName}. Quantity: ${job.orderQty} ${unitLabel}. Pending material acceptance.`,
      userId: isPurchase ? 'all_store' : 'all_production'
    });

    // 2. Write to physical Firestore
    await this.tryPhysicalWrite(
      'Create Job Card',
      `Create Job Card ${jobCardNo} for ${job.partyName} (${job.orderQty} ${unitLabel})`,
      [
        { collection: 'mfr_job_cards', docId: jobCardNo, data: newJob, operation: 'set' },
        { collection: 'mfr_movements', docId: newMovementId, data: initialMovement, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_job_cards', jobCardNo), newJob);
        await setDoc(doc(db, 'mfr_movements', newMovementId), initialMovement);
      }
    );

    await this.logAction(creatorId, creatorName, 'CREATE_JOB_CARD', `Generated job card ${jobCardNo} for ${job.partyName} (${job.orderQty} ${unitLabel})`);
    
    // Automatically save item name and code to master list
    try {
      await this.saveItem(job.itemName, job.itemCode);
    } catch (saveErr) {
      console.warn("Failed to automatically save item:", saveErr);
    }

    // Log to Google Sheets
    logJobCardToSheets(newJob).catch(err => console.warn('Google Sheets log failed: ', err));
    logMaterialMovementToSheets(initialMovement).catch(err => console.warn('Google Sheets movement log failed: ', err));

    return newJob;
  }

  static async updateJobCard(jobCardNo: string, updates: Partial<JobCard>, userId: string, userName: string): Promise<void> {
    // 1. Update Local Storage offline cache first
    const cards = await this.getJobCards();
    const idx = cards.findIndex(c => c.jobCardNo.toLowerCase() === jobCardNo.toLowerCase());
    if (idx === -1) {
      console.warn(`Job card ${jobCardNo} not found for update`);
      return;
    }
    
    cards[idx] = { ...cards[idx], ...updates } as JobCard;
    setLocalStorageItem('mfr_job_cards', cards);

    // 2. Write to physical Firestore
    await this.tryPhysicalWrite(
      'Update Job Card',
      `Update Job Card ${jobCardNo} (${updates.status || 'Details'})`,
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

    await this.logAction(userId, userName, 'UPDATE_JOB_CARD', `Updated Job Card ${jobCardNo}. Status: ${updates.status || cards[idx].status}`);
    
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

    // 2. Physical Firestore write
    for (const jobCardNo of jobCardNos) {
      const updates = { status: newStatus, completed: isCompleted };
      await this.tryPhysicalWrite(
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
    }

    await this.logAction(
      userId, 
      userName, 
      'BULK_UPDATE_JOB_STATUS', 
      `Bulk updated ${jobCardNos.length} job cards status to '${newStatus}': [${jobCardNos.join(', ')}]`
    );
  }

  static async deleteJobCard(jobCardNo: string, userId: string, userName: string): Promise<void> {
    await this.verifyAdmin(userId);
    // 1. Write to physical Firestore first
    if (useRealFirebase && db) {
      try {
        const refUpper = doc(db, 'mfr_job_cards', jobCardNo.toUpperCase());
        const snapUpper = await getDoc(refUpper);
        if (snapUpper.exists()) {
          await deleteDoc(refUpper);
        } else {
          const refAsIs = doc(db, 'mfr_job_cards', jobCardNo);
          const snapAsIs = await getDoc(refAsIs);
          if (snapAsIs.exists()) {
            await deleteDoc(refAsIs);
          } else {
            // Default fallback
            await deleteDoc(refUpper);
          }
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
        handleFirestoreError(err, OperationType.DELETE, `mfr_job_cards/${jobCardNo.toUpperCase()}`);
        const shouldThrow = err && (
          err.code === 'permission-denied' || 
          err.code === 'invalid-argument' || 
          (err.message && (
            err.message.toLowerCase().includes('permission') || 
            err.message.toLowerCase().includes('denied')
          ))
        );
        if (shouldThrow) {
          throw err;
        }
      }
    }

    // 2. Update Local Storage offline cache second
    const cards = await this.getJobCards();
    const updatedCards = cards.filter(c => c.jobCardNo.toLowerCase() !== jobCardNo.toLowerCase());
    setLocalStorageItem('mfr_job_cards', updatedCards);

    // Cascade delete movements from local storage
    const movements = await this.getMovements();
    const updatedMovements = movements.filter(m => m.jobCardNo.toLowerCase() !== jobCardNo.toLowerCase());
    setLocalStorageItem('mfr_movements', updatedMovements);

    // Cascade delete notifications from local storage
    const notifications = await this.getNotifications();
    const updatedNotifications = notifications.filter(n => !n.message.toLowerCase().includes(jobCardNo.toLowerCase()));
    setLocalStorageItem('mfr_notifications', updatedNotifications);

    await this.logAction(userId, userName, 'DELETE_JOB_CARD', `Deleted Job Card: ${jobCardNo} and all related material transitions/notifications`);
  }

  static async deleteAllJobCards(userId: string, userName: string): Promise<void> {
    await this.verifyAdmin(userId);
    // 1. Update Local Storage offline cache first
    setLocalStorageItem('mfr_job_cards', []);
    setLocalStorageItem('mfr_movements', []);
    setLocalStorageItem('mfr_notifications', []);
    setLocalStorageItem('mfr_items', []);

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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

    await this.logAction(userId, userName, 'DELETE_ALL_JOB_CARDS', `Deleted all job card entries, material movements, notifications, and Raw Material Store item records from database`);
  }

  static async factoryReset(userId: string, userName: string): Promise<void> {
    await this.verifyAdmin(userId);

    // 1. Reset Local Storage offline cache
    setLocalStorageItem('mfr_users', defaultUsers);
    setLocalStorageItem('mfr_job_cards', defaultJobCards);
    setLocalStorageItem('mfr_movements', defaultMovements);
    setLocalStorageItem('mfr_notifications', defaultNotifications);
    setLocalStorageItem('mfr_items', defaultSavedItems);
    setLocalStorageItem('mfr_audit_logs', defaultAuditLogs);
    setLocalStorageItem('mfr_company_config', defaultCompanyConfig);

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
      try {
        const collectionsToReset = [
          { name: 'mfr_users', data: defaultUsers, idKey: 'userId' },
          { name: 'mfr_job_cards', data: defaultJobCards, idKey: 'jobCardNo' },
          { name: 'mfr_movements', data: defaultMovements, idKey: 'movementId' },
          { name: 'mfr_notifications', data: defaultNotifications, idKey: 'notificationId' },
          { name: 'mfr_items', data: defaultSavedItems, idKey: 'id' },
          { name: 'mfr_audit_logs', data: defaultAuditLogs, idKey: 'id' }
        ];

        for (const colInfo of collectionsToReset) {
          const querySnapshot = await getDocs(collection(db, colInfo.name));
          for (const docSnap of querySnapshot.docs) {
            await deleteDoc(doc(db, colInfo.name, docSnap.id));
          }
          for (const entry of colInfo.data) {
            const docId = (entry as any)[colInfo.idKey];
            await setDoc(doc(db, colInfo.name, docId), entry);
          }
        }

        // Global Config and Seeded flag
        const globalRef = doc(db, 'mfr_company_config', 'global');
        await setDoc(globalRef, defaultCompanyConfig);

        const seededRef = doc(db, 'mfr_company_config', 'seeded');
        await setDoc(seededRef, { companyName: 'SystemSeeded', details: 'Initialized' } as CompanyConfig);

      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'mfr_company_config');
      }
    }

    await this.logAction(userId, userName, 'FACTORY_RESET', `Triggered full system Factory Reset back to initial default seed state`);
  }

  // --- MATERIAL MOVEMENTS ---
  static async getMovements(): Promise<MaterialMovement[]> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_movements'));
        const list: MaterialMovement[] = [];
        querySnapshot.forEach((docSnap) => {
          list.push(docSnap.data() as MaterialMovement);
        });
        const sorted = list.sort((a, b) => new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime());
        // Mirror to local cache on successful load
        setLocalStorageItem('mfr_movements', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_movements');
      }
    }
    return getLocalStorageItem<MaterialMovement[]>('mfr_movements', defaultMovements);
  }

  static async createMovement(movement: Omit<MaterialMovement, 'movementId' | 'transferDate' | 'accepted'>, userId: string, userName: string): Promise<MaterialMovement> {
    const movements = await this.getMovements();
    const newId = `M-${2000 + movements.length + 1}`;
    
    const newMov: MaterialMovement = {
      ...movement,
      transferBy: movement.transferBy || userName || 'Staff',
      movementId: newId,
      transferDate: new Date().toISOString(),
      accepted: false,
      initiatedByUserId: userId,
      initiatedByUserName: userName
    };

    // 1. Update Local Storage offline cache first
    movements.unshift(newMov);
    setLocalStorageItem('mfr_movements', movements);
    
    // Update Job Card department & status to show pending placement (only if NOT a Dispatch Issue Request)
    if (!movement.isIssueRequest && !movement.jobCardNo.startsWith('STOCK-IN-')) {
      await this.updateJobCard(movement.jobCardNo, {
        status: 'Pending Acceptance',
        currentDepartment: movement.toDepartment as Department
      }, userId, userName);
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
    });

    // 2. Write to physical Firestore
    await this.tryPhysicalWrite(
      'Transfer Material',
      `Transfer ${movement.quantity} KG of ${movement.jobCardNo} to ${movement.toDepartment}`,
      [
        { collection: 'mfr_movements', docId: newId, data: newMov, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_movements', newId), newMov);
      }
    );

    await this.logAction(
      userId, 
      userName, 
      'TRANSFER_MATERIAL', 
      `User ${userName} (ID: ${userId}) initiated material movement ${newId}: Transferred ${movement.quantity} KG of Job Card ${movement.jobCardNo} from ${movement.fromDepartment} to ${movement.toDepartment}.`
    );
    
    // Log to Google Sheets
    logMaterialMovementToSheets(newMov).catch(err => console.warn('Google Sheets movement log failed:', err));

    return newMov;
  }

  static async acceptMovement(
    movementId: string, 
    acceptedByUserId: string, 
    acceptedByName: string, 
    remarks?: string,
    extraFields?: { allottedLocation?: string; rackNo?: string; quantity?: number; issueStatus?: 'Issued' | 'Rejected' }
  ): Promise<void> {
    const list = await this.getMovements();
    const idx = list.findIndex(m => m.movementId === movementId);
    if (idx === -1) throw new Error(`Movement ${movementId} not found`);
    const mov = list[idx];

    const isRawMaterialStoreIssuing = mov.isIssueRequest && 
                                      mov.fromDepartment === 'Raw Material Store' && 
                                      mov.toDepartment === 'Production' && 
                                      extraFields?.issueStatus === 'Issued';

    if (isRawMaterialStoreIssuing) {
      mov.accepted = false;
      if (remarks) mov.remarks = remarks;
      if (extraFields?.allottedLocation !== undefined) mov.allottedLocation = extraFields.allottedLocation;
      if (extraFields?.rackNo !== undefined) mov.rackNo = extraFields.rackNo;
      if (extraFields?.quantity !== undefined) mov.quantity = extraFields.quantity;
      if (extraFields?.issueStatus !== undefined) mov.issueStatus = extraFields.issueStatus;
    } else {
      mov.accepted = true;
      mov.acceptedBy = acceptedByName;
      mov.acceptedDate = new Date().toISOString();
      if (remarks) mov.remarks = remarks;
      if (extraFields?.allottedLocation !== undefined) mov.allottedLocation = extraFields.allottedLocation;
      if (extraFields?.rackNo !== undefined) mov.rackNo = extraFields.rackNo;
      if (extraFields?.quantity !== undefined) mov.quantity = extraFields.quantity;
      if (extraFields?.issueStatus !== undefined) mov.issueStatus = extraFields.issueStatus;
      else if (mov.isIssueRequest) mov.issueStatus = 'Issued';
    }

    // Track modification in the perfect audit trail
    mov.modifiedByUserId = acceptedByUserId;
    mov.modifiedByUserName = acceptedByName;
    mov.modifiedDate = new Date().toISOString();
    mov.modifiedAction = 'ACCEPT';

    // 1. Update Local Storage offline cache first
    setLocalStorageItem('mfr_movements', list);

    // 2. Write to physical Firestore
    await this.tryPhysicalWrite(
      'Accept Material',
      `Accept ${mov.quantity} KG of ${mov.jobCardNo} at ${mov.toDepartment}`,
      [
        { collection: 'mfr_movements', docId: movementId, data: mov, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_movements', movementId), mov);
      }
    );

    // Update the corresponding job card status
    // If sent to 'Completed', process job card closure
    if (!mov.jobCardNo.startsWith('STOCK-IN-')) {
      if (mov.toDepartment === 'Completed') {
        const cards = await this.getJobCards();
        const cardIdx = cards.findIndex(c => c.jobCardNo.toLowerCase() === mov!.jobCardNo.toLowerCase());
        if (cardIdx >= 0) {
          const card = cards[cardIdx];
          const newBalance = Math.max(0, card.orderQty - mov!.quantity);
          await this.updateJobCard(mov!.jobCardNo, {
            status: 'Completed',
            completed: true,
            currentQty: mov!.quantity,
            balanceQty: newBalance
          }, acceptedByUserId, acceptedByName);
          
          await this.createNotification({
            department: 'Dispatch',
            title: 'Dispatch Completed',
            message: `Job ${mov!.jobCardNo} is fully completed with Final Dispatched Quantity of ${mov!.quantity} KG (Balance: ${newBalance} KG).`,
            userId: 'all_dispatch'
          });
        }
      } else {
        // Set to appropriate state inside the target department
        // If entering Production, start as Pending to let them initiate the run, otherwise In Process.
        const targetStatus = mov.toDepartment === 'Production' ? 'Pending' : 'In Process';
        
        const jobCards = await this.getJobCards();
        const jobCard = jobCards.find(c => c.jobCardNo.toLowerCase() === mov.jobCardNo.toLowerCase());
        
        const updates: any = {
          status: targetStatus,
          currentDepartment: mov.toDepartment,
          currentQty: mov.quantity
        };

        if (mov.toDepartment === 'Store' && extraFields) {
          updates.storeDetails = {
            ...(jobCard?.storeDetails || {}),
            locationBin: extraFields.allottedLocation || jobCard?.storeDetails?.locationBin || '',
            rackNo: extraFields.rackNo || jobCard?.storeDetails?.rackNo || ''
          };
        }

        if (mov.fromDepartment === 'Raw Material Store' && mov.isIssueRequest) {
          const prevIssuedQty = jobCard?.rawMaterialStoreDetails?.issuedQty || 0;
          const prevRequestedQty = jobCard?.rawMaterialStoreDetails?.requestedQty || 0;
          const newThisIssue = extraFields?.quantity || (mov as any).requestedQty || 0;
          const newThisReq = (mov as any).requestedQty || 0;

          updates.rawMaterialStoreDetails = {
            ...(jobCard?.rawMaterialStoreDetails || {}),
            materialCode: (mov as any).processDetails?.rawMaterialCode || jobCard?.rawMaterialStoreDetails?.materialCode || '',
            materialName: (mov as any).processDetails?.rawMaterialName || jobCard?.rawMaterialStoreDetails?.materialName || '',
            requestedQty: prevRequestedQty > 0 ? (prevRequestedQty + newThisReq) : newThisReq,
            issuedQty: extraFields?.issueStatus === 'Issued' ? (prevIssuedQty + newThisIssue) : prevIssuedQty,
            issueStatus: extraFields?.issueStatus || 'Issued',
            remarks: remarks || mov.remarks || '',
            binLocation: extraFields?.allottedLocation || '',
            rejectionReason: extraFields?.issueStatus === 'Rejected' ? remarks : ''
          };
          if (extraFields?.issueStatus === 'Issued') {
            updates.currentQty = (jobCard?.currentQty || 0) + newThisIssue;
          }
        }

        await this.updateJobCard(mov.jobCardNo, updates, acceptedByUserId, acceptedByName);

        await this.createNotification({
          department: mov.fromDepartment,
          title: 'Material Accepted',
          message: `${acceptedByName} accepted ${mov.quantity} KG for Job Card ${mov.jobCardNo} at ${mov.toDepartment}.`,
          userId: 'previous_dept'
        });
      }
    }

    await this.logAction(
      acceptedByUserId, 
      acceptedByName, 
      'ACCEPT_MATERIAL', 
      `User ${acceptedByName} (ID: ${acceptedByUserId}) accepted/modified material movement ${movementId}: Confirmed transfer of ${mov.quantity} KG for ${mov.jobCardNo} at ${mov.toDepartment}.`
    );
    
    // Log to Google Sheets
    logMaterialMovementToSheets(mov).catch(err => console.warn('Google Sheets movement log failed:', err));
  }

  static async rejectMovement(movementId: string, rejectedByUserId: string, rejectedByName: string, remarks: string): Promise<void> {
    // 1. Remove from Local Storage list first
    const list = await this.getMovements();
    const idx = list.findIndex(m => m.movementId === movementId);
    if (idx === -1) throw new Error(`Movement ${movementId} not found`);
    const mov = list[idx];
    
    // Track deletion/rejection info before we splice it out of active list
    mov.deletedByUserId = rejectedByUserId;
    mov.deletedByUserName = rejectedByName;
    mov.deletedDate = new Date().toISOString();

    list.splice(idx, 1);
    setLocalStorageItem('mfr_movements', list);

    // 2. Write to physical Firestore
    await this.tryPhysicalWrite(
      'Reject Material',
      `Reject ${mov.quantity} KG of ${mov.jobCardNo} from ${mov.fromDepartment}`,
      [
        { collection: 'mfr_movements', docId: movementId, operation: 'delete' }
      ],
      async () => {
        await deleteDoc(doc(db, 'mfr_movements', movementId));
      }
    );

    // Revert Job Card department to previous and mark status 'Rejected'
    await this.updateJobCard(mov.jobCardNo, {
      status: 'Rejected',
      currentDepartment: mov.fromDepartment
    }, rejectedByUserId, rejectedByName);

    // Create alarm notification for sender
    await this.createNotification({
      department: mov.fromDepartment,
      title: '⚠️ Material Rejected',
      message: `${rejectedByName} rejected Job Card ${mov.jobCardNo} movement. Remarks: "${remarks}"`,
      userId: `all_${mov.fromDepartment.toLowerCase().replace(' ', '_')}`
    });

    await this.logAction(
      rejectedByUserId, 
      rejectedByName, 
      'REJECT_MATERIAL', 
      `User ${rejectedByName} (ID: ${rejectedByUserId}) rejected/deleted material movement ${movementId}: Sent ${mov.quantity} KG of Job Card ${mov.jobCardNo} back to ${mov.fromDepartment} from ${mov.toDepartment}. Reason: "${remarks}"`
    );
    
    // Log to Google Sheets
    logMaterialMovementToSheets({
      ...mov,
      accepted: false,
      remarks: `REJECTED: ${remarks}`
    }).catch(err => console.warn('Google Sheets movement log failed:', err));
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

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
      try {
        await setDoc(doc(db, 'mfr_movements', movementId), mov);
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

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_notifications'));
        const list: AppNotification[] = [];
        querySnapshot.forEach((docSnap) => {
          list.push(docSnap.data() as AppNotification);
        });
        const sorted = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        // Mirror to local cache on successful load
        setLocalStorageItem('mfr_notifications', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_notifications');
      }
    }
    return getLocalStorageItem<AppNotification[]>('mfr_notifications', defaultNotifications);
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

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
      try {
        await setDoc(doc(db, 'mfr_notifications', newId), newNotif);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `mfr_notifications/${newId}`);
      }
    }

    return newNotif;
  }

  static async deleteNotification(id: string): Promise<void> {
    // 1. Update Local Storage offline cache first
    const list = await this.getNotifications();
    const filtered = list.filter(n => n.notificationId !== id);
    setLocalStorageItem('mfr_notifications', filtered);

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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
    }

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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

    // 2. Write to physical Firestore
    if (useRealFirebase && db) {
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
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_audit_logs'));
        const list: AuditLog[] = [];
        querySnapshot.forEach((docSnap) => {
          list.push(docSnap.data() as AuditLog);
        });
        return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 500);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_audit_logs');
      }
    }
    return getLocalStorageItem<AuditLog[]>('mfr_audit_logs', defaultAuditLogs);
  }

  static async logAction(userId: string, userName: string, action: string, details: string): Promise<void> {
    const logs = await this.getAuditLogs();
    const newId = `AL-${logs.length + 1}-${Date.now()}`;
    const newLog: AuditLog = {
      id: newId,
      timestamp: new Date().toISOString(),
      userId,
      userName,
      action,
      details
    };

    if (useRealFirebase && db) {
      try {
        await setDoc(doc(db, 'mfr_audit_logs', newId), newLog);
        logActionToSheets(newLog).catch(err => console.warn('Google Sheets action log failed:', err));
        return;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `mfr_audit_logs/${newId}`);
      }
    }

    logs.unshift(newLog);
    setLocalStorageItem('mfr_audit_logs', logs.slice(0, 500)); // keep last 500 logs
    
    // Log to Google Sheets
    logActionToSheets(newLog).catch(err => console.warn('Google Sheets action log failed:', err));
  }

  static async deleteAuditLog(logId: string, performerId: string): Promise<void> {
    await this.verifyAdmin(performerId);
    if (useRealFirebase && db) {
      try {
        await deleteDoc(doc(db, 'mfr_audit_logs', logId));
        return;
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `mfr_audit_logs/${logId}`);
      }
    }
    const logs = await this.getAuditLogs();
    const filtered = logs.filter(l => l.id !== logId);
    setLocalStorageItem('mfr_audit_logs', filtered);
  }

  // --- SAVED ITEMS ---
  static async getSavedItems(): Promise<SavedItem[]> {
    if (useRealFirebase && db && !this.isOfflineMode()) {
      try {
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_items'));
        const list: SavedItem[] = [];
        querySnapshot.forEach((docSnap) => {
          list.push(docSnap.data() as SavedItem);
        });
        const sorted = list.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
        setLocalStorageItem('mfr_items', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_items');
      }
    }
    return getLocalStorageItem<SavedItem[]>('mfr_items', defaultSavedItems);
  }

  static async saveItem(itemName: string, itemCode?: string): Promise<void> {
    if (!itemName) return;
    const items = await this.getSavedItems();
    const normalizedName = itemName.trim().toLowerCase();
    const safeCode = (itemCode || '-').trim();
    const normalizedCode = safeCode.toLowerCase();
    
    const exists = items.some(item => 
      item.itemName.trim().toLowerCase() === normalizedName && 
      (item.itemCode || '-').trim().toLowerCase() === normalizedCode
    );
    if (exists) return;

    const newId = `item-${Date.now()}`;
    const newItem: SavedItem = {
      id: newId,
      itemName: itemName.trim(),
      itemCode: safeCode,
      createdAt: new Date().toISOString()
    };

    items.unshift(newItem);
    setLocalStorageItem('mfr_items', items);

    await this.tryPhysicalWrite(
      'Save Item Autocomplete',
      `Save Item Autocomplete: ${itemName} (${itemCode})`,
      [
        { collection: 'mfr_items', docId: newId, data: newItem, operation: 'set' }
      ],
      async () => {
        await setDoc(doc(db, 'mfr_items', newId), newItem);
      }
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
        } else {
          throw err;
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

    const newItem: SyncQueueItem = {
      id: `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    item.status = 'pending';
    item.error = undefined;
    setLocalStorageItem('mfr_sync_queue', queue);
    window.dispatchEvent(new CustomEvent('sync-queue-updated'));

    if (useRealFirebase && db) {
      try {
        for (const op of item.operations) {
          if (op.operation === 'set') {
            await setDoc(doc(db, op.collection, op.docId), op.data);
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
        await this.ensureSeeded();
        const querySnapshot = await getDocs(collection(db, 'mfr_outsource_orders'));
        const list: OutsourceOrder[] = [];
        querySnapshot.forEach((docSnap) => {
          list.push(docSnap.data() as OutsourceOrder);
        });
        const sorted = list.sort((a, b) => new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime());
        setLocalStorageItem('mfr_outsource_orders', sorted);
        return sorted;
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'mfr_outsource_orders');
      }
    }
    return getLocalStorageItem<OutsourceOrder[]>('mfr_outsource_orders', defaultOutsourceOrders);
  }

  static async createOutsourceOrder(
    orderData: Omit<OutsourceOrder, 'orderId' | 'orderedAt' | 'status' | 'orderedByUserId' | 'orderedByUserName'>,
    userId: string,
    userName: string
  ): Promise<OutsourceOrder> {
    const list = await this.getOutsourceOrders();
    const orderId = `OUT-${new Date().getFullYear()}-${String(list.length + 1).padStart(3, '0')}`;
    
    const newOrderRaw: OutsourceOrder = {
      ...orderData,
      orderId,
      orderedByUserId: userId,
      orderedByUserName: userName,
      orderedAt: new Date().toISOString(),
      status: 'Assigned'
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

    const updated = sanitizeForFirestore({ ...list[idx], ...updates });
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
    if (useRealFirebase && db && !this.isOfflineMode()) {
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

  // Realtime subscription emulation & Live Firestore triggers
  static subscribeToUpdates(collectionName: string, callback: () => void): () => void {
    if (useRealFirebase && db) {
      try {
        const unsub = onSnapshot(collection(db, collectionName), () => {
          callback();
        }, (err) => {
          console.error(`Firestore watch failed for collection [${collectionName}]: `, err);
          try {
            handleFirestoreError(err, OperationType.GET, collectionName);
          } catch (e) {
            // Logged/handled via handleFirestoreError
          }
        });
        return unsub;
      } catch (err) {
        console.error(`Failed to register Firestore real-time listener for ${collectionName}:`, err);
      }
    }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.collection === collectionName) {
        callback();
      }
    };
    window.addEventListener('mock-db-update', handler);
    return () => {
      window.removeEventListener('mock-db-update', handler);
    };
  }
}
