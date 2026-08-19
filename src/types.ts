export type Department = 'Purchase' | 'Raw Material Store' | 'Dispatch' | 'Production' | 'Heat Treatment' | 'Plating' | 'Packing' | 'Store';
export type UserRole = 
  | 'super_admin' 
  | 'admin' 
  | 'staff' 
  | 'management' 
  | 'viewer' 
  | 'production' 
  | 'heat_treatment' 
  | 'plating' 
  | 'packing' 
  | 'store' 
  | 'rm_store' 
  | 'dispatch' 
  | 'purchase';

export interface UserProfile {
  userId: string;
  empId?: string; // Employee ID e.g. EMP-101
  name: string;
  email: string;
  phone?: string;
  department: Department | 'Admin' | 'Management';
  allowedDepartments?: (Department | 'Admin' | 'Management')[]; // Additional departments user is authorized to access
  accessList?: (Department | 'Admin' | 'Management')[]; // Access list of departments authorized by Super Admin
  role: UserRole;
  active: boolean;
  status?: 'active' | 'inactive';
  createdAt: string;
  lastLogin?: string;
  pin?: string;
  pinHash?: string;
  canOutsource?: boolean; // Authorized Outsourcing Assignee
}

export interface AssemblyComponent {
  jobCardNo: string;
  itemCode?: string;
  itemName: string;
  consumedQty: number;
  unit?: 'KGS' | 'PCS';
  consumedDate?: string;
}

export interface AssemblyRecord {
  assemblyId: string;
  assemblyName: string;
  assembledProductCode: string;
  assembledQty: number;
  unit: 'KGS' | 'PCS' | 'SETS' | 'BOXES';
  assembledAt: string;
  assembledBy: string;
  boxCount?: number;
  pcsPerBox?: number;
  components: AssemblyComponent[];
  remarks?: string;
}

export type JobCardStatus = 
  | 'Pending' 
  | 'In Process' 
  | 'In Production' 
  | 'Heat Treatment' 
  | 'Plating' 
  | 'Packing' 
  | 'Completed' 
  | 'Hold' 
  | 'Cancelled' 
  | 'Rejected' 
  | 'Pending Acceptance' 
  | 'Stored';
export type OutsourceStatus = 'Assigned' | 'Supplier PO Placed' | 'In Transit' | 'Material Received' | 'Completed' | 'Cancelled';
export type OutsourceMaterialType = 'Semi Finished Goods' | 'Finished Goods';

export interface OutsourceOrderItem {
  itemId: string;
  itemName: string;
  itemCode?: string;
  orderQty: number;
  unit: 'KGS' | 'PCS';
  processType: string;
  outsourceMaterialType: OutsourceMaterialType;
  jobCardNo?: string;
  receivedQty?: number;
}

export interface OutsourceOrder {
  orderId: string; // OUT-2026-001
  jobCardNo?: string;
  partyName: string;
  itemName: string;
  itemCode?: string;
  orderQty: number;
  unit: 'KGS' | 'PCS';
  processType: string; // e.g. 'External Heat Treatment', 'Surface Plating', 'CNC Machining Outsource'
  outsourceMaterialType: OutsourceMaterialType; // 'Semi Finished Goods' | 'Finished Goods'
  
  // Multi-item support
  items?: OutsourceOrderItem[];
  
  // Dispatch Creator
  orderedByUserId: string;
  orderedByUserName: string;
  orderedAt: string;
  dispatchRemarks?: string;
  
  // Assignee
  assignedToUserId: string;
  assignedToUserName: string;
  status: OutsourceStatus;
  
  // Supplier PO Details (filled by Assigned Person)
  supplierName?: string;
  poNumber?: string;
  supplierPoNo?: string;
  poDate?: string;
  unitRate?: number;
  supplierRate?: number;
  totalCost?: number;
  expectedDeliveryDate?: string;
  estimatedDelivery?: string;
  supplierRemarks?: string;
  poRemarks?: string;
  poPlacedAt?: string;
  poPlacedByUserName?: string;
  
  // Goods Receipt Details (filled when Material Received by Purchase / Assignee)
  receivedQty?: number;
  rejectionQty?: number;
  netAcceptedQty?: number;
  remainingPoBalance?: number;
  reconciliationStatus?: 'Fully Reconciled' | 'Partially Reconciled' | 'Over-Delivered' | 'Pending Receipt';
  poReceiptHistory?: {
    receivedQty: number;
    rejectionQty: number;
    netAcceptedQty: number;
    challanNo?: string;
    date: string;
    remarks?: string;
  }[];
  rejectionReason?: string;
  billNo?: string;
  receivedChallanNo?: string;
  receivedMaterialType?: 'Semi Finished Goods' | 'Finished Goods';
  receivedAt?: string;
  receivedByUserId?: string;
  receivedByUserName?: string;
  targetDepartmentAfterReceipt?: Department;
  receiptRemarks?: string;
}

export interface JobCard {
  jobCardNo: string;
  parentJobCardNo?: string;
  orderNo: string;
  poNumber?: string;
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
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent';
  isHold?: boolean;
  isCancelled?: boolean;
  isDeleted?: boolean;
  deliveryDate?: string;
  targetDate?: string;
  processType?: 'Manufacturing' | 'Purchase';
  isOutsource?: boolean;
  outsourceOrderId?: string;
  assignedToUserId?: string;
  assignedToUserName?: string;
  outsourceStatus?: OutsourceStatus;
  outsourceDetails?: Partial<OutsourceOrder>;
  materialType?: 'Raw Material' | 'Semi Finished Goods' | 'Finished Goods';
  customRoutedToPlating?: number;
  customRoutedToPacking?: number;
  customRoutedToStore?: number;
  
  isAssemblyProduct?: boolean;
  assemblyComponents?: AssemblyComponent[];

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
    isAssemblyProduct?: boolean;
    assemblyComponents?: AssemblyComponent[];
    assemblyHistory?: AssemblyRecord[];
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
  poNumber?: string;
  orderNo?: string;
  itemName?: string;
  itemCode?: string;
  partyName?: string;
  fromDepartment: Department;
  toDepartment: Department | 'Completed';
  quantity: number;
  availableQtyBefore?: number;
  remainingQtyAfter?: number;
  transactionType?: 'TRANSFER' | 'REVERSAL' | 'ISSUE_REQUEST' | 'ADJUSTMENT';
  reversalOfMovementId?: string;
  transferBy: string; // user name
  empId?: string;
  transferDate: string;
  time?: string;
  accepted: boolean;
  acceptedBy?: string; // user name
  acceptedByUserId?: string;
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
  isDeleted?: boolean;
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
  date?: string;
  time?: string;
  userId: string;
  userName: string;
  empId?: string;
  department?: string;
  action: string;
  jobCardNo?: string;
  poNumber?: string;
  itemName?: string;
  oldQuantity?: number;
  movementQuantity?: number;
  newQuantity?: number;
  fromDepartment?: string;
  toDepartment?: string;
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
  customerItemFilterEnabled?: boolean;
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
  itemCode?: string;
  partyName?: string;
  customerName?: string;
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

