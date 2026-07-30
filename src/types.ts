export type Department = 'Purchase' | 'Raw Material Store' | 'Dispatch' | 'Production' | 'Heat Treatment' | 'Plating' | 'Packing' | 'Store';
export type UserRole = 'super_admin' | 'admin' | 'staff';

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  pin: string;
  department: Department | 'Admin';
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export type JobCardStatus = 'Pending' | 'In Process' | 'Completed' | 'Rejected' | 'Pending Acceptance';

export interface JobCard {
  jobCardNo: string;
  orderNo: string;
  partyName: string;
  itemName: string;
  itemCode: string;
  orderQty: number; // in KG or PCS
  currentQty: number; // in KG or PCS
  unit?: 'KGS' | 'PCS'; // unit option
  balanceQty: number; // orderQty - processedQty
  currentDepartment: Department | 'Completed';
  status: JobCardStatus;
  heatTreatmentRequired: boolean;
  createdBy: string; // user name/id
  createdAt: string;
  completed: boolean;
  processType?: 'Manufacturing' | 'Purchase';
  materialType?: 'Raw Material' | 'Semi Finished Goods' | 'Finished Goods';
  customRoutedToPlating?: number;
  customRoutedToPacking?: number;
  customRoutedToStore?: number;
  
  // Custom processing fields recorded from departments
  operatorName?: string;
  wireScrapQty?: number;
  productionDetails?: {
    operatorName?: string;
    producedQty?: number;
    wireScrapQty?: number;
    wireScrapReason?: string;
    remarks?: string;
  };
  purchaseDetails?: {
    supplierName?: string;
    billNo?: string;
    receivedQty?: number;
    rejectionQty?: number;
    sentToStore?: number;
    remarks?: string;
    materialType?: 'Raw Material' | 'Semi Finished Goods' | 'Finished Goods';
    unit?: 'KGS' | 'PCS';
  };
  heatTreatmentDetails?: {
    hardnessRequired?: string;
    temperature?: string;
    cycleTime?: string;
    remarks?: string;
    rejectionQty?: number;
    qtyReceivedFromProd?: number;
    qtySentToPlating?: number;
    qtyRemaining?: number;
  };
  platingDetails?: {
    platingType?: string;
    micronThickness?: string;
    durationMinutes?: string;
    remarks?: string;
    rejectionQty?: number;
    qtyReceivedFromHt?: number;
    qtySentToPacking?: number;
    qtyRemaining?: number;
  };
  packingDetails?: {
    packedQty?: number;
    boxCount?: number;
    packingType?: string;
    remarks?: string;
    rejectionQty?: number;
    qtyReceivedFromPlating?: number;
    qtySentToStore?: number;
    qtyRemaining?: number;
    pcsPerBagOrBox?: number;
    totalPcs?: number;
  };
  storeDetails?: {
    verifiedQty?: number;
    locationBin?: string;
    rackNo?: string;
    remarks?: string;
    rejectionQty?: number;
    qtyReceivedFromPacking?: number;
    qtySentToDispatch?: number;
    qtyRemaining?: number;
    pcsPerBagOrBox?: number;
    totalPcs?: number;
  };
  dispatchDetails?: {
    invoiceNo?: string;
    vehicleNo?: string;
    dispatchQty?: number;
    dispatchDate?: string;
    remarks?: string;
  };
  rawMaterialStoreDetails?: {
    materialCode?: string;
    materialName?: string;
    requestedQty?: number;
    issuedQty?: number;
    issueStatus?: 'Pending' | 'Issued' | 'Rejected';
    remarks?: string;
    binLocation?: string;
    rejectionReason?: string;
  };
}

export interface MaterialMovement {
  movementId: string;
  jobCardNo: string;
  fromDepartment: Department;
  toDepartment: Department | 'Completed';
  quantity: number;
  transferBy: string; // user name
  transferDate: string;
  accepted: boolean;
  acceptedBy?: string; // user name
  acceptedDate?: string;
  remarks?: string;
  allottedLocation?: string;
  rackNo?: string;
  
  // Dispatch issue request properties
  isIssueRequest?: boolean;
  requestedUnit?: 'PCS' | 'KGS';
  requestedQty?: number;
  issueStatus?: 'Pending' | 'Issued' | 'Rejected';
  
  // Specific data carried during transit
  wireScrapQty?: number;
  processDetails?: Record<string, any>;

  // Perfect Audit Trail Tracking
  initiatedByUserId?: string;
  initiatedByUserName?: string;
  modifiedByUserId?: string;
  modifiedByUserName?: string;
  modifiedDate?: string;
  modifiedAction?: string;
  deletedByUserId?: string;
  deletedByUserName?: string;
  deletedDate?: string;
}

export interface AppNotification {
  notificationId: string;
  userId: string; // user UID or department name (for group notifications)
  department?: Department | 'Admin' | 'All';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  ipAddress?: string;
}

export interface CompanyConfig {
  companyName: string;
  details: string;
  phone?: string;
  address?: string;
  gstIn?: string;
  logoUrl?: string; // in case we want support for generated or custom logos
  requireRawMaterialForProduction?: boolean;
  whatsappEnabled?: boolean;
  whatsappPhoneNumber?: string; // Group link or phone number for group alerts
  whatsappApiUrl?: string; // Optional custom API webhook
  whatsappAutoOpenShare?: boolean; // Auto open WhatsApp share tab
  updatedBy?: string;
  updatedAt?: string;
}

export interface SavedItem {
  id: string;
  itemName: string;
  itemCode: string;
  createdAt?: string;
}

export interface SyncQueueOperation {
  collection: string;
  docId: string;
  data?: any;
  operation: 'set' | 'update' | 'delete';
}

export interface SyncQueueItem {
  id: string;
  action: string;
  description: string;
  timestamp: string;
  status: 'pending' | 'failed' | 'synced';
  error?: string;
  operations: SyncQueueOperation[];
}

