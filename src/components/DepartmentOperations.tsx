import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getJobCardProcessMetrics, getRawMaterialIssuedQty, getWireScrapQty } from '../lib/metrics';
import { 
  ArrowRight, 
  Plus, 
  Play, 
  Check, 
  X, 
  Trash2, 
  Sliders, 
  HelpCircle, 
  TrendingUp, 
  Wrench, 
  Flame, 
  Sparkles, 
  PackageCheck, 
  Warehouse, 
  Truck,
  CheckCircle2,
  Layers,
  Scale,
  Box,
  Link
} from 'lucide-react';
import { JobCard, MaterialMovement, Department, UserProfile, SavedItem, CompanyConfig, OutsourceOrder, OutsourceMaterialType } from '../types';
import { DBService } from '../lib/firebase';
import RawMaterialRequestModal, { INVENTORY_RAW_MATERIALS, getDynamicRawMaterialsStock } from './RawMaterialRequestModal';
import JobStatusBadge from './JobStatusBadge';

interface DepartmentOperationsProps {
  currentUser: UserProfile;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  companyConfig?: CompanyConfig | null;
  onCreateJobCard: (job: any) => void;
  onUpdateJobCard: (jobCardNo: string, updates: Partial<JobCard>) => void;
  onCreateMovement: (mov: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
    isIssueRequest?: boolean;
    issueStatus?: 'Pending' | 'Issued' | 'Rejected';
    requestedUnit?: 'PCS' | 'KGS';
    requestedQty?: number;
    processDetails?: any;
  } | {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
    isIssueRequest?: boolean;
    issueStatus?: 'Pending' | 'Issued' | 'Rejected';
    requestedUnit?: 'PCS' | 'KGS';
    requestedQty?: number;
    processDetails?: any;
  }[]) => void;
  onAcceptMovement: (
    movementId: string, 
    remarks?: string, 
    extraFields?: { allottedLocation?: string; rackNo?: string; quantity?: number; issueStatus?: 'Issued' | 'Rejected' }
  ) => Promise<void> | any;
  onRejectMovement: (movementId: string, remarks: string) => void;
  onSelectJobCard: (jobCard: JobCard) => void;
}

export const PREDEFINED_RAW_MATERIALS = [
  { code: 'EN8-R', name: 'EN8 Carbon Steel Round Bars' },
  { code: 'EN9-S', name: 'EN9 Alloy Steel Square Rods' },
  { code: 'MS-WC', name: 'Mild Steel Wire Coils (High Carbon)' },
  { code: 'SS-304', name: 'Stainless Steel Sheet Coils (Grade 304)' },
  { code: 'HT-SB', name: 'High-Tensile Steel Billets (HT-200)' },
  { code: 'BR-HEX', name: 'Brass Hexagonal Rods (C360)' },
  { code: 'AL-6061', name: 'Aluminum Extrusion Bars (6061-T6)' }
];

export default function DepartmentOperations({
  currentUser,
  jobCards,
  movements,
  companyConfig,
  onCreateJobCard,
  onUpdateJobCard,
  onCreateMovement,
  onAcceptMovement,
  onRejectMovement,
  onSelectJobCard
}: DepartmentOperationsProps) {
  const isRawMaterialCompulsory = companyConfig?.requireRawMaterialForProduction !== false;
  // Determine relevant department
  const activeDept = currentUser.department === 'Admin' ? 'Dispatch' : currentUser.department as Department;

  const [activeSubView, setActiveSubView] = useState<'incoming' | 'operations' | 'completed'>('operations');

  // --- HORIZONTAL SWIPE FOR DEPARTMENT SUBVIEWS ---
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchCurrentX = useRef<number>(0);
  const isSwiping = useRef<boolean>(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    
    // Allow swiping if not explicitly scrolling in an overflow container
    // We can be more permissive here.
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchCurrentX.current = e.touches[0].clientX;
    isSwiping.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartX.current;
    const deltaY = currentY - touchStartY.current;

    if (!isSwiping.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      
      // Only start swiping if horizontal movement is significantly greater than vertical
      if (absDeltaX > absDeltaY && absDeltaX > 20) {
        isSwiping.current = true;
      }
    }
    
    if (isSwiping.current) {
      touchCurrentX.current = currentX;
      // Prevent vertical scrolling while swiping horizontally
      if (e.cancelable) e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current) return;
    const deltaX = touchCurrentX.current - touchStartX.current;
    const subViews: ('incoming' | 'operations' | 'completed')[] = ['incoming', 'operations', 'completed'];
    const curIndex = subViews.indexOf(activeSubView);

    if (Math.abs(deltaX) > 75 && curIndex !== -1) {
      if (deltaX < 0) {
        // Swipe Left -> Next
        if (curIndex < subViews.length - 1) {
          setActiveSubView(subViews[curIndex + 1]);
        }
      } else {
        // Swipe Right -> Prev
        if (curIndex > 0) {
          setActiveSubView(subViews[curIndex - 1]);
        }
      }
    }
    isSwiping.current = false;
  };

  const [rejectionNotes, setRejectionNotes] = useState('');
  const [activeRejectionId, setActiveRejectionId] = useState<string | null>(null);

  // Track material movements / job card custody acceptance animations
  const [acceptedMovementIds, setAcceptedMovementIds] = useState<Record<string, 'animating' | 'done'>>({});

  // --- FORM STATES ---
  // Create Order (Dispatch)
  const [partyName, setPartyName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [orderQty, setOrderQty] = useState<string | number>(1000);
  const [htRequired, setHtRequired] = useState(false);
  const [dispatchRemarks, setDispatchRemarks] = useState('');
  const [processType, setProcessType] = useState<'Manufacturing' | 'Purchase'>('Manufacturing');
  const [multiItems, setMultiItems] = useState<{
    itemName: string;
    itemCode: string;
    orderQty: number;
    htRequired: boolean;
    remarks?: string;
  }[]>([]);

  // --- MASTER SAVED ITEMS FOR AUTOCOMPLETE ---
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [showPurchaseItemDropdown, setShowPurchaseItemDropdown] = useState(false);

  const [outsourceOrders, setOutsourceOrders] = useState<OutsourceOrder[]>([]);
  const [selectedOutsourceOrderId, setSelectedOutsourceOrderId] = useState<string>('');

  useEffect(() => {
    const loadItemsAndOutsource = async () => {
      try {
        const [items, orders] = await Promise.all([
          DBService.getSavedItems(),
          DBService.getOutsourceOrders()
        ]);
        setSavedItems(items);
        setOutsourceOrders(orders);
      } catch (err) {
        console.error("Failed to load saved items or outsource orders:", err);
      }
    };
    loadItemsAndOutsource();
  }, [jobCards]);

  // Purchase Department Inputs
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseBill, setPurchaseBill] = useState('');
  const [purchaseRemarks, setPurchaseRemarks] = useState('');
  const [purchaseRecQty, setPurchaseRecQty] = useState<string | number>('');
  const [purchaseRejQty, setPurchaseRejQty] = useState<string | number>(0);
  const [purchaseSentQty, setPurchaseSentQty] = useState<number>(0);
  const [purchaseItemName, setPurchaseItemName] = useState('');
  const [purchaseItemCode, setPurchaseItemCode] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState<'KGS' | 'PCS'>('KGS');
  const [activePurchaseJob, setActivePurchaseJob] = useState<string | null>(null);
  const [purchaseTargetDept, setPurchaseTargetDept] = useState<'Store' | 'Plating' | 'Heat Treatment' | 'Raw Material Store'>('Raw Material Store');
  const [purchaseMaterialType, setPurchaseMaterialType] = useState<'Raw Material' | 'Semi Finished Goods' | 'Finished Goods'>('Raw Material');
  const [purchaseMultiItems, setPurchaseMultiItems] = useState<{
    itemName: string;
    itemCode: string;
    recQty: number;
    rejQty: number;
    sentQty: number;
    unit: 'KGS' | 'PCS';
    materialType: 'Raw Material' | 'Semi Finished Goods' | 'Finished Goods';
    targetDept: 'Store' | 'Plating' | 'Heat Treatment' | 'Raw Material Store';
    remarks?: string;
  }[]>([]);

  // Store Department target selection for Purchase route
  const [storeTargetDept, setStoreTargetDept] = useState<'Packing' | 'Dispatch'>('Dispatch');

  // Production Inputs
  const [prodOpName, setProdOpName] = useState('');
  const [prodQty, setProdQty] = useState<number>(0);
  const [prodWireScrap, setProdWireScrap] = useState<number>(0);
  const [prodWireScrapReason, setProdWireScrapReason] = useState<string>('Heading & Cut-Off Waste');
  const [activeProdJob, setActiveProdJob] = useState<string | null>(null);

  // Heat Treatment Inputs
  const [htHardness, setHtHardness] = useState('HRC 32-38');
  const [htTemp, setHtTemp] = useState('850°C');
  const [htDuration, setHtDuration] = useState('4 hours');
  const [htRejectionQty, setHtRejectionQty] = useState<number>(0);
  const [htQtyReceived, setHtQtyReceived] = useState<number>(0);
  const [htQtySentToPlating, setHtQtySentToPlating] = useState<number>(0);
  const [activeHtJob, setActiveHtJob] = useState<string | null>(null);

  // Plating Inputs
  const [platingType, setPlatingType] = useState('Acid Zinc Plating (Yellow)');
  const [platingThick, setPlatingThick] = useState('8-12μm');
  const [platingDur, setPlatingDur] = useState('45 min');
  const [platingRejectionQty, setPlatingRejectionQty] = useState<number>(0);
  const [platingQtyReceived, setPlatingQtyReceived] = useState<number>(0);
  const [platingQtySentToPacking, setPlatingQtySentToPacking] = useState<number>(0);
  const [activePlatingJob, setActivePlatingJob] = useState<string | null>(null);

  // Packing Inputs
  const [packQty, setPackQty] = useState<number>(0);
  const [packBoxCount, setPackBoxCount] = useState<number>(5);
  const [packPcsPerBagOrBox, setPackPcsPerBagOrBox] = useState<number>(100);
  const [packTotalPcs, setPackTotalPcs] = useState<number>(500);
  const [packStyle, setPackStyle] = useState('Corrugated Boxes with wooden pallet support');
  const [packRejectionQty, setPackRejectionQty] = useState<number>(0);
  const [packQtyReceived, setPackQtyReceived] = useState<number>(0);
  const [packQtySentToStore, setPackQtySentToStore] = useState<number>(0);
  const [activePackingJob, setActivePackingJob] = useState<string | null>(null);

  // Store Inputs
  const [storeVerifiedQty, setStoreVerifiedQty] = useState<number>(0);
  const [storeBinLoc, setStoreBinLoc] = useState('BIN-A1');
  const [storeQtyReceived, setStoreQtyReceived] = useState<number>(0);
  const [storeQtySentToDispatch, setStoreQtySentToDispatch] = useState<number>(0);
  const [storeRejectionQty, setStoreRejectionQty] = useState<number>(0);
  const [activeStoreJob, setActiveStoreJob] = useState<string | null>(null);
  const [activeRawStoreJob, setActiveRawStoreJob] = useState<string | null>(null);
  const [storeIncomingLocs, setStoreIncomingLocs] = useState<Record<string, string>>({});
  const [storeIncomingRacks, setStoreIncomingRacks] = useState<Record<string, string>>({});
  const [purchaseIncomingRouting, setPurchaseIncomingRouting] = useState<Record<string, 'Packing' | 'Store'>>({});
  const purchaseQtyUnitLabel = purchaseMaterialType === 'Finished Goods' ? purchaseUnit : 'KG';

  // Outbound Dispatch Inputs
  const [dispInvoice, setDispInvoice] = useState('INV-2026-');
  const [dispVehicle, setDispVehicle] = useState('MH-12-');
  const [dispQty, setDispQty] = useState<number>(0);
  const [activeDispJob, setActiveDispJob] = useState<string | null>(null);
  const [activeRequestJob, setActiveRequestJob] = useState<string | null>(null);
  const [requestUnit, setRequestUnit] = useState<'KGS' | 'PCS'>('KGS');
  const [requestQty, setRequestQty] = useState<number>(0);
  const [requestRemarks, setRequestRemarks] = useState<string>('');
  const [activeResendJob, setActiveResendJob] = useState<string | null>(null);
  const [resendQty, setResendQty] = useState<number>(0);
  const [resendRemarks, setResendRemarks] = useState<string>('');

  // Storekeeper issue states
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [issueWeight, setIssueWeight] = useState<number>(0);
  const [issueRack, setIssueRack] = useState<string>('');
  const [issueLoc, setIssueLoc] = useState<string>('');
  const [issueRemarksState, setIssueRemarksState] = useState<string>('');
  const [activeIssueRejectionId, setActiveIssueRejectionId] = useState<string | null>(null);
  const [issueRejectionNotes, setIssueRejectionNotes] = useState<string>('');

  // Raw Material Store states
  const [activeRawRequestJob, setActiveRawRequestJob] = useState<string | null>(null);
  const [selectedRawMaterial, setSelectedRawMaterial] = useState<string>('');
  const [rawRequestQty, setRawRequestQty] = useState<number>(0);
  const [rawRequestRemarks, setRawRequestRemarks] = useState<string>('');

  const [activeRawIssueId, setActiveRawIssueId] = useState<string | null>(null);
  const [rawIssueWeight, setRawIssueWeight] = useState<number>(0);
  const [rawIssueLoc, setRawIssueLoc] = useState<string>('');
  const [rawIssueRemarks, setRawIssueRemarks] = useState<string>('');
  const [activeRawIssueRejectionId, setActiveRawIssueRejectionId] = useState<string | null>(null);
  const [rawIssueRejectionNotes, setRawIssueRejectionNotes] = useState<string>('');
  const [showRawMaterialRequestModal, setShowRawMaterialRequestModal] = useState<boolean>(false);
  const [selectedJobCardForRMRequest, setSelectedJobCardForRMRequest] = useState<string | null>(null);

  // Direct Wire Rejection in Raw Material Store state
  const [showWireRejectionModal, setShowWireRejectionModal] = useState<boolean>(false);
  const [selectedRejectMaterialCode, setSelectedRejectMaterialCode] = useState<string>('MS-WC');
  const [wireRejectQty, setWireRejectQty] = useState<number>(0);
  const [wireRejectReason, setWireRejectReason] = useState<string>('Corroded / Rusted Wire Coil');
  const [wireRejectJobCardNo, setWireRejectJobCardNo] = useState<string>('');
  const [wireRejectRemarks, setWireRejectRemarks] = useState<string>('');
  const [isSubmittingWireRejection, setIsSubmittingWireRejection] = useState<boolean>(false);

  const handleDirectWireRejection = async () => {
    if (!selectedRejectMaterialCode || wireRejectQty <= 0) {
      alert('Please select a raw material wire code and enter a valid rejection quantity (KG).');
      return;
    }
    const matched = INVENTORY_RAW_MATERIALS.find(m => m.code === selectedRejectMaterialCode);
    const matName = matched ? matched.name : selectedRejectMaterialCode;

    setIsSubmittingWireRejection(true);
    try {
      const jobNo = wireRejectJobCardNo.trim() || (`RM-REJECT-${selectedRejectMaterialCode}`);
      await onCreateMovement({
        jobCardNo: jobNo,
        fromDepartment: 'Raw Material Store',
        toDepartment: 'Raw Material Store',
        quantity: wireRejectQty,
        isIssueRequest: true,
        issueStatus: 'Rejected',
        processDetails: {
          rawMaterialCode: selectedRejectMaterialCode,
          rawMaterialName: matName,
          isWireRejection: true,
          rejectedQty: wireRejectQty,
          rejectionReason: wireRejectReason,
          requestedBy: currentUser?.name || 'Raw Material Store Keeper',
          urgency: 'High'
        },
        remarks: `🚫 Wire Quantity Rejected: ${wireRejectQty} KG (${wireRejectReason}). Deducted automatically from raw material store inventory. Notes: ${wireRejectRemarks || 'Direct Store Rejection'}`
      });

      setShowWireRejectionModal(false);
      setWireRejectQty(0);
      setWireRejectRemarks('');
      setWireRejectJobCardNo('');
      alert(`✅ Wire rejection of ${wireRejectQty} KG recorded for ${selectedRejectMaterialCode}. Store inventory reduced automatically.`);
    } catch (err) {
      console.error("Error submitting wire rejection:", err);
      alert("Failed to submit wire rejection. Please try again.");
    } finally {
      setIsSubmittingWireRejection(false);
    }
  };

  const filteredItems = savedItems.filter(item => 
    item.itemName.toLowerCase().includes(itemName.toLowerCase())
  );

  const filteredPurchaseItems = savedItems.filter(item => 
    item.itemName.toLowerCase().includes(purchaseItemName.toLowerCase())
  );

  const handleRawMaterialModalSubmit = async (request: {
    jobCardNo: string;
    rawMaterialCode: string;
    rawMaterialName: string;
    quantity: number;
    urgency: 'Low' | 'Medium' | 'High' | 'Critical';
    remarks: string;
  }) => {
    await onCreateMovement({
      jobCardNo: request.jobCardNo,
      fromDepartment: 'Raw Material Store',
      toDepartment: 'Production',
      quantity: request.quantity,
      remarks: request.remarks,
      isIssueRequest: true,
      requestedUnit: 'KGS',
      requestedQty: request.quantity,
      processDetails: {
        rawMaterialCode: request.rawMaterialCode,
        rawMaterialName: request.rawMaterialName,
        requestedBy: currentUser.name || 'Production Operator',
        urgency: request.urgency
      } as any
    } as any);
  };

  // --- ACTIONS ---
  const handleAddItemToOrder = () => {
    const numQty = typeof orderQty === 'number' ? orderQty : (parseInt(String(orderQty), 10) || 0);
    if (!itemName.trim() || numQty <= 0) {
      alert("Please specify Item Name and a valid Quantity.");
      return;
    }
    // Add to multiItems state
    setMultiItems(prev => [
      ...prev,
      {
        itemName: itemName.trim(),
        itemCode: itemCode.trim() ? itemCode.trim().toUpperCase() : '-',
        orderQty: numQty,
        htRequired,
        remarks: dispatchRemarks.trim() || undefined
      }
    ]);
    // Reset item fields so next item can be added quickly
    setItemName('');
    setItemCode('');
    setOrderQty(1000);
    setHtRequired(false);
    setDispatchRemarks('');
  };

  const handleRemoveItemFromOrder = (index: number) => {
    setMultiItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim()) {
      alert("Please specify Customer / Party Name.");
      return;
    }

    const numQty = typeof orderQty === 'number' ? orderQty : (parseInt(String(orderQty), 10) || 0);

    if (multiItems.length === 0) {
      // Backwards compatibility/fallback: place the single item entered currently in the fields
      if (!itemName || numQty <= 0) {
        alert("Please add at least one item to the order list, or fill in item details to register.");
        return;
      }

      onCreateJobCard({
        partyName: partyName.trim(),
        itemName: itemName.trim(),
        itemCode: itemCode.trim() ? itemCode.trim().toUpperCase() : '-',
        orderQty: numQty,
        heatTreatmentRequired: processType === 'Purchase' ? false : htRequired,
        currentQty: numQty,
        currentDepartment: processType === 'Purchase' ? 'Purchase' : 'Production',
        status: 'Pending',
        processType
      });

      // Reset
      setPartyName('');
      setItemName('');
      setItemCode('');
      setOrderQty(1000);
      setHtRequired(false);
      setDispatchRemarks('');
    } else {
      // Place all items in the multiItems list
      const jobs = multiItems.map(item => ({
        partyName: partyName.trim(),
        itemName: item.itemName,
        itemCode: item.itemCode,
        orderQty: item.orderQty,
        heatTreatmentRequired: item.htRequired,
        currentQty: item.orderQty,
        currentDepartment: 'Production',
        status: 'Pending',
        processType: 'Manufacturing'
      }));

      onCreateJobCard(jobs);

      // Reset
      setMultiItems([]);
      setPartyName('');
      setItemName('');
      setItemCode('');
      setOrderQty(1000);
      setHtRequired(false);
      setDispatchRemarks('');
    }
  };

  const handleAddItemToPurchase = () => {
    const recNum = typeof purchaseRecQty === 'number' ? purchaseRecQty : (parseInt(String(purchaseRecQty), 10) || 0);
    const rejNum = typeof purchaseRejQty === 'number' ? purchaseRejQty : (parseInt(String(purchaseRejQty), 10) || 0);

    if (!purchaseItemName.trim() || recNum <= 0) {
      alert("Please specify Item Name and Received Quantity.");
      return;
    }
    if (purchaseSentQty > recNum) {
      alert(`Error: Sent quantity (${purchaseSentQty} KG) cannot exceed the received quantity (${recNum} KG).`);
      return;
    }
    if (purchaseSentQty + rejNum > recNum) {
      alert(`Error: Combined sent quantity (${purchaseSentQty} KG) and rejection quantity (${rejNum} KG) cannot exceed the received quantity (${recNum} KG).`);
      return;
    }

    setPurchaseMultiItems(prev => [
      ...prev,
      {
        itemName: purchaseItemName.trim(),
        itemCode: purchaseItemCode.trim() ? purchaseItemCode.trim().toUpperCase() : '-',
        recQty: recNum,
        rejQty: rejNum,
        sentQty: purchaseSentQty,
        unit: purchaseMaterialType === 'Finished Goods' ? purchaseUnit : 'KGS',
        materialType: purchaseMaterialType,
        targetDept: purchaseTargetDept,
        remarks: purchaseRemarks.trim() || undefined
      }
    ]);

    // Reset item fields
    setPurchaseItemName('');
    setPurchaseItemCode('');
    setPurchaseRemarks('');
    setPurchaseRecQty('');
    setPurchaseRejQty(0);
    setPurchaseSentQty(0);
    setPurchaseUnit('KGS');
    // Reset to Raw Material default
    setPurchaseMaterialType('Raw Material');
    setPurchaseTargetDept('Raw Material Store');
  };

  const handleRemoveItemFromPurchase = (index: number) => {
    setPurchaseMultiItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleDirectPurchaseEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseSupplier.trim()) {
      alert("Please specify Supplier / Vendor Name.");
      return;
    }

    const recNum = typeof purchaseRecQty === 'number' ? purchaseRecQty : (parseInt(String(purchaseRecQty), 10) || 0);
    const rejNum = typeof purchaseRejQty === 'number' ? purchaseRejQty : (parseInt(String(purchaseRejQty), 10) || 0);

    // If linked to an Outsource Order, update the Outsource Order in DB first
    let linkedOrder: OutsourceOrder | undefined = undefined;
    if (selectedOutsourceOrderId) {
      linkedOrder = outsourceOrders.find(o => o.orderId === selectedOutsourceOrderId);
      if (linkedOrder) {
        try {
          await DBService.updateOutsourceOrder(
            linkedOrder.orderId,
            {
              status: 'Completed',
              supplierName: purchaseSupplier.trim(),
              receivedQty: recNum || linkedOrder.orderQty,
              receivedAt: new Date().toISOString(),
              receivedChallanNo: purchaseBill || `CH-${Date.now().toString().slice(-5)}`,
              receivedMaterialType: purchaseMaterialType as OutsourceMaterialType,
              targetDepartmentAfterReceipt: purchaseTargetDept,
              receiptRemarks: `Direct Purchase Entry by Purchaser (${currentUser.name}): ${purchaseRemarks || 'Material received and routed to next process.'}`,
              receivedByUserId: currentUser.userId,
              receivedByUserName: currentUser.name
            },
            currentUser.userId,
            currentUser.name
          );

          // Refresh outsource orders
          const updated = await DBService.getOutsourceOrders();
          setOutsourceOrders(updated);
        } catch (err) {
          console.error("Failed to update outsource order from direct purchase entry:", err);
        }
      }
    }

    if (purchaseMultiItems.length === 0) {
      // Fallback/backwards compatibility: register current form values as single item
      if (!purchaseItemName || recNum <= 0) {
        alert("Please add at least one item to the purchase list, or fill in item details.");
        return;
      }

      if (purchaseSentQty > recNum) {
        alert(`Error: Sent quantity (${purchaseSentQty} KG) cannot exceed the received quantity (${recNum} KG).`);
        return;
      }
      if (purchaseSentQty + rejNum > recNum) {
        alert(`Error: Combined sent quantity (${purchaseSentQty} KG) and rejection quantity (${rejNum} KG) cannot exceed the received quantity (${recNum} KG).`);
        return;
      }

      const effectiveCode = purchaseItemCode.trim() ? purchaseItemCode.trim().toUpperCase() : '-';

      // Check if linked order has an existing job card in current production list
      const existingJob = linkedOrder?.jobCardNo ? jobCards.find(j => j.jobCardNo.toLowerCase() === linkedOrder!.jobCardNo!.toLowerCase()) : null;

      if (existingJob) {
        // Move existing job card directly to target department!
        onUpdateJobCard(existingJob.jobCardNo, {
          currentDepartment: purchaseTargetDept,
          currentQty: purchaseSentQty,
          status: 'Pending Acceptance'
        });
        onCreateMovement({
          jobCardNo: existingJob.jobCardNo,
          fromDepartment: 'Purchase',
          toDepartment: purchaseTargetDept,
          quantity: purchaseSentQty,
          remarks: `Outsource Order ${linkedOrder?.orderId} material inwarded via Purchase (Supplier: ${purchaseSupplier}, Bill/Challan: ${purchaseBill || 'N/A'}). Routed to ${purchaseTargetDept}.`
        });
      } else if (purchaseMaterialType === 'Raw Material' || purchaseTargetDept === 'Raw Material Store') {
        onCreateMovement({
          jobCardNo: 'STOCK-IN-' + (effectiveCode !== '-' ? effectiveCode : Date.now().toString().slice(-6)),
          fromDepartment: 'Purchase',
          toDepartment: 'Raw Material Store',
          quantity: purchaseSentQty,
          remarks: `Direct Purchase / Outsource Inward of Raw Material (Supplier: ${purchaseSupplier}, Bill: ${purchaseBill || 'N/A'}). ${selectedOutsourceOrderId ? `Linked Outsource Order: ${selectedOutsourceOrderId}` : ''}`,
          processDetails: {
            rawMaterialCode: effectiveCode,
            rawMaterialName: purchaseItemName.trim(),
            supplierName: purchaseSupplier,
            billNo: purchaseBill
          } as any
        });
      } else {
        onCreateJobCard({
          partyName: purchaseSupplier.trim(),
          itemName: purchaseItemName.trim(),
          itemCode: effectiveCode,
          orderQty: recNum,
          unit: purchaseMaterialType === 'Finished Goods' ? purchaseUnit : 'KGS',
          heatTreatmentRequired: purchaseTargetDept === 'Heat Treatment',
          currentQty: purchaseSentQty,
          currentDepartment: purchaseTargetDept,
          status: 'Pending Acceptance',
          processType: 'Purchase',
          materialType: purchaseMaterialType,
          purchaseDetails: {
            supplierName: purchaseSupplier.trim(),
            billNo: purchaseBill,
            receivedQty: recNum,
            rejectionQty: rejNum,
            sentToStore: purchaseSentQty,
            remarks: purchaseRemarks,
            materialType: purchaseMaterialType,
            unit: purchaseMaterialType === 'Finished Goods' ? purchaseUnit : 'KGS'
          }
        });
      }

      // Reset Form
      setSelectedOutsourceOrderId('');
      setPurchaseSupplier('');
      setPurchaseBill('');
      setPurchaseItemName('');
      setPurchaseItemCode('');
      setPurchaseRemarks('');
      setPurchaseRecQty(0);
      setPurchaseRejQty(0);
      setPurchaseSentQty(0);
      setPurchaseUnit('KGS');
      setPurchaseMaterialType('Raw Material');
      setPurchaseTargetDept('Raw Material Store');
    } else {
      // Multiple items! We can have both raw material movements and job cards.
      const movements: any[] = [];
      const jobCards: any[] = [];

      for (const item of purchaseMultiItems) {
        if (item.materialType === 'Raw Material' || item.targetDept === 'Raw Material Store') {
          movements.push({
            jobCardNo: 'STOCK-IN-' + item.itemCode,
            fromDepartment: 'Purchase',
            toDepartment: 'Raw Material Store',
            quantity: item.sentQty,
            remarks: `Direct Purchase Inward of Raw Material (Supplier: ${purchaseSupplier.trim()}, Bill: ${purchaseBill || 'N/A'}). Remarks: ${item.remarks || 'None'}`,
            processDetails: {
              rawMaterialCode: item.itemCode,
              rawMaterialName: item.itemName,
              supplierName: purchaseSupplier.trim(),
              billNo: purchaseBill
            } as any
          });
        } else {
          jobCards.push({
            partyName: purchaseSupplier.trim(),
            itemName: item.itemName,
            itemCode: item.itemCode,
            orderQty: item.recQty,
            unit: item.unit,
            heatTreatmentRequired: item.targetDept === 'Heat Treatment',
            currentQty: item.sentQty,
            currentDepartment: item.targetDept,
            status: 'Pending Acceptance',
            processType: 'Purchase',
            materialType: item.materialType,
            purchaseDetails: {
              supplierName: purchaseSupplier.trim(),
              billNo: purchaseBill,
              receivedQty: item.recQty,
              rejectionQty: item.rejQty,
              sentToStore: item.sentQty,
              remarks: item.remarks || '',
              materialType: item.materialType,
              unit: item.unit
            }
          });
        }
      }

      if (movements.length > 0) {
        onCreateMovement(movements);
      }
      if (jobCards.length > 0) {
        onCreateJobCard(jobCards);
      }

      // Reset
      setPurchaseMultiItems([]);
      setPurchaseSupplier('');
      setPurchaseBill('');
      setPurchaseItemName('');
      setPurchaseItemCode('');
      setPurchaseRemarks('');
      setPurchaseRecQty(0);
      setPurchaseRejQty(0);
      setPurchaseSentQty(0);
      setPurchaseUnit('KGS');
      setPurchaseMaterialType('Raw Material');
      setPurchaseTargetDept('Raw Material Store');
    }
  };

  // Switch status for purchase start
  const handleStartPurchase = (jCard: JobCard) => {
    onUpdateJobCard(jCard.jobCardNo, { status: 'In Process' });
  };

  const handleCompletePurchase = (jCard: JobCard) => {
    if (!purchaseSupplier || purchaseSentQty <= 0) return;

    if (purchaseSentQty > purchaseRecQty) {
      alert(`Error: Sent quantity (${purchaseSentQty} KG) cannot exceed the received quantity (${purchaseRecQty} KG).`);
      return;
    }
    if (purchaseSentQty + purchaseRejQty > purchaseRecQty) {
      alert(`Error: Combined sent quantity (${purchaseSentQty} KG) and rejection quantity (${purchaseRejQty} KG) cannot exceed the received quantity (${purchaseRecQty} KG).`);
      return;
    }

    onUpdateJobCard(jCard.jobCardNo, {
      materialType: purchaseMaterialType,
      purchaseDetails: {
        supplierName: purchaseSupplier,
        billNo: purchaseBill,
        receivedQty: purchaseRecQty,
        rejectionQty: purchaseRejQty,
        sentToStore: purchaseSentQty,
        remarks: purchaseRemarks,
        materialType: purchaseMaterialType
      },
      currentQty: purchaseSentQty,
      balanceQty: Math.max(0, (jCard.balanceQty ?? jCard.orderQty) - purchaseRejQty),
      heatTreatmentRequired: jCard.heatTreatmentRequired || purchaseTargetDept === 'Heat Treatment'
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Purchase',
      toDepartment: purchaseTargetDept, // Dynamically route to selected department
      quantity: purchaseSentQty,
      remarks: `Material inwarded from supplier: ${purchaseSupplier}. Received: ${purchaseRecQty} KG, Dispatched to ${purchaseTargetDept}: ${purchaseSentQty} KG, Rejections: ${purchaseRejQty} KG. Remarks: ${purchaseRemarks}`
    });

    setPurchaseSupplier('');
    setPurchaseBill('');
    setPurchaseRemarks('');
    setPurchaseRecQty(0);
    setPurchaseRejQty(0);
    setPurchaseSentQty(0);
    setActivePurchaseJob(null);
  };

  // Switch status for production start
  const handleStartProduction = (jCard: JobCard) => {
    const issuedQty = getRawMaterialIssuedQty(jCard, movements);
    if (isRawMaterialCompulsory && jCard.processType !== 'Purchase' && issuedQty <= 0) {
      const hasUnacceptedIssuedMaterial = movements.some(m => 
        m.jobCardNo.toLowerCase() === jCard.jobCardNo.toLowerCase() &&
        m.fromDepartment === 'Raw Material Store' &&
        m.toDepartment === 'Production' &&
        m.isIssueRequest &&
        m.issueStatus === 'Issued' &&
        !m.accepted
      );

      if (hasUnacceptedIssuedMaterial) {
        alert(`⚠️ Cannot Start Production:
Raw material has been issued by the Raw Material Store, but has NOT been accepted by the Production department yet.

To resolve:
1. Go to the "Incoming Ingress" tab on this Production Department Workbench.
2. Click "Accept Custody" on the issued raw material batch.
3. Return here to start production.`);
      } else {
        alert(`⚠️ Cannot Start Production:
Raw material has not been issued yet for Job Card ${jCard.jobCardNo}. 

To resolve:
1. Production team should request raw material for this Job Card.
2. Raw Material Store must approve and issue the requested weight.`);
      }
      return;
    }
    onUpdateJobCard(jCard.jobCardNo, { status: 'In Process' });
  };

  const handleCompleteProduction = (jCard: JobCard) => {
    if (!prodOpName || prodQty <= 0) return;

    const issuedQty = getRawMaterialIssuedQty(jCard, movements);
    const totalMovedFromProdBefore = movements
      .filter(m => m.jobCardNo.toLowerCase() === jCard.jobCardNo.toLowerCase() && m.fromDepartment === 'Production')
      .reduce((sum, m) => sum + m.quantity, 0);
    const totalProducedIncludingCurrent = totalMovedFromProdBefore + prodQty;

    if (isRawMaterialCompulsory && jCard.processType !== 'Purchase' && totalProducedIncludingCurrent > issuedQty) {
      const hasUnacceptedIssuedMaterial = movements.some(m => 
        m.jobCardNo.toLowerCase() === jCard.jobCardNo.toLowerCase() &&
        m.fromDepartment === 'Raw Material Store' &&
        m.toDepartment === 'Production' &&
        m.isIssueRequest &&
        m.issueStatus === 'Issued' &&
        !m.accepted
      );

      if (hasUnacceptedIssuedMaterial) {
        alert(`⚠️ Cannot Log Production:
Raw material has been issued by the Raw Material Store, but has NOT been accepted by the Production department yet.

To resolve:
1. Go to the "Incoming Ingress" tab on this Production Department Workbench.
2. Click "Accept Custody" on the issued raw material batch.
3. Return here to log production.`);
      } else {
        alert(`⚠️ Exceeded Raw Material Limit:
Total logged production (${totalProducedIncludingCurrent} KG) cannot exceed the issued raw material quantity (${issuedQty} KG).

• Issued Raw Material: ${issuedQty} KG
• Production logged so far: ${totalMovedFromProdBefore} KG
• Trying to log now: ${prodQty} KG
• Maximum allowed production now: ${Math.max(0, issuedQty - totalMovedFromProdBefore)} KG

Please adjust the quantity or request additional raw material issue.`);
      }
      return;
    }

    // Update job card specs & cumulative wire scrap
    const prevWireScrap = getWireScrapQty(jCard, movements);
    const totalWireScrap = prevWireScrap + prodWireScrap;

    onUpdateJobCard(jCard.jobCardNo, {
      operatorName: prodOpName,
      currentQty: prodQty,
      wireScrapQty: totalWireScrap,
      productionDetails: {
        operatorName: prodOpName,
        producedQty: (jCard.productionDetails?.producedQty || 0) + prodQty,
        wireScrapQty: totalWireScrap,
        wireScrapReason: prodWireScrapReason,
        remarks: prodWireScrap > 0 ? `Produced: ${prodQty} KG, Wire Scrap: ${prodWireScrap} KG (${prodWireScrapReason})` : undefined
      },
      // Formula: Balance = Order Qty - Overall Processed Qty
      balanceQty: Math.max(0, jCard.orderQty - totalProducedIncludingCurrent)
    });

    // Determine target department
    const targetDept: Department = jCard.heatTreatmentRequired ? 'Heat Treatment' : 'Plating';

    // Spawn material movement
    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Production',
      toDepartment: targetDept,
      quantity: prodQty,
      processDetails: {
        operatorName: prodOpName,
        producedQty: prodQty,
        wireScrapQty: prodWireScrap,
        wireScrapReason: prodWireScrapReason
      },
      remarks: `Produced by ${prodOpName}: ${prodQty} KG.${prodWireScrap > 0 ? ` Wire scrap logged: ${prodWireScrap} KG (${prodWireScrapReason}).` : ''} Sent to ${targetDept}.`
    });

    // Clear state
    setProdOpName('');
    setProdQty(0);
    setProdWireScrap(0);
    setProdWireScrapReason('Heading & Cut-Off Waste');
    setActiveProdJob(null);
  };

  const handleResendToProduction = (jCard: JobCard, qty: number, remarks: string) => {
    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Dispatch',
      toDepartment: 'Production',
      quantity: qty,
      remarks: remarks || 'Order resent to Production by Dispatch.'
    });
    // Clear resend state
    setActiveResendJob(null);
    setResendQty(0);
    setResendRemarks('');
  };

  const handleCompleteHeatTreatment = (jCard: JobCard) => {
    const receivedFromProd = htQtyReceived;
    const sentToPlating = htQtySentToPlating;

    if (sentToPlating > receivedFromProd) {
      alert(`Error: Sent quantity (${sentToPlating} KG) cannot exceed the received quantity (${receivedFromProd} KG).`);
      return;
    }
    if (sentToPlating + htRejectionQty > receivedFromProd) {
      alert(`Error: Combined sent quantity (${sentToPlating} KG) and rejection quantity (${htRejectionQty} KG) cannot exceed the received quantity (${receivedFromProd} KG).`);
      return;
    }

    const remainingQty = Math.max(0, receivedFromProd - sentToPlating - htRejectionQty);

    const prevHT = jCard.heatTreatmentDetails;
    const totalRejectionInHT = (prevHT?.rejectionQty || 0) + htRejectionQty;
    onUpdateJobCard(jCard.jobCardNo, {
      customRoutedToPlating: (jCard.customRoutedToPlating || 0) + sentToPlating,
      balanceQty: Math.max(0, (jCard.balanceQty ?? jCard.orderQty) - htRejectionQty),
      heatTreatmentDetails: {
        hardnessRequired: htHardness,
        temperature: htTemp,
        cycleTime: htDuration,
        rejectionQty: totalRejectionInHT,
        qtyReceivedFromProd: (prevHT?.qtyReceivedFromProd || 0) + receivedFromProd,
        qtySentToPlating: (prevHT?.qtySentToPlating || 0) + sentToPlating,
        qtyRemaining: remainingQty
      }
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Heat Treatment',
      toDepartment: 'Plating',
      quantity: sentToPlating,
      remarks: `Completed furnace cycle. Hardness: ${htHardness}. Recv: ${receivedFromProd} KG, Sent to Plating: ${sentToPlating} KG, Rejections: ${htRejectionQty} KG, Remaining: ${remainingQty} KG.`
    });

    setHtRejectionQty(0);
    setHtQtyReceived(0);
    setHtQtySentToPlating(0);
    setActiveHtJob(null);
  };

  const handleCompletePlating = (jCard: JobCard) => {
    const receivedFromHt = platingQtyReceived;
    const sentToPacking = platingQtySentToPacking;

    if (sentToPacking > receivedFromHt) {
      alert(`Error: Sent quantity (${sentToPacking} KG) cannot exceed the received quantity (${receivedFromHt} KG).`);
      return;
    }
    if (sentToPacking + platingRejectionQty > receivedFromHt) {
      alert(`Error: Combined sent quantity (${sentToPacking} KG) and rejection quantity (${platingRejectionQty} KG) cannot exceed the received quantity (${receivedFromHt} KG).`);
      return;
    }

    const remainingQty = Math.max(0, receivedFromHt - sentToPacking - platingRejectionQty);

    const prevPlating = jCard.platingDetails;
    const totalRejectionInPlating = (prevPlating?.rejectionQty || 0) + platingRejectionQty;
    onUpdateJobCard(jCard.jobCardNo, {
      customRoutedToPacking: (jCard.customRoutedToPacking || 0) + sentToPacking,
      balanceQty: Math.max(0, (jCard.balanceQty ?? jCard.orderQty) - platingRejectionQty),
      platingDetails: {
        platingType,
        micronThickness: platingThick,
        durationMinutes: platingDur,
        rejectionQty: totalRejectionInPlating,
        qtyReceivedFromHt: (prevPlating?.qtyReceivedFromHt || 0) + receivedFromHt,
        qtySentToPacking: (prevPlating?.qtySentToPacking || 0) + sentToPacking,
        qtyRemaining: remainingQty
      }
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Plating',
      toDepartment: 'Packing',
      quantity: sentToPacking,
      remarks: `Coating thickness ${platingThick} verified. Zinc plating cycle complete. Recv from HT: ${receivedFromHt} KG, Sent for Packing: ${sentToPacking} KG, Rejections: ${platingRejectionQty} KG, Remaining Balance: ${remainingQty} KG.`
    });

    setPlatingRejectionQty(0);
    setPlatingQtyReceived(0);
    setPlatingQtySentToPacking(0);
    setActivePlatingJob(null);
  };

  const handleCompletePacking = (jCard: JobCard) => {
    const receivedFromPlating = packQtyReceived;
    const sentToStore = packQtySentToStore;

    if (sentToStore > receivedFromPlating) {
      alert(`Error: Sent quantity (${sentToStore} KG) cannot exceed the received quantity (${receivedFromPlating} KG).`);
      return;
    }
    if (sentToStore + packRejectionQty > receivedFromPlating) {
      alert(`Error: Combined sent quantity (${sentToStore} KG) and rejection quantity (${packRejectionQty} KG) cannot exceed the received quantity (${receivedFromPlating} KG).`);
      return;
    }

    const remainingQty = Math.max(0, receivedFromPlating - sentToStore - packRejectionQty);

    const prevPacking = jCard.packingDetails;
    const totalPackedIncludingCurrent = (prevPacking?.qtySentToStore || 0) + sentToStore;

    const htRejectionTotal = jCard.heatTreatmentDetails?.rejectionQty || 0;
    const platingRejectionTotal = jCard.platingDetails?.rejectionQty || 0;
    const packingRejectionTotal = (prevPacking?.rejectionQty || 0) + packRejectionQty;
    const totalRejections = htRejectionTotal + platingRejectionTotal + packingRejectionTotal;

    onUpdateJobCard(jCard.jobCardNo, {
      customRoutedToStore: (jCard.customRoutedToStore || 0) + sentToStore,
      packingDetails: {
        packedQty: totalPackedIncludingCurrent,
        boxCount: (prevPacking?.boxCount || 0) + packBoxCount,
        packingType: packStyle,
        rejectionQty: packingRejectionTotal,
        qtyReceivedFromPlating: (prevPacking?.qtyReceivedFromPlating || 0) + receivedFromPlating,
        qtySentToStore: totalPackedIncludingCurrent,
        qtyRemaining: remainingQty,
        pcsPerBagOrBox: packPcsPerBagOrBox,
        totalPcs: (prevPacking?.totalPcs || 0) + packTotalPcs,
      },
      currentQty: sentToStore,
      balanceQty: Math.max(0, jCard.orderQty - totalPackedIncludingCurrent - totalRejections)
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Packing',
      toDepartment: 'Store',
      quantity: sentToStore,
      remarks: `Packed in ${packBoxCount} boxes (${packPcsPerBagOrBox} pcs/box, Total: ${packTotalPcs} pcs). Quality verified. Recv from Plating: ${receivedFromPlating} KG, Sent to Store: ${sentToStore} KG, Rejections: ${packRejectionQty} KG, Remaining: ${remainingQty} KG.`
    });

    setPackRejectionQty(0);
    setPackQtyReceived(0);
    setPackQtySentToStore(0);
    setActivePackingJob(null);
  };

  const handleCompleteStore = (jCard: JobCard) => {
    const receivedFromPacking = storeQtyReceived;
    const sentToNext = storeQtySentToDispatch;

    if (sentToNext > receivedFromPacking) {
      alert(`Error: Sent quantity (${sentToNext} KG) cannot exceed the received quantity (${receivedFromPacking} KG).`);
      return;
    }
    if (sentToNext + storeRejectionQty > receivedFromPacking) {
      alert(`Error: Combined sent quantity (${sentToNext} KG) and rejection quantity (${storeRejectionQty} KG) cannot exceed the received quantity (${receivedFromPacking} KG).`);
      return;
    }

    const remainingQty = Math.max(0, receivedFromPacking - sentToNext - storeRejectionQty);
    const targetDept = jCard.processType === 'Purchase' ? storeTargetDept : 'Dispatch';

    onUpdateJobCard(jCard.jobCardNo, {
      storeDetails: {
        verifiedQty: sentToNext,
        locationBin: storeBinLoc,
        rejectionQty: storeRejectionQty,
        qtyReceivedFromPacking: receivedFromPacking,
        qtySentToDispatch: targetDept === 'Dispatch' ? sentToNext : 0,
        qtyRemaining: remainingQty,
        pcsPerBagOrBox: jCard.packingDetails?.pcsPerBagOrBox,
        totalPcs: jCard.packingDetails?.totalPcs,
      },
      currentQty: sentToNext,
      balanceQty: Math.max(0, jCard.orderQty - sentToNext)
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Store',
      toDepartment: targetDept, // Dynamic transit target: Packing or Dispatch
      quantity: sentToNext,
      remarks: `Stored in bin location: ${storeBinLoc}. Recv: ${receivedFromPacking} KG, Sent to ${targetDept}: ${sentToNext} KG, Rejections: ${storeRejectionQty} KG, Remaining Qty: ${remainingQty} KG.`
    });

    setStoreRejectionQty(0);
    setStoreQtyReceived(0);
    setStoreQtySentToDispatch(0);
    setActiveStoreJob(null);
  };

  const handleCompleteRawStore = (jCard: JobCard) => {
    const receivedFromPurchase = storeQtyReceived;
    const sentToNext = storeQtySentToDispatch;

    if (sentToNext > receivedFromPurchase) {
      alert(`Error: Sent quantity (${sentToNext} KG) cannot exceed the received quantity (${receivedFromPurchase} KG).`);
      return;
    }
    if (sentToNext + storeRejectionQty > receivedFromPurchase) {
      alert(`Error: Combined sent quantity (${sentToNext} KG) and rejection quantity (${storeRejectionQty} KG) cannot exceed the received quantity (${receivedFromPurchase} KG).`);
      return;
    }

    const remainingQty = Math.max(0, receivedFromPurchase - sentToNext - storeRejectionQty);
    const targetDept = 'Production';

    onUpdateJobCard(jCard.jobCardNo, {
      currentQty: sentToNext,
      balanceQty: Math.max(0, jCard.orderQty - sentToNext),
      storeDetails: {
        verifiedQty: sentToNext,
        locationBin: storeBinLoc,
        rejectionQty: storeRejectionQty,
        qtyReceivedFromPacking: receivedFromPurchase,
        qtySentToDispatch: 0,
        qtyRemaining: remainingQty,
      }
    });

    onCreateMovement({
      jobCardNo: jCard.jobCardNo,
      fromDepartment: 'Raw Material Store',
      toDepartment: targetDept,
      quantity: sentToNext,
      remarks: `Raw material released from Raw Store bin location: ${storeBinLoc}. Recv: ${receivedFromPurchase} KG, Issued to Production: ${sentToNext} KG, Rejections: ${storeRejectionQty} KG, Remaining Qty: ${remainingQty} KG.`
    });

    setStoreRejectionQty(0);
    setStoreQtyReceived(0);
    setStoreQtySentToDispatch(0);
    setActiveRawStoreJob(null);
  };

  const handleFinalizeDispatch = (jCard: JobCard) => {
    if (dispQty <= 0 || !dispInvoice || !dispVehicle) return;

    // Update job card dispatch log and close order
    onUpdateJobCard(jCard.jobCardNo, {
      completed: true,
      status: 'Completed',
      currentQty: dispQty,
      balanceQty: Math.max(0, jCard.orderQty - dispQty),
      dispatchDetails: {
        invoiceNo: dispInvoice,
        vehicleNo: dispVehicle,
        dispatchQty: dispQty,
        dispatchDate: new Date().toISOString(),
        remarks: `Outbound loaded onto ${dispVehicle}. Bill of lading issued.`
      }
    });

    // Mark corresponding last movement targeting Dispatch as accepted
    const transitMov = movements.find(m => m.jobCardNo.toLowerCase() === jCard.jobCardNo.toLowerCase() && m.toDepartment === 'Dispatch' && !m.accepted);
    if (transitMov) {
      onAcceptMovement(transitMov.movementId, `Dispatched via Invoice ${dispInvoice}`);
    }

    setActiveDispJob(null);
  };

  const handleLocalAccept = async (mov: MaterialMovement) => {
    // 1. Mark as animating
    setAcceptedMovementIds(prev => ({ ...prev, [mov.movementId]: 'animating' }));
    
    // 2. Play subtle vibration pattern if supported
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(55); } catch (_) {}
    }

    // 3. Delay to let acceptance animation play out before database update triggers deletion
    setTimeout(async () => {
      try {
        if (activeDept === 'Store' || activeDept === 'Raw Material Store') {
          if (mov.fromDepartment === 'Purchase' && purchaseIncomingRouting[mov.movementId] === 'Packing') {
            await onAcceptMovement(mov.movementId);
            onCreateMovement({
              jobCardNo: mov.jobCardNo,
              fromDepartment: 'Store',
              toDepartment: 'Packing',
              quantity: mov.quantity,
              remarks: `Auto-routed purchased material from Store custody to Packing.`
            });
          } else {
            const loc = storeIncomingLocs[mov.movementId] || '';
            const rack = storeIncomingRacks[mov.movementId] || '';
            await onAcceptMovement(mov.movementId, undefined, { allottedLocation: loc, rackNo: rack });
          }
        } else {
          await onAcceptMovement(mov.movementId);
        }
        
        // Mark as done
        setAcceptedMovementIds(prev => ({ ...prev, [mov.movementId]: 'done' }));
      } catch (err) {
        console.error("Failed to accept movement:", err);
        // Revert UI state on error so user can try again
        setAcceptedMovementIds(prev => {
          const updated = { ...prev };
          delete updated[mov.movementId];
          return updated;
        });
      }
    }, 1150); // Beautiful ~1.15 second animation window
  };

  // --- FILTERED LISTS ---
  // A. Incoming Transfers waiting for acceptance inside this active department
  const incomingTransfers = movements.filter(m => {
    if (m.isIssueRequest && m.fromDepartment === 'Raw Material Store' && m.toDepartment === 'Production') {
      return activeDept === 'Production' && !m.accepted && m.issueStatus === 'Issued';
    }
    return m.toDepartment === activeDept && !m.accepted;
  });

  const pendingIssueRequests = movements.filter(m => {
    return m.isIssueRequest && m.fromDepartment === 'Store' && !m.accepted;
  });

  const pendingRawMaterialRequests = movements.filter(m => {
    return m.isIssueRequest && 
           m.fromDepartment === 'Raw Material Store' && 
           m.toDepartment === 'Production' && 
           !m.accepted && 
           m.issueStatus !== 'Issued' && 
           m.issueStatus !== 'Rejected';
  });

  // B. Job cards currently assigned to this department
  const activeDepartmentJobs = jobCards.filter(c => {
    if (c.completed) return false;
    
    // If the job card is pending custody acceptance BY THE CURRENT DEPARTMENT,
    // it shouldn't show up in the operational/processing queue until accepted.
    if (c.status === 'Pending Acceptance' && activeDept !== 'Dispatch') {
      const hasUnacceptedIncomingToMe = movements.some(m => 
        m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && 
        m.toDepartment === activeDept && 
        !m.accepted
      );
      if (hasUnacceptedIncomingToMe) {
        return false;
      }
    }
    // Dispatch owns tracking when completed or creating, otherwise matches exactly
    if (activeDept === 'Dispatch') {
      return true;
    }
    if (activeDept === 'Purchase') {
      const totalMovedFromPurchase = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.fromDepartment === 'Purchase')
        .reduce((sum, m) => sum + m.quantity, 0);
      const pendingPurchaseQty = c.orderQty - totalMovedFromPurchase;
      return (c.processType === 'Purchase' && (c.currentDepartment === 'Purchase' || pendingPurchaseQty > 0));
    }
    if (activeDept === 'Production') {
      const totalMovedFromProd = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.fromDepartment === 'Production')
        .reduce((sum, m) => sum + m.quantity, 0);
      const pendingProdQty = c.orderQty - totalMovedFromProd;
      return (c.processType === 'Manufacturing' && (c.currentDepartment === 'Production' || pendingProdQty > 0));
    }
    if (activeDept === 'Heat Treatment') {
      const totalReceivedAtHT = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.toDepartment === 'Heat Treatment' && m.accepted)
        .reduce((sum, m) => sum + m.quantity, 0);
      const totalRoutedFromHT = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.fromDepartment === 'Heat Treatment')
        .reduce((sum, m) => sum + m.quantity, 0);
      const pendingHTQty = totalReceivedAtHT - totalRoutedFromHT - (c.heatTreatmentDetails?.rejectionQty || 0);
      
      const isHTRequiredOrRouted = c.heatTreatmentRequired || totalReceivedAtHT > 0 || c.currentDepartment === 'Heat Treatment';
      if (!isHTRequiredOrRouted) return false;

      return c.currentDepartment === 'Heat Treatment' || (totalReceivedAtHT > 0 && pendingHTQty > 0);
    }
    if (activeDept === 'Plating') {
      const totalReceivedAtPlating = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.toDepartment === 'Plating' && m.accepted)
        .reduce((sum, m) => sum + m.quantity, 0);
      const totalRoutedFromPlating = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.fromDepartment === 'Plating')
        .reduce((sum, m) => sum + m.quantity, 0);
      const pendingPlatingQty = totalReceivedAtPlating - totalRoutedFromPlating - (c.platingDetails?.rejectionQty || 0);
      return c.currentDepartment === 'Plating' || (totalReceivedAtPlating > 0 && pendingPlatingQty > 0);
    }
    if (activeDept === 'Packing') {
      const totalReceivedAtPacking = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.toDepartment === 'Packing' && m.accepted)
        .reduce((sum, m) => sum + m.quantity, 0);
      const totalRoutedFromPacking = movements
        .filter(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && m.fromDepartment === 'Packing')
        .reduce((sum, m) => sum + m.quantity, 0);
      const pendingPackingQty = totalReceivedAtPacking - totalRoutedFromPacking - (c.packingDetails?.rejectionQty || 0);
      return c.currentDepartment === 'Packing' || (totalReceivedAtPacking > 0 && pendingPackingQty > 0);
    }
    return c.currentDepartment === activeDept;
  });

  // Calculate WIP quantity for each job in the active department
  const getJobWipQtyForDept = (job: JobCard): number => {
    if (activeDept === 'Purchase') {
      const totalMovedFromPurchase = movements
        .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Purchase')
        .reduce((sum, m) => sum + m.quantity, 0);
      return Math.max(0, job.orderQty - totalMovedFromPurchase);
    }
    if (activeDept === 'Production') {
      const totalMovedFromProd = movements
        .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Production')
        .reduce((sum, m) => sum + m.quantity, 0);
      return Math.max(0, job.orderQty - totalMovedFromProd);
    }
    if (activeDept === 'Heat Treatment') {
      const m = getJobCardProcessMetrics(job, movements);
      const totalReceivedAtHT = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Heat Treatment' && mov.accepted)
        .reduce((sum, mov) => sum + mov.quantity, 0);
      const htInputDisplay = totalReceivedAtHT > 0 ? totalReceivedAtHT : (job.currentDepartment === 'Heat Treatment' ? m.qtyReceivedFromProd : 0);
      const totalRoutedFromHT = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Heat Treatment')
        .reduce((sum, mov) => sum + mov.quantity, 0);
      return Math.max(0, htInputDisplay - totalRoutedFromHT - (job.heatTreatmentDetails?.rejectionQty || 0));
    }
    if (activeDept === 'Plating') {
      const m = getJobCardProcessMetrics(job, movements);
      const totalReceivedAtPlating = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Plating' && mov.accepted)
        .reduce((sum, mov) => sum + mov.quantity, 0);
      const platingInputDisplay = totalReceivedAtPlating > 0 ? totalReceivedAtPlating : (job.currentDepartment === 'Plating' ? m.qtyReceivedAtPlating : 0);
      const totalRoutedFromPlating = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Plating')
        .reduce((sum, mov) => sum + mov.quantity, 0);
      return Math.max(0, platingInputDisplay - totalRoutedFromPlating - (job.platingDetails?.rejectionQty || 0));
    }
    if (activeDept === 'Packing') {
      const m = getJobCardProcessMetrics(job, movements);
      const totalReceivedAtPacking = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Packing' && mov.accepted)
        .reduce((sum, mov) => sum + mov.quantity, 0);
      const packingInputDisplay = totalReceivedAtPacking > 0 ? totalReceivedAtPacking : (job.currentDepartment === 'Packing' ? m.qtyReceivedAtPacking : 0);
      const totalRoutedFromPacking = movements
        .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Packing')
        .reduce((sum, mov) => sum + mov.quantity, 0);
      return Math.max(0, packingInputDisplay - totalRoutedFromPacking - (job.packingDetails?.rejectionQty || 0));
    }
    return job.currentQty || 0;
  };

  const totalDeptWipQty = activeDepartmentJobs.reduce((acc, job) => acc + getJobWipQtyForDept(job), 0);

  // C. Archived Outbound transfers from this department (both accepted and pending custody downstream)
  const completedDepartmentLogs = movements.filter(m => {
    return m.fromDepartment === activeDept;
  });

  // Status Colors Helper
  const getBadgeColor = (status: string) => {
    switch (status) {
      case 'Pending': return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40 border border-amber-200';
      case 'In Process': return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/40 border border-blue-200';
      case 'Completed': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40 border border-emerald-200';
      case 'Rejected': return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/40 border border-red-200';
      case 'Pending Acceptance': return 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/40 border border-purple-200';
      default: return 'bg-slate-105';
    }
  };

  const activeProcessingJob = jobCards.find(job => 
    ((activeDept as any) === 'Purchase' && activePurchaseJob === job.jobCardNo) ||
    (activeDept === 'Production' && activeProdJob === job.jobCardNo) ||
    (activeDept === 'Heat Treatment' && activeHtJob === job.jobCardNo) ||
    (activeDept === 'Plating' && activePlatingJob === job.jobCardNo) ||
    (activeDept === 'Packing' && activePackingJob === job.jobCardNo) ||
    (activeDept === 'Store' && activeStoreJob === job.jobCardNo) ||
    (activeDept === 'Raw Material Store' && activeRawStoreJob === job.jobCardNo)
  );

  let modalMetrics: any = null;
  if (activeProcessingJob) {
    const job = activeProcessingJob;
    const m = getJobCardProcessMetrics(job, movements);
    const totalMovedFromProd = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Production')
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const pendingProdQty = job.orderQty - totalMovedFromProd;
    const isRoutedDownstream = job.currentDepartment !== 'Production';

    // 1. Heat Treatment variables
    const totalReceivedAtHT = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Heat Treatment' && mov.accepted)
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const htInputDisplay = totalReceivedAtHT > 0 ? totalReceivedAtHT : (job.currentDepartment === 'Heat Treatment' ? m.qtyReceivedFromProd : 0);
    const totalRoutedFromHT = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Heat Treatment')
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const pendingHTQty = Math.max(0, htInputDisplay - totalRoutedFromHT - (job.heatTreatmentDetails?.rejectionQty || 0));
    const isHTRoutedDownstream = job.currentDepartment !== 'Heat Treatment';

    // 2. Plating variables
    const totalReceivedAtPlating = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Plating' && mov.accepted)
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const platingInputDisplay = totalReceivedAtPlating > 0 ? totalReceivedAtPlating : (job.currentDepartment === 'Plating' ? m.qtyReceivedAtPlating : 0);
    const totalRoutedFromPlating = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Plating')
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const pendingPlatingQty = Math.max(0, platingInputDisplay - totalRoutedFromPlating - (job.platingDetails?.rejectionQty || 0));
    const isPlatingRoutedDownstream = job.currentDepartment !== 'Plating';

    // 3. Packing variables
    const totalReceivedAtPacking = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.toDepartment === 'Packing' && mov.accepted)
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const packingInputDisplay = totalReceivedAtPacking > 0 ? totalReceivedAtPacking : (job.currentDepartment === 'Packing' ? m.qtyReceivedAtPacking : 0);
    const totalRoutedFromPacking = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && mov.fromDepartment === 'Packing')
      .reduce((sum, mov) => sum + mov.quantity, 0);
    const pendingPackingQty = Math.max(0, packingInputDisplay - totalRoutedFromPacking - (job.packingDetails?.rejectionQty || 0));
    const isPackingRoutedDownstream = job.currentDepartment !== 'Packing';

    modalMetrics = {
      m,
      totalMovedFromProd,
      pendingProdQty,
      isRoutedDownstream,
      htInputDisplay,
      totalRoutedFromHT,
      pendingHTQty,
      isHTRoutedDownstream,
      platingInputDisplay,
      totalRoutedFromPlating,
      pendingPlatingQty,
      isPlatingRoutedDownstream,
      packingInputDisplay,
      totalRoutedFromPacking,
      pendingPackingQty,
      isPackingRoutedDownstream
    };
  }

  const {
    m = {} as any,
    totalMovedFromProd = 0,
    pendingProdQty = 0,
    isRoutedDownstream = false,
    htInputDisplay = 0,
    totalRoutedFromHT = 0,
    pendingHTQty = 0,
    isHTRoutedDownstream = false,
    platingInputDisplay = 0,
    totalRoutedFromPlating = 0,
    pendingPlatingQty = 0,
    isPlatingRoutedDownstream = false,
    packingInputDisplay = 0,
    totalRoutedFromPacking = 0,
    pendingPackingQty = 0,
    isPackingRoutedDownstream = false
  } = modalMetrics || {};

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="space-y-6"
    >
      
      {/* Department Context Top bar */}
      <div className="bg-[#0F172A] text-white rounded-2xl p-5 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[#3B82F6] text-[10px] uppercase font-bold tracking-widest font-mono">
            Active Control Module
          </span>
          <h2 className="text-xl font-bold tracking-tight text-white mt-1">
            {activeDept} Department Workbench
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {activeDept === 'Dispatch' ? 'Initiate customer bookings & execute shipping schedules.' : 'Monitor local queue, accept incoming batches, and record processing metadata.'}
          </p>
        </div>

        {/* Local operation tabs switcher */}
        {activeDept !== 'Dispatch' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 shrink-0 max-w-full">
            {activeDept === 'Production' && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedJobCardForRMRequest(null);
                    setShowRawMaterialRequestModal(true);
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm border border-indigo-500/30 cursor-pointer h-[38px] whitespace-nowrap"
                >
                  <span>🪵 Request Raw Materials</span>
                </button>
                <div className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 border h-[38px] ${
                  isRawMaterialCompulsory
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                }`}>
                  <span className="text-xs">
                    {isRawMaterialCompulsory ? '🔒' : '🔓'}
                  </span>
                  <span>
                    RM Check: {isRawMaterialCompulsory ? 'Compulsory' : 'Optional'}
                  </span>
                </div>
              </div>
            )}
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs text-slate-400 overflow-x-auto max-w-full">
              <button
                onClick={() => setActiveSubView('incoming')}
                className={`flex-1 md:flex-none px-4 py-2.5 lg:py-1.5 min-h-[44px] md:min-h-[36px] rounded-md font-bold transition-all relative whitespace-nowrap text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeSubView === 'incoming' ? 'bg-slate-800 text-white shadow' : 'hover:text-white'
                }`}
              >
                <span>Incoming Ingress</span>
                {incomingTransfers.length > 0 && (
                  <span className="bg-red-500 text-white text-[9.5px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center animate-bounce shrink-0">
                    {incomingTransfers.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveSubView('operations')}
                className={`flex-1 md:flex-none px-4 py-2.5 lg:py-1.5 min-h-[44px] md:min-h-[36px] rounded-md font-bold transition-all whitespace-nowrap text-center flex items-center justify-center cursor-pointer ${
                  activeSubView === 'operations' ? 'bg-slate-800 text-white shadow' : 'hover:text-white'
                }`}
              >
                Active Floor Jobs
              </button>
              <button
                onClick={() => setActiveSubView('completed')}
                className={`flex-1 md:flex-none px-4 py-2.5 lg:py-1.5 min-h-[44px] md:min-h-[36px] rounded-md font-bold transition-all whitespace-nowrap text-center flex items-center justify-center cursor-pointer ${
                  activeSubView === 'completed' ? 'bg-slate-800 text-white shadow' : 'hover:text-white'
                }`}
              >
                Completed Logs
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* SUMMARY TOTAL WORK-IN-PROGRESS (WIP) BANNER FOR DEPARTMENT */}
      {/* ======================================================== */}
      {activeDept !== 'Dispatch' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-gradient-to-br from-indigo-900/30 via-slate-900 to-slate-950 border border-indigo-500/20 rounded-2xl p-4 flex items-center justify-between shadow-xs">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-indigo-400 block font-mono">
                Total WIP Quantity ({activeDept})
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-extrabold font-mono text-white">
                  {totalDeptWipQty.toLocaleString()}
                </span>
                <span className="text-xs font-bold text-indigo-300">KG</span>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-1 font-sans">
                Active work-in-progress quantity in list
              </p>
            </div>
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-400 shrink-0">
              <Scale className="h-6 w-6" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-xs">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block font-mono">
                Active Queue Batch Count
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-extrabold font-mono text-white">
                  {activeDepartmentJobs.length}
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {activeDepartmentJobs.length === 1 ? 'Job Card' : 'Job Cards'}
                </span>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-1 font-sans">
                Total job cards active in department list
              </p>
            </div>
            <div className="p-3 bg-slate-800/80 border border-slate-700/80 rounded-xl text-slate-300 shrink-0">
              <Box className="h-6 w-6" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-950/20 via-slate-900 to-slate-950 border border-amber-500/20 rounded-2xl p-4 flex items-center justify-between shadow-xs">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-400 block font-mono">
                Avg. WIP Load
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-extrabold font-mono text-white">
                  {activeDepartmentJobs.length > 0 
                    ? Math.round(totalDeptWipQty / activeDepartmentJobs.length).toLocaleString() 
                    : 0}
                </span>
                <span className="text-xs font-bold text-amber-300">KG / Job</span>
              </div>
              <p className="text-[10.5px] text-slate-400 mt-1 font-sans">
                Average pending load per job card
              </p>
            </div>
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 shrink-0">
              <Layers className="h-6 w-6" />
            </div>
          </div>
        </div>
      )}      {/* ======================================================== */}
      {/* DISPATCH SPECIFIC MODULE: BOOK ORDER (STEP 1) */}
      {/* ======================================================== */}
      {activeDept === 'Dispatch' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   {/* Create Order Form */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 mb-2">
              <Plus className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="font-sans font-bold text-sm text-slate-850 dark:text-white uppercase tracking-wider">
                Create Raw Job Card
              </h3>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Customer / Party Name</label>
                <input
                  type="text"
                  placeholder="Apex Engineering Solutions"
                  required
                  value={partyName}
                  onChange={e => setPartyName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              {/* Box container for Item details to highlight multi-add capability */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/25 space-y-3">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Add Item Details</span>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="block text-slate-400 font-semibold mb-1">Item Name</label>
                    <input
                      type="text"
                      placeholder="M12 High-Tensile Bolt"
                      value={itemName}
                      onChange={e => {
                        setItemName(e.target.value);
                        setShowItemDropdown(true);
                      }}
                      onFocus={() => setShowItemDropdown(true)}
                      onBlur={() => setTimeout(() => setShowItemDropdown(false), 200)}
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6]"
                    />
                    {showItemDropdown && filteredItems.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg">
                        {filteredItems.map(item => (
                          <div
                            key={item.id}
                            onMouseDown={() => {
                              setItemName(item.itemName);
                              setItemCode(item.itemCode);
                              setShowItemDropdown(false);
                            }}
                            className="px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 transition-colors"
                          >
                            <span className="font-medium truncate">{item.itemName}</span>
                            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-2 shrink-0">{item.itemCode}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Item Code <span className="text-slate-400 font-normal text-xs">(Optional)</span></label>
                    <input
                      type="text"
                      placeholder="BOLT-M12-G8"
                      value={itemCode}
                      onChange={e => setItemCode(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-slate-455 font-semibold mb-1">Quantity (KG)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={orderQty}
                      onChange={e => setOrderQty(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter quantity"
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-450 font-semibold mb-1">Heat Treatment</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setHtRequired(true)}
                        className={`flex-1 py-2 rounded-lg font-bold border transition cursor-pointer ${
                          htRequired 
                            ? 'bg-[#3B82F6] border-[#1D4ED8] text-white shadow-sm' 
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-855 dark:hover:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-755'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setHtRequired(false)}
                        className={`flex-1 py-2 rounded-lg font-bold border transition cursor-pointer ${
                          !htRequired 
                            ? 'bg-[#3B82F6] border-[#1D4ED8] text-white shadow-sm' 
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-855 dark:hover:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-755'
                        }`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Remarks / Quality Notes</label>
                  <textarea
                    rows={1}
                    placeholder="E.g., Batch code, specific tolerances..."
                    value={dispatchRemarks}
                    onChange={e => setDispatchRemarks(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg p-2.5 text-slate-850 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-sans"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddItemToOrder}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-800 dark:text-white font-bold rounded-lg border border-slate-250 dark:border-slate-700 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer text-[11px]"
                >
                  <Plus className="h-4 w-4 text-[#3B82F6]" />
                  Add Item to Party Order
                </button>
              </div>

              {/* LIST OF ADDED ITEMS */}
              {multiItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Current Order List ({multiItems.length} Items)
                    </span>
                    <button
                      type="button"
                      onClick={() => setMultiItems([])}
                      className="text-[10px] text-red-500 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-x-auto bg-slate-50/50 dark:bg-slate-950/25">
                    <table className="w-full text-[10px] text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-850 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                          <th className="py-2 px-3">Item</th>
                          <th className="py-2 px-2 text-right">Qty (KG)</th>
                          <th className="py-2 px-2 text-center">HT</th>
                          <th className="py-2 px-2 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {multiItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/20 text-slate-700 dark:text-slate-300">
                            <td className="py-2 px-3">
                              <div className="font-bold truncate max-w-[120px]">{item.itemName}</div>
                              <div className="text-[9px] text-slate-400 font-mono truncate max-w-[120px]">{item.itemCode}</div>
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold">
                              {item.orderQty.toLocaleString()}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {item.htRequired ? (
                                <span className="text-[8px] bg-amber-500/10 text-amber-500 font-bold px-1 py-0.2 rounded border border-amber-500/20">Yes</span>
                              ) : (
                                <span className="text-[8px] bg-slate-500/10 text-slate-400 font-bold px-1 py-0.2 rounded">No</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItemFromOrder(idx)}
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-[#3B82F6] text-white hover:bg-blue-600 font-semibold py-3 rounded-lg shadow-md transition-all uppercase tracking-wide font-mono text-sm border border-[#1D4ED8] cursor-pointer"
              >
                {multiItems.length > 0 ? `Register Order (${multiItems.length} Items)` : 'Register Single Item Order'}
              </button>
            </form>
          </div>

          {/* ACTIVE DISPATCH QUEUE & INVOICING / SHIPMENTS */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">
                Verify & Ingest Inbound Packed Stocks to Dispatched
              </h3>

              {activeDepartmentJobs.length === 0 ? (
                <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-2xl">📦</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">No outstanding dispatch shipping queues</p>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {activeDepartmentJobs.map(job => {
                    const isClosing = activeDispJob === job.jobCardNo;
                    const isRequesting = activeRequestJob === job.jobCardNo;
                    const isResending = activeResendJob === job.jobCardNo;

                    const jobIssueRequests = movements.filter(m => 
                      m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && 
                      m.isIssueRequest
                    );
                    const pendingIssueReq = jobIssueRequests.find(m => !m.accepted);
                    const isIssuedByStore = jobIssueRequests.some(m => m.accepted && m.issueStatus === 'Issued');
                    
                    const canShip = (job.currentDepartment === 'Completed' || (job.currentDepartment === 'Dispatch' && isIssuedByStore) || (job.currentDepartment === 'Dispatch' && jobIssueRequests.length === 0)) && job.status !== 'Rejected';
                    const canRequest = job.currentDepartment === 'Store' && !pendingIssueReq && !isIssuedByStore;

                    return (
                      <div 
                        key={job.jobCardNo}
                        className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80 transition-all hover:border-slate-350"
                      >
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                          <div onClick={() => onSelectJobCard(job)} className="cursor-pointer hover:underline min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-[11px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded">
                                {job.jobCardNo}
                              </span>
                              <span className="font-sans font-extrabold text-slate-900 dark:text-white truncate">
                                {job.partyName}
                              </span>
                              {job.materialType && (
                                <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[8.5px] ${
                                  job.materialType === 'Raw Material'
                                    ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400'
                                    : job.materialType === 'Semi Finished Goods'
                                    ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400'
                                    : 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                                }`}>
                                  {job.materialType === 'Raw Material' ? '🪵 Raw Mat' : job.materialType === 'Semi Finished Goods' ? '⚙️ Semi Fin' : '📦 Fin Goods'}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">
                              <strong>{job.itemName}</strong> | target: {job.orderQty} KG, cur: {job.currentQty} KG (Bal: {job.balanceQty} KG)
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
                            {job.currentDepartment === 'Dispatch' && job.status === 'Rejected' ? (
                              <button
                                onClick={() => {
                                  setActiveResendJob(isResending ? null : job.jobCardNo);
                                  setResendQty(job.currentQty || job.orderQty);
                                  setResendRemarks('Order resent to Production by Dispatch.');
                                }}
                                className="bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold py-1.5 px-3 rounded-md transition-all flex items-center gap-1 cursor-pointer"
                              >
                                <ArrowRight className="h-3.5 w-3.5" />
                                Resend to Production
                              </button>
                            ) : canShip ? (
                              <button
                                onClick={() => {
                                  setActiveDispJob(isClosing ? null : job.jobCardNo);
                                  setDispQty(job.currentQty);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold py-1.5 px-3 rounded-md transition-all flex items-center gap-1 cursor-pointer"
                              >
                                <Truck className="h-3.5 w-3.5" />
                                Invoice & Ship
                              </button>
                            ) : pendingIssueReq ? (
                              <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 px-3 py-1.5 rounded-md font-mono text-[10px] font-bold">
                                <span className="animate-pulse">⏳</span>
                                Pending Store Issue ({pendingIssueReq.requestedQty} {pendingIssueReq.requestedUnit})
                              </div>
                            ) : canRequest ? (
                              <button
                                onClick={() => {
                                  setActiveRequestJob(isRequesting ? null : job.jobCardNo);
                                  setRequestQty(job.currentQty);
                                  setRequestUnit('KGS');
                                  setRequestRemarks('');
                                }}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold py-1.5 px-3 rounded-md transition-all flex items-center gap-1 cursor-pointer"
                              >
                                📩 Request Issue
                              </button>
                            ) : (
                              <span className="text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-850 px-2.5 py-1.5 rounded-full font-mono inline-flex items-center gap-1.5">
                                <span>Floor: {job.currentDepartment}</span>
                                <JobStatusBadge status={job.status} size="xs" />
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Request Issue Panel */}
                        {isRequesting && (
                          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs space-y-3 font-sans">
                            <div className="flex items-center justify-between font-semibold mb-1 text-slate-800 dark:text-slate-100">
                              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
                                📩 Request Material Issue from Storekeeper
                              </span>
                              <button onClick={() => setActiveRequestJob(null)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="bg-slate-100/50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                  Request Unit Selection
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRequestUnit('KGS');
                                      setRequestQty(job.currentQty);
                                    }}
                                    className={`flex-1 py-1.5 rounded-md font-bold text-[10.5px] border transition cursor-pointer ${
                                      requestUnit === 'KGS'
                                        ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-400 font-extrabold'
                                        : 'bg-white hover:bg-slate-50 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-750'
                                    }`}
                                  >
                                    ⚖️ In KGS
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRequestUnit('PCS');
                                      setRequestQty(job.packingDetails?.totalPcs || 100);
                                    }}
                                    className={`flex-1 py-1.5 rounded-md font-bold text-[10.5px] border transition cursor-pointer ${
                                      requestUnit === 'PCS'
                                        ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-500 text-pink-700 dark:text-pink-400 font-extrabold'
                                        : 'bg-white hover:bg-slate-50 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-750'
                                    }`}
                                  >
                                    🔢 In PCS (Pieces)
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                  Requested Quantity ({requestUnit})
                                </label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={requestQty || ''}
                                  onChange={e => {
                                    const clean = e.target.value.replace(/\D/g, '');
                                    setRequestQty(clean === '' ? 0 : parseInt(clean, 10));
                                  }}
                                  placeholder="0"
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 font-mono text-[11px] font-bold text-slate-800 dark:text-white"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                  Remarks for Storekeeper
                                </label>
                                <input
                                  type="text"
                                  placeholder="E.g., Urgent shipment requested by evening..."
                                  value={requestRemarks}
                                  onChange={e => setRequestRemarks(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 text-[11px] text-slate-800 dark:text-white"
                                />
                              </div>
                            </div>

                            <button
                              onClick={async () => {
                                if (!requestQty || requestQty <= 0) return;
                                try {
                                  await onCreateMovement({
                                    jobCardNo: job.jobCardNo,
                                    fromDepartment: 'Store',
                                    toDepartment: 'Dispatch',
                                    quantity: job.currentQty,
                                    isIssueRequest: true,
                                    requestedUnit: requestUnit,
                                    requestedQty: requestQty,
                                    remarks: requestRemarks || `Dispatch requested issue in ${requestUnit}`
                                  });
                                  setActiveRequestJob(null);
                                } catch (err) {
                                  console.error("Failed to send issue request", err);
                                }
                              }}
                              className="w-full bg-indigo-600 text-white hover:bg-indigo-500 py-2 rounded font-bold uppercase tracking-wider text-xs shadow-sm mt-1 cursor-pointer"
                            >
                              Submit Issue Request to Storekeeper
                            </button>
                          </div>
                        )}

                        {/* Invoice & Ship execution panel */}
                        {isClosing && (
                          <div className="mt-4 pt-4 border-t border-slate-210 text-xs space-y-3 font-sans">
                            <div className="flex items-center justify-between font-semibold mb-1 text-slate-800 dark:text-white">
                              <span>Outbound Logistics Sign-off</span>
                              <button onClick={() => setActiveDispJob(null)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-slate-400 mb-1">Invoice Number</label>
                                <input
                                  type="text"
                                  value={dispInvoice}
                                  onChange={e => setDispInvoice(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 font-mono text-slate-800 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-slate-400 mb-1">Vehicle / Carrier Registrations</label>
                                  <input
                                  type="text"
                                  value={dispVehicle}
                                  onChange={e => setDispVehicle(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 font-mono text-slate-800 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-slate-400 mb-1">Final Dispatch quantity (KG)</label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={dispQty || ''}
                                  onChange={e => {
                                    const clean = e.target.value.replace(/\D/g, '');
                                    setDispQty(clean === '' ? 0 : parseInt(clean, 10));
                                  }}
                                  placeholder="0"
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 font-mono text-slate-800 dark:text-white"
                                />
                              </div>
                            </div>
                            
                            <p className="text-[10px] text-slate-400 font-sans italic">
                              *Completing this action closes the Job Card order chain and flags all movements Completed.
                            </p>

                            <button
                              onClick={() => handleFinalizeDispatch(job)}
                              className="w-full bg-emerald-600 text-white hover:bg-emerald-500 py-2 rounded font-bold uppercase tracking-wider text-xs shadow-sm mt-1"
                            >
                              Finalize Outbound Handover
                            </button>
                          </div>
                        )}

                        {/* Resend to Production Panel */}
                        {isResending && (
                          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs space-y-3 font-sans">
                            <div className="flex items-center justify-between font-semibold mb-1 text-slate-800 dark:text-slate-100">
                              <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-600">
                                <ArrowRight className="h-3.5 w-3.5" />
                                Resend Order to Production
                              </span>
                              <button onClick={() => setActiveResendJob(null)} className="p-1 rounded text-slate-400 hover:text-slate-600">
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="bg-slate-100/50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                  Resend Quantity (KG)
                                </label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={resendQty || ''}
                                  onChange={e => {
                                    const clean = e.target.value.replace(/\D/g, '');
                                    setResendQty(clean === '' ? 0 : parseInt(clean, 10));
                                  }}
                                  placeholder="0"
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 font-mono text-[11px] font-bold text-slate-800 dark:text-white"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                                  Remarks / Instructions
                                </label>
                                <input
                                  type="text"
                                  placeholder="Provide remarks or instructions for Production..."
                                  value={resendRemarks}
                                  onChange={e => setResendRemarks(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded p-1.5 text-[11px] text-slate-800 dark:text-white"
                                />
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                if (resendQty <= 0) {
                                  alert('Quantity must be greater than 0');
                                  return;
                                }
                                handleResendToProduction(job, resendQty, resendRemarks);
                              }}
                              className="w-full bg-blue-600 text-white hover:bg-blue-500 py-2 rounded font-bold uppercase tracking-wider text-xs shadow-sm mt-1 cursor-pointer"
                            >
                              Confirm and Send back to Production
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* PURCHASE SPECIFIC MODULE: DIRECT GOODS ENTRY */}
      {/* ======================================================== */}
      {activeDept === 'Purchase' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Direct Purchase Goods Entry Form */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b pb-3 mb-2">
              <Plus className="h-5 w-5 text-[#3B82F6]" />
              <h3 className="font-sans font-bold text-sm text-slate-850 dark:text-white uppercase tracking-wider">
                Direct Purchase Goods Entry
              </h3>
            </div>

            <form onSubmit={handleDirectPurchaseEntry} className="space-y-4 text-xs font-sans">
              {/* Optional: Link Outsource Order Selector */}
              <div className="bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/80 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-purple-900 dark:text-purple-300 font-bold text-xs flex items-center gap-1.5">
                    <Link className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                    Select Outsource Order <span className="text-[10px] text-purple-600 dark:text-purple-400 font-normal">(Optional)</span>
                  </label>
                  {selectedOutsourceOrderId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOutsourceOrderId('');
                        setPurchaseSupplier('');
                        setPurchaseItemName('');
                        setPurchaseItemCode('');
                        setPurchaseRecQty('');
                        setPurchaseRejQty(0);
                        setPurchaseSentQty(0);
                      }}
                      className="text-[10px] text-purple-700 dark:text-purple-300 underline font-bold hover:text-purple-900 cursor-pointer"
                    >
                      Clear Link
                    </button>
                  )}
                </div>

                <select
                  value={selectedOutsourceOrderId}
                  onChange={e => {
                    const orderId = e.target.value;
                    setSelectedOutsourceOrderId(orderId);
                    if (orderId) {
                      const order = outsourceOrders.find(o => o.orderId === orderId);
                      if (order) {
                        setPurchaseSupplier(order.supplierName || order.partyName || '');
                        setPurchaseItemName(order.itemName);
                        setPurchaseItemCode(order.itemCode || '');
                        setPurchaseRecQty(order.orderQty);
                        setPurchaseRejQty(0);
                        setPurchaseSentQty(order.orderQty);
                        setPurchaseUnit(order.unit);
                        setPurchaseBill(order.supplierPoNo || order.poNumber || `CH-${order.orderId}`);
                        
                        if (order.outsourceMaterialType) {
                          setPurchaseMaterialType(order.outsourceMaterialType === 'Finished Goods' ? 'Finished Goods' : 'Semi Finished Goods');
                        } else {
                          setPurchaseMaterialType('Semi Finished Goods');
                        }

                        // Target department logic based on processType
                        const proc = (order.processType || '').toLowerCase();
                        if (proc.includes('plating') || proc.includes('zinc') || proc.includes('surface')) {
                          setPurchaseTargetDept('Plating');
                        } else if (proc.includes('heat') || proc.includes('hardening') || proc.includes('annealing')) {
                          setPurchaseTargetDept('Heat Treatment');
                        } else if (order.outsourceMaterialType === 'Finished Goods' || proc.includes('finish')) {
                          setPurchaseTargetDept('Store');
                        } else {
                          setPurchaseTargetDept('Heat Treatment');
                        }
                      }
                    }
                  }}
                  className="w-full bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-purple-500 shadow-xs"
                >
                  <option value="">-- Direct Purchase (No Outsource Link) --</option>
                  {outsourceOrders.filter(o => o.status !== 'Completed').map(ord => (
                    <option key={ord.orderId} value={ord.orderId}>
                      {ord.orderId} • {ord.supplierName || ord.partyName} - {ord.itemName} ({ord.orderQty} {ord.unit}) [{ord.status}]
                    </option>
                  ))}
                </select>

                {selectedOutsourceOrderId && (
                  <div className="text-[11px] text-purple-900 dark:text-purple-200 bg-purple-100/90 dark:bg-purple-900/60 px-2.5 py-1.5 rounded-lg flex items-center justify-between border border-purple-200 dark:border-purple-800">
                    <span>Auto-filled details for <strong>{selectedOutsourceOrderId}</strong></span>
                    <span className="font-bold text-purple-700 dark:text-purple-300">Target: {purchaseTargetDept}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Supplier / Vendor Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jindal Steel Power"
                  required
                  value={purchaseSupplier}
                  onChange={e => setPurchaseSupplier(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6]"
                />
              </div>

              {/* Box container for Item details to highlight multi-add capability */}
              <div className="border border-slate-100 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/25 space-y-3">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Add Item Details</span>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <label className="block text-slate-400 font-semibold mb-1">Item Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Steel Wire Rods"
                      value={purchaseItemName}
                      onChange={e => {
                        setPurchaseItemName(e.target.value);
                        setShowPurchaseItemDropdown(true);
                      }}
                      onFocus={() => setShowPurchaseItemDropdown(true)}
                      onBlur={() => setTimeout(() => setShowPurchaseItemDropdown(false), 200)}
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6]"
                    />
                    {showPurchaseItemDropdown && filteredPurchaseItems.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg">
                        {filteredPurchaseItems.map(item => (
                          <div
                            key={item.id}
                            onMouseDown={() => {
                              setPurchaseItemName(item.itemName);
                              setPurchaseItemCode(item.itemCode);
                              setShowPurchaseItemDropdown(false);
                            }}
                            className="px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer flex justify-between items-center text-xs text-slate-700 dark:text-slate-300 transition-colors"
                          >
                            <span className="font-medium truncate">{item.itemName}</span>
                            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-2 shrink-0">{item.itemCode}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1">Item Code <span className="text-slate-400 font-normal text-xs">(Optional)</span></label>
                    <input
                      type="text"
                      placeholder="e.g. WR-STEEL-5.5"
                      value={purchaseItemCode}
                      onChange={e => setPurchaseItemCode(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-455 font-semibold mb-1">Received Qty ({purchaseQtyUnitLabel})</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={purchaseRecQty}
                      onChange={e => {
                        const clean = e.target.value.replace(/\D/g, '');
                        setPurchaseRecQty(clean);
                        const rec = parseInt(clean, 10) || 0;
                        const rej = typeof purchaseRejQty === 'number' ? purchaseRejQty : (parseInt(String(purchaseRejQty), 10) || 0);
                        setPurchaseSentQty(Math.max(0, rec - rej));
                      }}
                      placeholder="0"
                      className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg px-4 py-3.5 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-mono font-bold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="block text-rose-500 font-semibold mb-1 text-center truncate">Rej ({purchaseQtyUnitLabel})</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={purchaseRejQty}
                        onChange={e => {
                          const clean = e.target.value.replace(/\D/g, '');
                          setPurchaseRejQty(clean);
                          const rej = parseInt(clean, 10) || 0;
                          const rec = typeof purchaseRecQty === 'number' ? purchaseRecQty : (parseInt(String(purchaseRecQty), 10) || 0);
                          setPurchaseSentQty(Math.max(0, rec - rej));
                        }}
                        placeholder="0"
                        className="w-full bg-slate-50 dark:bg-slate-855 border border-rose-200 focus:border-rose-500 rounded-lg px-4 py-3.5 text-rose-600 dark:text-rose-400 focus:outline-none font-mono font-bold text-center"
                      />
                    </div>
                    <div>
                      <label className="block text-emerald-600 font-semibold mb-1 text-center truncate">Sent ({purchaseQtyUnitLabel})</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        readOnly
                        value={purchaseSentQty}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 rounded-lg px-4 py-3.5 text-slate-855 dark:text-slate-100 font-mono font-bold text-center focus:outline-none"
                        title="Calculated: Received - Rejection"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Material Type</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseMaterialType('Raw Material');
                        setPurchaseTargetDept('Raw Material Store');
                      }}
                      className={`py-2 px-1 rounded-lg font-bold border text-center transition cursor-pointer text-[10px] ${
                        purchaseMaterialType === 'Raw Material'
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                          : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      🪵 Raw
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseMaterialType('Semi Finished Goods');
                        setPurchaseTargetDept('Heat Treatment');
                      }}
                      className={`py-2 px-1 rounded-lg font-bold border text-center transition cursor-pointer text-[10px] ${
                        purchaseMaterialType === 'Semi Finished Goods'
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                          : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      ⚙️ Semi
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseMaterialType('Finished Goods');
                        setPurchaseTargetDept('Store');
                      }}
                      className={`py-2 px-1 rounded-lg font-bold border text-center transition cursor-pointer text-[10px] ${
                        purchaseMaterialType === 'Finished Goods'
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                          : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      📦 Finished
                    </button>
                  </div>
                </div>

                {purchaseMaterialType === 'Finished Goods' && (
                  <div>
                    <label className="block text-slate-400 font-semibold mb-1 text-[10px] uppercase tracking-wider">Finished Goods Unit</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPurchaseUnit('KGS')}
                        className={`py-1.5 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs ${
                          purchaseUnit === 'KGS'
                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-400'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        ⚖️ Kilograms (KGS)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPurchaseUnit('PCS')}
                        className={`py-1.5 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs ${
                          purchaseUnit === 'PCS'
                            ? 'bg-pink-50 dark:bg-pink-950/40 border-pink-500 text-pink-700 dark:text-pink-400'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        🔢 Pieces (PCS)
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Send / Route Material To</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(purchaseMaterialType === 'Raw Material' || purchaseMaterialType === 'Finished Goods') && (
                      <button
                        type="button"
                        onClick={() => setPurchaseTargetDept(purchaseMaterialType === 'Raw Material' ? 'Raw Material Store' : 'Store')}
                        className={`py-2 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-400`}
                      >
                        🏢 {purchaseMaterialType === 'Raw Material' ? 'Raw Material Store' : 'Finished Goods Store'}
                      </button>
                    )}
                    {purchaseMaterialType === 'Semi Finished Goods' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPurchaseTargetDept('Heat Treatment')}
                          className={`py-2 px-2 rounded-lg font-bold border text-center transition cursor-pointer text-[10.5px] ${
                            purchaseTargetDept === 'Heat Treatment'
                              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-700 dark:text-amber-400'
                              : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          🔥 Heat Treatment
                        </button>
                        <button
                          type="button"
                          onClick={() => setPurchaseTargetDept('Plating')}
                          className={`py-2 px-2 rounded-lg font-bold border text-center transition cursor-pointer text-[10.5px] ${
                            purchaseTargetDept === 'Plating'
                              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-400'
                              : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          💿 Plating Process
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Remarks / Quality Notes</label>
                  <textarea
                    rows={1}
                    placeholder="Enter wire diameter, batch specifications..."
                    value={purchaseRemarks}
                    onChange={e => setPurchaseRemarks(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-855 border border-slate-200 dark:border-slate-755 rounded-lg p-2.5 text-slate-855 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] font-sans"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddItemToPurchase}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-800 dark:text-white font-bold rounded-lg border border-slate-250 dark:border-slate-700 shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer text-[11px]"
                >
                  <Plus className="h-4 w-4 text-[#3B82F6]" />
                  Add Item to Supplier Inward
                </button>
              </div>

              {/* LIST OF ADDED PURCHASE ITEMS */}
              {purchaseMultiItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      Invoice Items ({purchaseMultiItems.length} Items)
                    </span>
                    <button
                      type="button"
                      onClick={() => setPurchaseMultiItems([])}
                      className="text-[10px] text-red-500 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="border border-slate-150 dark:border-slate-800 rounded-xl overflow-x-auto bg-slate-50/50 dark:bg-slate-950/25">
                    <table className="w-full text-[10px] text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-855 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                          <th className="py-2 px-3">Item</th>
                          <th className="py-2 px-2 text-right">Received Qty</th>
                          <th className="py-2 px-2 text-center">Route To</th>
                          <th className="py-2 px-2 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {purchaseMultiItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-slate-800/20 text-slate-700 dark:text-slate-300">
                            <td className="py-2 px-3">
                              <div className="font-bold truncate max-w-[110px]">{item.itemName}</div>
                              <div className="text-[9px] text-slate-400 font-mono truncate max-w-[110px]">{item.itemCode}</div>
                            </td>
                            <td className="py-2 px-2 text-right font-mono font-bold">
                              {item.recQty.toLocaleString()} <span className="text-[9px] text-slate-400 font-normal">{item.unit || 'KGS'}</span>
                              {item.rejQty > 0 && (
                                <div className="text-[9px] text-red-500">Rej: {item.rejQty} {item.unit || 'KGS'}</div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <span className="text-[8.5px] font-semibold px-1 py-0.5 rounded bg-blue-500/10 text-blue-500">
                                {item.targetDept === 'Store' ? 'FG Store' : item.targetDept === 'Raw Material Store' ? 'RM Store' : item.targetDept === 'Heat Treatment' ? 'HT' : item.targetDept}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItemFromPurchase(idx)}
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-lg shadow-md transition-all uppercase tracking-wide font-mono text-xs border border-emerald-700 cursor-pointer"
              >
                {purchaseMultiItems.length > 0 ? `Save Purchase Entry (${purchaseMultiItems.length} Items)` : 'Save Single Purchase Entry'}
              </button>
            </form>
          </div>

          {/* Right Column: Workbench Operations for Purchase */}
          <div className="lg:col-span-2 space-y-4">
            {/* RENDER DYNAMIC SUBVIEW CONTENTS FOR PURCHASE WORKBENCH */}
            {activeSubView === 'incoming' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  📥 Pending Custody Receipts 
                </h3>
                <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-xl">🙌</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">Direct Inwarding Enabled. No incoming transfer receipts required.</p>
                </div>
              </div>
            )}

            {activeSubView === 'operations' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">
                  Active Floor Inwards Queue
                </h3>
                {activeDepartmentJobs.filter(job => job.currentDepartment === 'Purchase').length === 0 ? (
                  <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <span className="text-2xl">🌱</span>
                    <p className="text-slate-400 text-xs font-mono font-medium">No purchase items currently in physical inwarding</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activeDepartmentJobs.filter(job => job.currentDepartment === 'Purchase').map(job => {
                      const isProcessing = activePurchaseJob === job.jobCardNo;
                      return (
                        <div key={job.jobCardNo} className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80">
                          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
                            <div onClick={() => onSelectJobCard(job)} className="cursor-pointer hover:underline min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[11px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded">
                                  {job.jobCardNo}
                                </span>
                                <span className="font-sans font-extrabold text-slate-900 dark:text-white truncate">
                                  Supplier: {job.partyName}
                                </span>
                                {job.materialType && (
                                  <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[8.5px] ${
                                    job.materialType === 'Raw Material'
                                      ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400'
                                      : job.materialType === 'Semi Finished Goods'
                                      ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400'
                                      : 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                                  }`}>
                                    {job.materialType === 'Raw Material' ? '🪵 Raw Mat' : job.materialType === 'Semi Finished Goods' ? '⚙️ Semi Fin' : '📦 Fin Goods'}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 mt-1">
                                <strong>{job.itemName}</strong> | Target: {job.orderQty} KG
                              </p>
                            </div>
                            
                            <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
                              {job.status === 'Pending' ? (
                                <button
                                  onClick={() => handleStartPurchase(job)}
                                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11.5px] font-bold py-1.5 px-3.5 rounded-md transition flex items-center gap-1 leading-none cursor-pointer"
                                >
                                  <Play className="h-3.5 w-3.5 fill-current" />
                                  Start Inwarding
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setActivePurchaseJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      setPurchaseRecQty(job.orderQty);
                                      setPurchaseSentQty(job.orderQty);
                                    }
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold py-1.5 px-3.5 rounded-md transition flex items-center gap-1 leading-none cursor-pointer"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Record Metrics
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Purchase Job Metrics Subform */}
                          {isProcessing && (
                            <div className="mt-3 pt-3 border-t border-slate-200 text-xs space-y-4 font-sans">
                              <h4 className="font-semibold text-slate-800 dark:text-slate-100 uppercase text-[10px]">Record Inward Receipt Metrics</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                <div>
                                  <label className="block text-slate-400 mb-1">Purchase Invoice/Bill Number</label>
                                  <input
                                    type="text"
                                    value={purchaseBill}
                                    onChange={e => setPurchaseBill(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded-lg py-3.5 px-4 font-mono font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-slate-400 mb-1">Supplier Name</label>
                                  <input
                                    type="text"
                                    value={purchaseSupplier}
                                    onChange={e => setPurchaseSupplier(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded-lg py-3.5 px-4 font-bold"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                <div>
                                  <label className="block text-slate-400 mb-1">Total Bill Weight (KG)</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={purchaseRecQty}
                                    onChange={e => {
                                      const clean = e.target.value.replace(/\D/g, '');
                                      setPurchaseRecQty(clean);
                                      const rec = parseInt(clean, 10) || 0;
                                      const rej = typeof purchaseRejQty === 'number' ? purchaseRejQty : (parseInt(String(purchaseRejQty), 10) || 0);
                                      setPurchaseSentQty(Math.max(0, rec - rej));
                                    }}
                                    placeholder="0"
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded-lg py-3.5 px-4 font-mono font-bold"
                                  />
                                </div>
                                <div>
                                  <label className="block text-rose-500 mb-1">Rejection Weight (KG)</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={purchaseRejQty}
                                    onChange={e => {
                                      const clean = e.target.value.replace(/\D/g, '');
                                      setPurchaseRejQty(clean);
                                      const rej = parseInt(clean, 10) || 0;
                                      const rec = typeof purchaseRecQty === 'number' ? purchaseRecQty : (parseInt(String(purchaseRecQty), 10) || 0);
                                      setPurchaseSentQty(Math.max(0, rec - rej));
                                    }}
                                    placeholder="0"
                                    className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded-lg py-3.5 px-4 font-mono font-bold text-rose-600"
                                  />
                                </div>
                                <div>
                                  <label className="block text-emerald-600 mb-1">Sent to {purchaseTargetDept} (KG)</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    readOnly
                                    value={purchaseSentQty}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 rounded-lg py-3.5 px-4 font-mono font-bold"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 font-semibold mb-1">Material Type</label>
                                <div className="grid grid-cols-3 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPurchaseMaterialType('Raw Material');
                                      setPurchaseTargetDept('Raw Material Store');
                                    }}
                                    className={`py-2 px-1.5 rounded-lg font-bold border text-center transition cursor-pointer text-[10.5px] ${
                                      purchaseMaterialType === 'Raw Material'
                                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                                        : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    🪵 Raw Material
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPurchaseMaterialType('Semi Finished Goods');
                                      setPurchaseTargetDept('Heat Treatment');
                                    }}
                                    className={`py-2 px-1.5 rounded-lg font-bold border text-center transition cursor-pointer text-[10.5px] ${
                                      purchaseMaterialType === 'Semi Finished Goods'
                                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                                        : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    ⚙️ Semi Finished
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPurchaseMaterialType('Finished Goods');
                                      setPurchaseTargetDept('Store');
                                    }}
                                    className={`py-2 px-1.5 rounded-lg font-bold border text-center transition cursor-pointer text-[10.5px] ${
                                      purchaseMaterialType === 'Finished Goods'
                                        ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-500 text-blue-700 dark:text-blue-400'
                                        : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    📦 Finished Goods
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 font-semibold mb-1">Send / Route Material To</label>
                                <div className="grid grid-cols-2 gap-2">
                                  {(purchaseMaterialType === 'Raw Material' || purchaseMaterialType === 'Finished Goods') && (
                                    <button
                                      type="button"
                                      onClick={() => setPurchaseTargetDept(purchaseMaterialType === 'Raw Material' ? 'Raw Material Store' : 'Store')}
                                      className={`py-2 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-400`}
                                    >
                                      🏢 {purchaseMaterialType === 'Raw Material' ? 'Raw Material Store' : 'Store'}
                                    </button>
                                  )}
                                  {purchaseMaterialType === 'Semi Finished Goods' && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setPurchaseTargetDept('Heat Treatment')}
                                        className={`py-2 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs ${
                                          purchaseTargetDept === 'Heat Treatment'
                                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-500 text-amber-700 dark:text-amber-400'
                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                                        }`}
                                      >
                                        🔥 Heat Treatment
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setPurchaseTargetDept('Plating')}
                                        className={`py-2 px-3 rounded-lg font-bold border text-center transition cursor-pointer text-xs ${
                                          purchaseTargetDept === 'Plating'
                                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-400'
                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700'
                                        }`}
                                      >
                                        💿 Plating Process
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              <div>
                                <label className="block text-slate-400 mb-1">Quality Inspection remarks</label>
                                <textarea
                                  rows={2}
                                  value={purchaseRemarks}
                                  onChange={e => setPurchaseRemarks(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5"
                                  placeholder="Physical condition, batch identification..."
                                />
                              </div>

                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={() => handleCompletePurchase(job)}
                                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-4 rounded font-bold uppercase tracking-wider text-xs shadow-sm cursor-pointer"
                                >
                                  Inward Cargo & Route to {purchaseTargetDept}
                                </button>
                                <button
                                  onClick={() => setActivePurchaseJob(null)}
                                  className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeSubView === 'completed' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">
                  📋 Completed Outbound Ledgers
                </h3>
                {completedDepartmentLogs.length === 0 ? (
                  <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <span className="text-2xl">⏳</span>
                    <p className="text-slate-400 text-xs font-mono font-medium">No archived outbound handoffs recorded in active session</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2.5 px-3">Job Card</th>
                          <th className="py-2.5 px-3">Dispatched to</th>
                          <th className="py-2.5 px-3">Handoff Weight</th>
                          <th className="py-2.5 px-3">Recipient Signer</th>
                          <th className="py-2.5 px-3">Handoff Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completedDepartmentLogs.map(m => (
                          <tr key={m.movementId} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/50">
                            <td className="py-3 px-3 font-mono font-bold text-indigo-500">{m.jobCardNo}</td>
                            <td className="py-3 px-3 font-semibold">{m.toDepartment}</td>
                            <td className="py-3 px-3 font-mono font-semibold">{m.quantity} KG</td>
                            <td className="py-3 px-3">{m.acceptedBy || 'System auto-close'}</td>
                            <td className="py-3 px-3 text-slate-400 font-mono">
                              {new Date(m.acceptedDate || m.transferDate).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* OTHER DEPARTMENTS ACTIONS PANEL */}
      {/* ======================================================== */}
      {activeDept !== 'Dispatch' && activeDept !== 'Purchase' && (
        <div className="space-y-4">
          
          {/* A. INCOMING SUBVIEW (ACCEPTANCE AND REJECTIONS FLOW) */}
          {activeSubView === 'incoming' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                📥 Pending Custody Receipts 
              </h3>

              {incomingTransfers.length === 0 ? (
                <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-2xl">📦</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">Floor queue clean. No pending inbound shipments found.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {incomingTransfers.map(mov => {
                      const isRejecting = activeRejectionId === mov.movementId;
                      const isAccepting = acceptedMovementIds[mov.movementId] === 'animating';
                      return (
                        <motion.div 
                          key={mov.movementId}
                          layout
                          initial={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9, height: 0, y: -15, marginBottom: 0, padding: 0 }}
                          transition={{ duration: 0.4, ease: 'easeInOut' }}
                          className="relative bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-201 dark:border-slate-850 flex flex-col gap-3 overflow-hidden"
                        >
                          {/* Success confirmation overlay */}
                          {isAccepting && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="absolute inset-0 z-10 bg-emerald-50/95 dark:bg-emerald-950/95 flex flex-col items-center justify-center gap-1.5 p-4 text-center"
                            >
                              <motion.div
                                initial={{ scale: 0.5, rotate: -30 }}
                                animate={{ scale: [0.5, 1.25, 1], rotate: 0 }}
                                transition={{ duration: 0.45, ease: 'easeOut' }}
                                className="bg-emerald-500 text-white rounded-full p-2 shadow-lg shadow-emerald-500/20"
                              >
                                <CheckCircle2 className="h-6 w-6 stroke-[2.5]" />
                              </motion.div>
                              <motion.p
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15, duration: 0.35 }}
                                className="text-emerald-700 dark:text-emerald-300 font-extrabold text-xs uppercase tracking-wider font-sans"
                              >
                                Custody Accepted! 🎉
                              </motion.p>
                              <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 0.75 }}
                                transition={{ delay: 0.3 }}
                                className="text-emerald-600/90 dark:text-emerald-450 text-[10px] font-mono"
                              >
                                Moving to floor workbench...
                              </motion.p>
                            </motion.div>
                          )}

                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                            <div>
                              <div className="flex items-center gap-2 font-mono">
                                <span className="text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded">{mov.jobCardNo}</span>
                                <span className="text-slate-400 font-bold">Transfer Ref: {mov.movementId}</span>
                              </div>
                              {(() => {
                                const matchingJob = jobCards.find(j => j.jobCardNo.toLowerCase() === mov.jobCardNo.toLowerCase());
                                if (!matchingJob) return null;
                                return (
                                  <div className="mt-2 p-2 bg-white dark:bg-slate-900/90 rounded-lg border border-slate-200/80 dark:border-slate-800 flex items-center gap-2 flex-wrap text-xs">
                                    <span className="font-bold text-slate-900 dark:text-slate-100 font-sans">{matchingJob.itemName}</span>
                                    <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                      Item Code: {matchingJob.itemCode || '-'}
                                    </span>
                                    {matchingJob.partyName && (
                                      <span className="text-[10.5px] text-slate-500 font-medium">({matchingJob.partyName})</span>
                                    )}
                                  </div>
                                );
                              })()}
                              <p className="font-semibold text-slate-850 dark:text-white mt-1.5 font-sans">
                                Sender: {mov.fromDepartment} department ({mov.transferBy})
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                                Quantity Transferred: <strong className="text-indigo-600 dark:text-indigo-400">{mov.quantity} KG</strong> | Date: {new Date(mov.transferDate).toLocaleDateString([], {hour:'2-digit', minute:'2-digit'})}
                              </p>
                              {mov.remarks && (
                                <p className="mt-1 text-[10px] text-slate-400 bg-white dark:bg-slate-900 p-1.5 rounded italic">
                                  "{mov.remarks}"
                                </p>
                              )}

                              {activeDept === 'Store' && (
                                <div className="mt-3 pt-3 border-t border-slate-200/65 dark:border-slate-800 space-y-3 text-left">
                                  {mov.fromDepartment === 'Purchase' && (
                                    <div className="bg-slate-100/70 dark:bg-slate-900/40 p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800">
                                      <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-2">
                                        📥 Routing Disposition (Where should this purchased material go next?)
                                      </label>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setPurchaseIncomingRouting(prev => ({ ...prev, [mov.movementId]: 'Store' }))}
                                          className={`flex-1 py-1.5 px-2 rounded-md font-bold text-[11px] border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                            (purchaseIncomingRouting[mov.movementId] || 'Store') === 'Store'
                                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-400 font-sans'
                                              : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700 font-sans'
                                          }`}
                                        >
                                          🏢 Place into Store
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setPurchaseIncomingRouting(prev => ({ ...prev, [mov.movementId]: 'Packing' }))}
                                          className={`flex-1 py-1.5 px-2 rounded-md font-bold text-[11px] border transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                            purchaseIncomingRouting[mov.movementId] === 'Packing'
                                              ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500 text-indigo-700 dark:text-indigo-400 font-sans'
                                              : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500 border-slate-200 dark:border-slate-700 font-sans'
                                          }`}
                                        >
                                          📦 Send to Packing
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {(mov.fromDepartment !== 'Purchase' || (purchaseIncomingRouting[mov.movementId] || 'Store') === 'Store') ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      <div>
                                        <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">
                                          Allotted Location / Shelf Coordinate
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="E.g., Shelf-B3, BIN-7"
                                          value={storeIncomingLocs[mov.movementId] || ''}
                                          onChange={e => setStoreIncomingLocs(prev => ({ ...prev, [mov.movementId]: e.target.value }))}
                                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100"
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">
                                          Rack No / Compartment
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="E.g., RACK-12, Section-A"
                                          value={storeIncomingRacks[mov.movementId] || ''}
                                          onChange={e => setStoreIncomingRacks(prev => ({ ...prev, [mov.movementId]: e.target.value }))}
                                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono text-[11px] font-bold text-slate-800 dark:text-slate-100"
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 rounded-lg border border-dashed border-indigo-200 dark:border-indigo-900 flex items-center gap-2">
                                      <span className="text-sm">⚡</span>
                                      <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium font-sans">
                                        This purchased material will be immediately transferred downstream to the **Packing** queue.
                                      </p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 sm:mt-0 w-full sm:w-auto shrink-0">
                              <button
                                onClick={() => handleLocalAccept(mov)}
                                disabled={isAccepting}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition duration-200 flex-1 sm:flex-none flex items-center justify-center gap-1.5 min-h-[44px] cursor-pointer"
                              >
                                <Check className="h-4 w-4" />
                                <span>Accept Cargo</span>
                              </button>
                              <button
                                onClick={() => {
                                  setActiveRejectionId(isRejecting ? null : mov.movementId);
                                  setRejectionNotes('');
                                }}
                                disabled={isAccepting}
                                className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition duration-200 flex-1 sm:flex-none flex items-center justify-center min-h-[44px] cursor-pointer"
                              >
                                Reject Cargo
                              </button>
                            </div>
                          </div>

                          {/* Rejection Remarks Form */}
                          {isRejecting && (
                            <div className="mt-2 pt-3 border-t border-slate-200 text-xs space-y-2 bg-rose-50/20 dark:bg-rose-950/20 p-3 rounded-lg">
                              <label className="block text-rose-500 font-bold uppercase tracking-wider text-[9px]">
                                Provide Declinature / Rejection reason remarks
                              </label>
                              <textarea
                                rows={2}
                                placeholder="Describe exact inspection failures (e.g. Dimensions incorrect, surface flaws, oxidation)..."
                                value={rejectionNotes}
                                onChange={e => setRejectionNotes(e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-2 focus:outline-none focus:border-rose-500"
                              />
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  onClick={() => setActiveRejectionId(null)}
                                  className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded text-[10px] font-bold"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    if (!rejectionNotes) return;
                                    onRejectMovement(mov.movementId, rejectionNotes);
                                    setActiveRejectionId(null);
                                  }}
                                  disabled={!rejectionNotes}
                                  className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-[10px] font-bold disabled:opacity-40"
                                >
                                  Finalize Rejection Back to Sender
                                </button>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {activeDept === 'Store' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                  🚚 Dispatch Material Issue Requests
                </h3>
                {pendingIssueRequests.length === 0 ? (
                  <div className="text-center py-8 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    <span className="text-xl">📋</span>
                    <p className="text-slate-400 text-xs font-mono font-medium">No pending Dispatch issue requests found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout">
                      {pendingIssueRequests.map(req => {
                        const isIssuing = activeIssueId === req.movementId;
                        const isRejectingReq = activeIssueRejectionId === req.movementId;
                        const isAccepting = acceptedMovementIds[req.movementId] === 'animating';
                        const correspondingJob = jobCards.find(c => c.jobCardNo.toLowerCase() === req.jobCardNo.toLowerCase());
                        
                        return (
                          <motion.div 
                            key={req.movementId}
                            layout
                            initial={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9, height: 0, y: -15, marginBottom: 0, padding: 0 }}
                            transition={{ duration: 0.4, ease: 'easeInOut' }}
                            className="relative bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-indigo-200/50 dark:border-indigo-900/40 flex flex-col gap-3 hover:border-indigo-300 transition-all text-left overflow-hidden"
                          >
                            {/* Success confirmation overlay */}
                            {isAccepting && (
                              <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="absolute inset-0 z-10 bg-emerald-50/95 dark:bg-emerald-950/95 flex flex-col items-center justify-center gap-1.5 p-4 text-center"
                              >
                                <motion.div
                                  initial={{ scale: 0.5, rotate: -30 }}
                                  animate={{ scale: [0.5, 1.25, 1], rotate: 0 }}
                                  transition={{ duration: 0.45, ease: 'easeOut' }}
                                  className="bg-emerald-500 text-white rounded-full p-2 shadow-lg shadow-emerald-500/20"
                                >
                                  <CheckCircle2 className="h-6 w-6 stroke-[2.5]" />
                                </motion.div>
                                <motion.p
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: 0.15, duration: 0.35 }}
                                  className="text-emerald-700 dark:text-emerald-300 font-extrabold text-xs uppercase tracking-wider font-sans"
                                >
                                  Issue Confirmed! 🚚
                                </motion.p>
                                <motion.p
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 0.75 }}
                                  transition={{ delay: 0.3 }}
                                  className="text-emerald-600/90 dark:text-emerald-450 text-[10px] font-mono"
                                >
                                  Material released & handed over...
                                </motion.p>
                              </motion.div>
                            )}

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                              <div>
                                <div className="flex items-center gap-2 font-mono">
                                  <span className="text-indigo-600 dark:text-indigo-400 font-extrabold bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded">
                                    {req.jobCardNo}
                                  </span>
                                  <span className="text-slate-400 font-bold">Request ID: {req.movementId}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap mt-2">
                                  <h4 className="font-extrabold text-slate-900 dark:text-white font-sans text-[12px]">
                                    Party: {correspondingJob?.partyName || 'N/A'} | Item: {correspondingJob?.itemName || 'N/A'}
                                  </h4>
                                  {correspondingJob?.itemCode && (
                                    <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                      Item Code: {correspondingJob.itemCode}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1 font-mono">
                                  Requested Unit: <strong className="text-pink-600 dark:text-pink-400">{req.requestedUnit || 'KGS'}</strong> | Qty: <strong className="text-indigo-600 dark:text-indigo-400">{(req.requestedQty || 0).toLocaleString()}</strong>
                                </p>
                                <p className="text-[10.5px] text-slate-500 mt-0.5 font-sans">
                                  Requested by: <strong className="text-slate-750 dark:text-slate-300">{req.transferBy}</strong> | Date: {new Date(req.transferDate).toLocaleDateString([], {hour:'2-digit', minute:'2-digit'})}
                                </p>
                                {req.remarks && (
                                  <p className="text-[11px] bg-indigo-50/50 dark:bg-indigo-950/20 p-2 rounded border border-indigo-100/60 dark:border-indigo-950 text-indigo-700 dark:text-indigo-400 mt-2 font-sans italic">
                                    💬 Dispatch Remarks: "{req.remarks}"
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
                                <button
                                  onClick={() => {
                                    setActiveIssueId(isIssuing ? null : req.movementId);
                                    setActiveIssueRejectionId(null);
                                    // Default weights
                                    setIssueWeight(correspondingJob?.currentQty || req.quantity);
                                    setIssueLoc(correspondingJob?.storeDetails?.locationBin || '');
                                    setIssueRack(correspondingJob?.storeDetails?.rackNo || '');
                                    setIssueRemarksState('');
                                  }}
                                  disabled={isAccepting}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold py-1.5 px-3 rounded-md transition duration-200 flex items-center gap-1 cursor-pointer"
                                >
                                  <Check className="h-3 w-3" />
                                  Issue Material
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveIssueRejectionId(isRejectingReq ? null : req.movementId);
                                    setActiveIssueId(null);
                                    setIssueRejectionNotes('');
                                  }}
                                  disabled={isAccepting}
                                  className="bg-rose-600 hover:bg-rose-500 text-white text-[10.5px] font-bold py-1.5 px-3 rounded-md transition duration-200 cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>

                            {/* Issue Material Confirmation Panel */}
                            {isIssuing && (
                              <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-3 font-sans text-left bg-emerald-50/10 p-3 rounded-lg border border-dashed border-emerald-500/20">
                                <label className="block text-emerald-600 dark:text-emerald-400 font-extrabold uppercase tracking-wider text-[10px]">
                                  Release & Weight Verification Sign-off
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  <div>
                                    <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Actual Weight to Issue (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={issueWeight || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/[^0-9.]/g, '');
                                        setIssueWeight(clean === '' ? 0 : parseFloat(clean));
                                      }}
                                      placeholder="0"
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 font-mono text-[11px] font-bold text-slate-800 dark:text-white"
                                    />
                                    <p className="text-[9.5px] text-slate-400 mt-1">
                                      *Enter precise scale reading in KG
                                    </p>
                                  </div>
                                  <div>
                                    <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Allotted Bin Location</label>
                                    <input
                                      type="text"
                                      placeholder="E.g., Shelf-B3"
                                      value={issueLoc}
                                      onChange={e => setIssueLoc(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-[11px]"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Rack No</label>
                                    <input
                                      type="text"
                                      placeholder="E.g., Rack-4"
                                      value={issueRack}
                                      onChange={e => setIssueRack(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-[11px]"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Gate Pass / Release Remarks</label>
                                  <input
                                    type="text"
                                    placeholder="Released to Dispatch. Weight verified."
                                    value={issueRemarksState}
                                    onChange={e => setIssueRemarksState(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-[11px]"
                                  />
                                </div>
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => setActiveIssueId(null)}
                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded font-bold text-[10px]"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!issueWeight) return;
                                      setAcceptedMovementIds(prev => ({ ...prev, [req.movementId]: 'animating' }));
                                      
                                      if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                        try { navigator.vibrate(55); } catch (_) {}
                                      }

                                      setTimeout(async () => {
                                        try {
                                          await onAcceptMovement(req.movementId, issueRemarksState || 'Released & Issued', {
                                            allottedLocation: issueLoc,
                                            rackNo: issueRack,
                                            quantity: issueWeight,
                                            issueStatus: 'Issued'
                                          });
                                          setActiveIssueId(null);
                                          setAcceptedMovementIds(prev => ({ ...prev, [req.movementId]: 'done' }));
                                        } catch (err) {
                                          console.error("Failed to accept issue:", err);
                                          setAcceptedMovementIds(prev => {
                                            const updated = { ...prev };
                                            delete updated[req.movementId];
                                            return updated;
                                          });
                                        }
                                      }, 1150);
                                    }}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[10px]"
                                  >
                                    Confirm Issue & Release
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Reject Issue Request Panel */}
                            {isRejectingReq && (
                              <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2 bg-rose-50/20 dark:bg-rose-950/20 p-3 rounded-lg text-left">
                                <label className="block text-rose-500 font-bold uppercase tracking-wider text-[9px]">
                                  Reason for rejecting Dispatch Request
                                </label>
                                <textarea
                                  rows={2}
                                  placeholder="Describe exact reasons (e.g. Stock mismatch, QC hold, physical verification failed)..."
                                  value={issueRejectionNotes}
                                  onChange={e => setIssueRejectionNotes(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-2 focus:outline-none focus:border-rose-500"
                                />
                                <div className="flex gap-1.5 justify-end">
                                  <button
                                    onClick={() => setActiveIssueRejectionId(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded text-[10px] font-bold"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!issueRejectionNotes) return;
                                      await onRejectMovement(req.movementId, issueRejectionNotes);
                                      setActiveIssueRejectionId(null);
                                    }}
                                    disabled={!issueRejectionNotes}
                                    className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-[10px] font-bold disabled:opacity-40"
                                  >
                                    Confirm Rejection
                                  </button>
                                </div>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeDept === 'Raw Material Store' && (
          <div className="lg:col-span-2 space-y-4">
            {/* Action Bar Header */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-sans font-extrabold text-sm text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <span>🏬 Raw Material Store Operations</span>
                </h3>
                <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Manage wire stock, issue requests, and process wire quantity rejections with automatic inventory deductions.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowWireRejectionModal(true)}
                  className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <span>🚫 Reject / Scrap Wire Quantity</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawMaterialRequestModal(true)}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                >
                  <span>📋 Request Raw Material</span>
                </button>
              </div>
            </div>

            {/* Direct Wire Rejection Modal / Card */}
            {showWireRejectionModal && (
              <div className="bg-rose-50/40 dark:bg-rose-950/20 border-2 border-rose-300 dark:border-rose-900/60 rounded-2xl p-5 space-y-4 shadow-lg text-left font-sans">
                <div className="flex items-center justify-between border-b border-rose-200 dark:border-rose-900/40 pb-2">
                  <h4 className="font-extrabold text-rose-800 dark:text-rose-300 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <span>🚫 Raw Material Wire Coil Rejection & Stock Deduction</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setShowWireRejectionModal(false)}
                    className="text-slate-400 hover:text-slate-600 text-xs font-bold px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 cursor-pointer"
                  >
                    ✕ Close
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-300 font-bold uppercase text-[9.5px] mb-1">
                      Select Wire Material Coil Code
                    </label>
                    <select
                      value={selectedRejectMaterialCode}
                      onChange={e => setSelectedRejectMaterialCode(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 font-bold text-slate-800 dark:text-slate-100"
                    >
                      {getDynamicRawMaterialsStock(movements).map(rm => (
                        <option key={rm.code} value={rm.code}>
                          {rm.code} - {rm.name} (Stock: {rm.availableStock.toLocaleString()} KG)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-rose-600 dark:text-rose-400 font-bold uppercase text-[9.5px] mb-1">
                      Wire Quantity to Reject (KG) *
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={wireRejectQty || ''}
                      onChange={e => {
                        const clean = e.target.value.replace(/\D/g, '');
                        setWireRejectQty(clean === '' ? 0 : parseInt(clean, 10));
                      }}
                      placeholder="E.g. 100"
                      className="w-full bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 rounded-lg p-2 font-mono font-bold text-rose-700 dark:text-rose-300"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-600 dark:text-slate-300 font-bold uppercase text-[9.5px] mb-1">
                      Rejection Reason / Category *
                    </label>
                    <select
                      value={wireRejectReason}
                      onChange={e => setWireRejectReason(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                    >
                      <option value="Corroded / Rusted Wire Coil">Corroded / Rusted Wire Coil</option>
                      <option value="Wire Gauge / Diameter Deviation">Wire Gauge / Diameter Deviation</option>
                      <option value="Tensile Strength / Metallurgical Failure">Tensile Strength / Metallurgical Failure</option>
                      <option value="Bent / Tangled / Damaged Wire Coil">Bent / Tangled / Damaged Wire Coil</option>
                      <option value="Physical Audit Shortage / Scrap">Physical Audit Shortage / Scrap</option>
                      <option value="QC Inspection Reject">QC Inspection Reject</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 dark:text-slate-300 font-bold uppercase text-[9.5px] mb-1">
                      Associated Job Card No (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="E.g. JC-2026-001 or leave blank"
                      value={wireRejectJobCardNo}
                      onChange={e => setWireRejectJobCardNo(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs font-mono"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-slate-600 dark:text-slate-300 font-bold uppercase text-[9.5px] mb-1">
                      Storekeeper / Inspector Remarks
                    </label>
                    <input
                      type="text"
                      placeholder="Provide specific notes regarding why this wire quantity is rejected..."
                      value={wireRejectRemarks}
                      onChange={e => setWireRejectRemarks(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-xs"
                    />
                  </div>
                </div>

                <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between font-mono">
                  <span>ℹ️ Submitting this wire rejection will automatically deduct <strong>{wireRejectQty} KG</strong> from the store inventory balance for <strong>{selectedRejectMaterialCode}</strong>.</span>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWireRejectionModal(false)}
                    className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!selectedRejectMaterialCode || wireRejectQty <= 0 || isSubmittingWireRejection}
                    onClick={handleDirectWireRejection}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold uppercase cursor-pointer transition"
                  >
                    {isSubmittingWireRejection ? 'Processing...' : 'Confirm Wire Rejection & Deduct Stock'}
                  </button>
                </div>
              </div>
            )}

            {/* Pending Requests Container */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                🔧 Production Raw Material Requests
              </h3>
              {pendingRawMaterialRequests.length === 0 ? (
                <div className="text-center py-8 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-xl">📋</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">No pending Production raw material requests found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {pendingRawMaterialRequests.map(req => {
                      const isIssuing = activeRawIssueId === req.movementId;
                      const isRejectingReq = activeRawIssueRejectionId === req.movementId;
                      const isAccepting = acceptedMovementIds[req.movementId] === 'animating';
                      const correspondingJob = jobCards.find(c => c.jobCardNo.toLowerCase() === req.jobCardNo.toLowerCase());
                      const materialName = req.processDetails?.rawMaterialName || 'Raw Material';
                      const materialCode = req.processDetails?.rawMaterialCode || 'N/A';
                      
                      return (
                        <motion.div 
                          key={req.movementId}
                          layout
                          initial={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9, height: 0, y: -15, marginBottom: 0, padding: 0 }}
                          transition={{ duration: 0.4, ease: 'easeInOut' }}
                          className="relative bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-indigo-200/50 dark:border-indigo-900/40 flex flex-col gap-3 hover:border-indigo-300 transition-all text-left overflow-hidden"
                        >
                          {/* Success confirmation overlay */}
                          {isAccepting && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="absolute inset-0 z-10 bg-emerald-50/95 dark:bg-emerald-950/95 flex flex-col items-center justify-center gap-1.5 p-4 text-center"
                            >
                              <span className="text-2xl animate-bounce">✅</span>
                              <span className="font-extrabold text-xs text-emerald-800 dark:text-emerald-400 uppercase tracking-wide">Request Issued Successfully</span>
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-500 font-mono">Updating central ledger...</span>
                            </motion.div>
                          )}

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-200/60 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                  {req.jobCardNo}
                                </span>
                                <span className="text-[10px] font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200/40 px-1.5 py-0.5 rounded uppercase font-sans">
                                  Pending Issue
                                </span>
                              </div>
                              <h4 className="font-sans font-bold text-slate-800 dark:text-slate-100 text-xs mt-1.5">
                                Request: <span className="text-indigo-600 dark:text-indigo-400">{materialName} ({materialCode})</span>
                              </h4>
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                Requested Qty: <strong className="text-slate-600 dark:text-slate-300">{req.requestedQty || req.quantity} KG</strong>
                              </p>
                              {correspondingJob && (
                                <p className="text-[10px] text-slate-500 font-sans mt-1 flex items-center gap-1.5 flex-wrap">
                                  <span>Party: <strong>{correspondingJob.partyName}</strong></span>
                                  <span>|</span>
                                  <span>Item: <strong>{correspondingJob.itemName}</strong></span>
                                  {correspondingJob.itemCode && (
                                    <span className="font-mono text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 px-1.5 py-0.2 rounded">
                                      Item Code: {correspondingJob.itemCode}
                                    </span>
                                  )}
                                </p>
                              )}
                            </div>

                            <div className="flex gap-1.5 sm:self-center shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveRawIssueRejectionId(req.movementId);
                                  setActiveRawIssueId(null);
                                  setRawIssueRejectionNotes('');
                                }}
                                className="px-2.5 py-1 text-[10px] font-bold font-sans rounded-md bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/40 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 dark:border-rose-900/30 cursor-pointer transition"
                              >
                                Reject Request
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveRawIssueId(req.movementId);
                                  setActiveRawIssueRejectionId(null);
                                  setRawIssueWeight(req.requestedQty || req.quantity);
                                  setRawIssueLoc('BIN-RM1');
                                  setRawIssueRemarks('Approved & issued to production shop floor');
                                }}
                                className="px-2.5 py-1 text-[10px] font-bold font-sans rounded-md bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition"
                              >
                                Issue Material
                              </button>
                            </div>
                          </div>

                          {/* Issue Form Panel */}
                          {isIssuing && (
                            <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-3 font-sans text-left bg-emerald-50/10 p-3 rounded-lg border border-dashed border-emerald-500/20">
                              <label className="block text-emerald-600 dark:text-emerald-400 font-extrabold uppercase tracking-wider text-[10px]">
                                Raw Material Issuance Verification
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Actual Qty to Issue (KG)</label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={rawIssueWeight || ''}
                                    onChange={e => {
                                      const clean = e.target.value.replace(/[^0-9.]/g, "");
                                      setRawIssueWeight(clean === "" ? 0 : parseFloat(clean));
                                    }}
                                    placeholder="0"
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 font-mono text-[11px] font-bold text-slate-800 dark:text-white"
                                  />
                                  <p className="text-[9.5px] text-slate-400 mt-1">
                                    *Verify on scales before issuing
                                  </p>
                                </div>
                                <div>
                                  <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Allotted Bin/Location</label>
                                  <input
                                    type="text"
                                    placeholder="E.g., RM-Shelf-2"
                                    value={rawIssueLoc}
                                    onChange={e => setRawIssueLoc(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-[11px]"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-slate-400 text-[10px] mb-1 font-bold uppercase">Remarks</label>
                                <input
                                  type="text"
                                  placeholder="Released to production. Weight verified."
                                  value={rawIssueRemarks}
                                  onChange={e => setRawIssueRemarks(e.target.value)}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1.5 text-[11px]"
                                />
                              </div>
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveRawIssueId(null)}
                                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded font-bold text-[10px]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!rawIssueWeight) return;
                                    setAcceptedMovementIds(prev => ({ ...prev, [req.movementId]: 'animating' }));
                                    
                                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                      try { navigator.vibrate(55); } catch (_) {}
                                    }

                                    setTimeout(async () => {
                                      try {
                                        await onAcceptMovement(req.movementId, rawIssueRemarks || 'Released & Issued', {
                                          allottedLocation: rawIssueLoc,
                                          rackNo: 'N/A',
                                          quantity: rawIssueWeight,
                                          issueStatus: 'Issued'
                                        });
                                        setActiveRawIssueId(null);
                                        setAcceptedMovementIds(prev => ({ ...prev, [req.movementId]: 'done' }));
                                      } catch (err) {
                                        console.error("Failed to accept raw material issue:", err);
                                        setAcceptedMovementIds(prev => {
                                          const updated = { ...prev };
                                          delete updated[req.movementId];
                                          return updated;
                                        });
                                      }
                                    }, 1150);
                                  }}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[10px]"
                                >
                                  Confirm Issue & Release
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Reject Form Panel */}
                          {isRejectingReq && (
                            <div className="mt-2 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs space-y-2 bg-rose-50/20 dark:bg-rose-950/20 p-3 rounded-lg text-left">
                              <label className="block text-rose-500 font-bold uppercase tracking-wider text-[9px]">
                                Reason for rejecting Raw Material Request
                              </label>
                              <textarea
                                rows={2}
                                placeholder="Describe exact reasons (e.g. Defective wire coil, stock corrupted)..."
                                value={rawIssueRejectionNotes}
                                onChange={e => setRawIssueRejectionNotes(e.target.value)}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-2 focus:outline-none focus:border-rose-500 text-xs"
                              />
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  type="button"
                                  onClick={() => setActiveRawIssueRejectionId(null)}
                                  className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded text-[10px] font-bold"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!rawIssueRejectionNotes) return;
                                    const reqQty = req.requestedQty || req.quantity || 0;
                                    const matCode = req.processDetails?.rawMaterialCode || 'N/A';
                                    const matName = req.processDetails?.rawMaterialName || 'Raw Material';

                                    // Reject movement & deduct rejected wire qty from store stock
                                    await onAcceptMovement(req.movementId, rawIssueRejectionNotes, {
                                      issueStatus: 'Rejected',
                                      quantity: reqQty
                                    });

                                    if (reqQty > 0 && matCode !== 'N/A') {
                                      try {
                                        await onCreateMovement({
                                          jobCardNo: req.jobCardNo || (`RM-REJECT-${matCode}`),
                                          fromDepartment: 'Raw Material Store',
                                          toDepartment: 'Raw Material Store',
                                          quantity: reqQty,
                                          isIssueRequest: true,
                                          issueStatus: 'Rejected',
                                          processDetails: {
                                            rawMaterialCode: matCode,
                                            rawMaterialName: matName,
                                            isWireRejection: true,
                                            rejectedQty: reqQty,
                                            rejectionReason: `Rejected Request: ${rawIssueRejectionNotes}`,
                                            requestedBy: currentUser?.name || 'Raw Material Store Keeper',
                                            urgency: 'High'
                                          },
                                          remarks: `🚫 Request Rejected & Stock Deducted: ${reqQty} KG of ${matCode}. Notes: ${rawIssueRejectionNotes}`
                                        });
                                      } catch (e) {
                                        console.error("Non-fatal request rejection log error:", e);
                                      }
                                    }
                                    
                                    setActiveRawIssueRejectionId(null);
                                  }}
                                  disabled={!rawIssueRejectionNotes}
                                  className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded text-[10px] font-bold disabled:opacity-40 cursor-pointer"
                                >
                                  Confirm Rejection & Deduct Wire Stock
                                </button>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Wire Rejection & Stock Deductions Ledger */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm text-left">
              <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center justify-between">
                <span className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  🚫 Wire Rejections & Auto-Deductions Ledger
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  (Total Auto-Deducted: {movements
                    .filter(m => m.fromDepartment === 'Raw Material Store' && (m.issueStatus === 'Rejected' || m.processDetails?.isWireRejection))
                    .reduce((sum, m) => sum + (m.processDetails?.rejectedQty || m.quantity || m.requestedQty || 0), 0)
                    .toLocaleString()} KG)
                </span>
              </h3>

              {movements.filter(m => m.fromDepartment === 'Raw Material Store' && (m.issueStatus === 'Rejected' || m.processDetails?.isWireRejection)).length === 0 ? (
                <div className="text-center py-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <p className="text-slate-400 text-xs font-mono">No wire rejections logged in current store records</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Material Code</th>
                        <th className="py-2 px-3">Job / Ref No</th>
                        <th className="py-2 px-3">Deducted Qty</th>
                        <th className="py-2 px-3">Rejection Reason</th>
                        <th className="py-2 px-3">Remarks / Inspector Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements
                        .filter(m => m.fromDepartment === 'Raw Material Store' && (m.issueStatus === 'Rejected' || m.processDetails?.isWireRejection))
                        .slice(0, 15)
                        .map(m => (
                          <tr key={m.movementId} className="border-b last:border-b-0 border-slate-100 dark:border-slate-850 hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 font-mono text-slate-400">
                              {new Date(m.transferDate || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {m.processDetails?.rawMaterialCode || 'Wire Stock'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                              {m.jobCardNo}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-extrabold text-rose-600 dark:text-rose-400">
                              -{(m.processDetails?.rejectedQty || m.quantity || m.requestedQty || 0).toLocaleString()} KG
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40">
                                {m.processDetails?.rejectionReason || 'Wire Defect'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">
                              {m.remarks || 'Direct wire quantity store rejection'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

          {/* B. OPERATIONS PANEL SUBVIEW (ACTIVE PRODUCTION STEPS AND FIELDS UPDATES) */}
          {activeSubView === 'operations' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <span>⚙️ In-Process Shop Floor Queue</span>
                  <span className="text-xs text-slate-400 font-mono font-normal">({activeDepartmentJobs.length} active)</span>
                </h3>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-800/50 rounded-xl font-mono text-xs font-extrabold text-indigo-700 dark:text-indigo-300 self-start sm:self-auto">
                  <span className="text-[10px] text-indigo-500 uppercase font-bold font-sans">Queue Total WIP:</span>
                  <span>{totalDeptWipQty.toLocaleString()} KG</span>
                </div>
              </div>

              {activeDepartmentJobs.length === 0 ? (
                <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-2xl">⚡</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">Floor queue clear. Await material ingestion or dispatch approvals.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeDepartmentJobs.map(job => {
                    const isProcessing = 
                      ((activeDept as any) === 'Purchase' && activePurchaseJob === job.jobCardNo) ||
                      (activeDept === 'Production' && activeProdJob === job.jobCardNo) ||
                      (activeDept === 'Heat Treatment' && activeHtJob === job.jobCardNo) ||
                      (activeDept === 'Plating' && activePlatingJob === job.jobCardNo) ||
                      (activeDept === 'Packing' && activePackingJob === job.jobCardNo) ||
                      (activeDept === 'Store' && activeStoreJob === job.jobCardNo) ||
                      (activeDept === 'Raw Material Store' && activeRawStoreJob === job.jobCardNo);

                    const m = getJobCardProcessMetrics(job, movements);
                    const totalMovedFromProd = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Production')
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const pendingProdQty = job.orderQty - totalMovedFromProd;
                    const isRoutedDownstream = job.currentDepartment !== 'Production';

                    // 1. Heat Treatment variables
                    const totalReceivedAtHT = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.toDepartment === 'Heat Treatment' && m.accepted)
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const htInputDisplay = totalReceivedAtHT > 0 ? totalReceivedAtHT : (job.currentDepartment === 'Heat Treatment' ? m.qtyReceivedFromProd : 0);
                    const totalRoutedFromHT = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Heat Treatment')
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const pendingHTQty = Math.max(0, htInputDisplay - totalRoutedFromHT - (job.heatTreatmentDetails?.rejectionQty || 0));
                    const isHTRoutedDownstream = job.currentDepartment !== 'Heat Treatment';

                    // 2. Plating variables
                    const totalReceivedAtPlating = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.toDepartment === 'Plating' && m.accepted)
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const platingInputDisplay = totalReceivedAtPlating > 0 ? totalReceivedAtPlating : (job.currentDepartment === 'Plating' ? m.qtyReceivedAtPlating : 0);
                    const totalRoutedFromPlating = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Plating')
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const pendingPlatingQty = Math.max(0, platingInputDisplay - totalRoutedFromPlating - (job.platingDetails?.rejectionQty || 0));
                    const isPlatingRoutedDownstream = job.currentDepartment !== 'Plating';

                    // 3. Packing variables
                    const totalReceivedAtPacking = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.toDepartment === 'Packing' && m.accepted)
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const packingInputDisplay = totalReceivedAtPacking > 0 ? totalReceivedAtPacking : (job.currentDepartment === 'Packing' ? m.qtyReceivedAtPacking : 0);
                    const totalRoutedFromPacking = movements
                      .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.fromDepartment === 'Packing')
                      .reduce((sum, m) => sum + m.quantity, 0);
                    const pendingPackingQty = Math.max(0, packingInputDisplay - totalRoutedFromPacking - (job.packingDetails?.rejectionQty || 0));
                    const isPackingRoutedDownstream = job.currentDepartment !== 'Packing';

                    return (
                      <div 
                        key={job.jobCardNo}
                        className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col gap-3.5 hover:border-slate-350"
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                          <div onClick={() => onSelectJobCard(job)} className="cursor-pointer hover:underline min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-mono text-[11px] flex-wrap">
                              <span className="text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded">{job.jobCardNo}</span>
                              <JobStatusBadge status={job.status} size="xs" />
                              {job.materialType && (
                                <span className={`px-2 py-0.2 rounded font-bold uppercase text-[9px] ${
                                  job.materialType === 'Raw Material'
                                    ? 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400'
                                    : job.materialType === 'Semi Finished Goods'
                                    ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400'
                                    : 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                                }`}>
                                  {job.materialType === 'Raw Material' ? '🪵 Raw Mat' : job.materialType === 'Semi Finished Goods' ? '⚙️ Semi Fin' : '📦 Fin Goods'}
                                </span>
                              )}
                            </div>
                            <p className="font-extrabold text-slate-900 dark:text-white mt-1.5 font-sans text-sm">
                              {job.partyName}
                            </p>
                            {activeDept === 'Production' ? (
                              <div className="space-y-1 mt-1.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold">
                                  <span>{job.itemName}</span>
                                  <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                    Item Code: {job.itemCode || '-'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-2 bg-slate-100/70 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/40">
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Total Order</span>
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-white">{job.orderQty.toLocaleString()} {job.unit || 'KG'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-455 uppercase font-bold">Produced & Routed</span>
                                    <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">{totalMovedFromProd.toLocaleString()} {job.unit || 'KG'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-amber-600 dark:text-amber-400 uppercase font-bold">✂️ Wire Scrap</span>
                                    <span className="text-xs font-bold font-mono text-amber-700 dark:text-amber-300">{getWireScrapQty(job, movements).toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-indigo-600 dark:text-indigo-455 uppercase font-bold">Issued Material</span>
                                    <span className="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400">{getRawMaterialIssuedQty(job, movements).toLocaleString()} {job.unit || 'KG'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-amber-500 uppercase font-bold">Pending Production</span>
                                    <span className="text-xs font-bold font-mono text-amber-600 dark:text-amber-400">{pendingProdQty.toLocaleString()} {job.unit || 'KG'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Current Custody</span>
                                    <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400">{job.currentDepartment} ({job.currentQty} {job.unit || 'KG'})</span>
                                  </div>
                                </div>
                                {job.processType !== 'Purchase' && (
                                  getRawMaterialIssuedQty(job, movements) <= 0 ? (
                                    isRawMaterialCompulsory ? (
                                      <div onClick={(e) => e.stopPropagation()} className="mt-2.5 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl flex items-center justify-between gap-2 text-amber-800 dark:text-amber-300 font-medium text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm">⚠️</span>
                                          <span>Raw Material / Wire has not been issued yet from Store. Production cannot be started.</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedJobCardForRMRequest(job.jobCardNo);
                                            setShowRawMaterialRequestModal(true);
                                          }}
                                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg font-extrabold text-[10px] uppercase tracking-wider transition shrink-0 cursor-pointer shadow-xs border border-indigo-500/30 flex items-center gap-1"
                                        >
                                          <span>🪵 Request Wire / RM</span>
                                        </button>
                                      </div>
                                    ) : (
                                      <div onClick={(e) => e.stopPropagation()} className="mt-2.5 p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-xl flex items-center justify-between gap-2 text-emerald-800 dark:text-emerald-300 font-medium text-[11px]">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm">ℹ️</span>
                                          <span>Raw Material requirement is currently disabled by Super Admin. Direct production allowed.</span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedJobCardForRMRequest(job.jobCardNo);
                                            setShowRawMaterialRequestModal(true);
                                          }}
                                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition shrink-0 cursor-pointer shadow-xs"
                                        >
                                          <span>+ Request RM</span>
                                        </button>
                                      </div>
                                    )
                                  ) : (
                                    <div onClick={(e) => e.stopPropagation()} className="mt-2.5 p-2.5 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/40 rounded-xl flex items-center justify-between gap-2 text-indigo-900 dark:text-indigo-200 font-medium text-[11px]">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm">🪵</span>
                                        <span>Issued RM so far: <strong className="text-indigo-700 dark:text-indigo-300 font-mono font-bold">{getRawMaterialIssuedQty(job, movements).toLocaleString()} {job.unit || 'KG'}</strong>. Need more material?</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedJobCardForRMRequest(job.jobCardNo);
                                          setShowRawMaterialRequestModal(true);
                                        }}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg font-extrabold text-[10px] uppercase tracking-wider transition shrink-0 cursor-pointer shadow-xs flex items-center gap-1 border border-indigo-500/30"
                                      >
                                        <span>+ Request Additional Wire / RM</span>
                                      </button>
                                    </div>
                                  )
                                )}
                                {isRoutedDownstream && (
                                  <div className="mt-1.5 text-[10.5px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 font-sans">
                                    <span>↪️ Currently processing downstream at {job.currentDepartment}. Remaining pending quantity can be processed & transferred below.</span>
                                  </div>
                                )}
                              </div>
                            ) : activeDept === 'Heat Treatment' ? (
                              <div className="space-y-1 mt-1.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold">
                                  <span>{job.itemName}</span>
                                  <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                    Item Code: {job.itemCode || '-'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 bg-slate-100/70 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/40">
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Total Received</span>
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-white">{htInputDisplay.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-450 uppercase font-bold">Hardened & Routed</span>
                                    <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">{totalRoutedFromHT.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-amber-500 uppercase font-bold">Pending Hardening</span>
                                    <span className="text-xs font-bold font-mono text-amber-600 dark:text-amber-400">{pendingHTQty.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Current Custody</span>
                                    <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400">{job.currentDepartment} ({job.currentQty} KG)</span>
                                  </div>
                                </div>
                                {isHTRoutedDownstream && (
                                  <div className="mt-1.5 text-[10.5px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 font-sans">
                                    <span>↪️ Currently processing downstream at {job.currentDepartment}. Remaining pending quantity can be processed & transferred below.</span>
                                  </div>
                                )}
                              </div>
                            ) : activeDept === 'Plating' ? (
                              <div className="space-y-1 mt-1.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold">
                                  <span>{job.itemName}</span>
                                  <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                    Item Code: {job.itemCode || '-'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 bg-slate-100/70 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/40">
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Total Received</span>
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-white">{platingInputDisplay.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-450 uppercase font-bold">Coated & Routed</span>
                                    <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">{totalRoutedFromPlating.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-amber-500 uppercase font-bold">Pending Plating</span>
                                    <span className="text-xs font-bold font-mono text-amber-600 dark:text-amber-400">{pendingPlatingQty.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Current Custody</span>
                                    <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400">{job.currentDepartment} ({job.currentQty} KG)</span>
                                  </div>
                                </div>
                                {isPlatingRoutedDownstream && (
                                  <div className="mt-1.5 text-[10.5px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 font-sans">
                                    <span>↪️ Currently processing downstream at {job.currentDepartment}. Remaining pending quantity can be processed & transferred below.</span>
                                  </div>
                                )}
                              </div>
                            ) : activeDept === 'Packing' ? (
                              <div className="space-y-1 mt-1.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold">
                                  <span>{job.itemName}</span>
                                  <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                    Item Code: {job.itemCode || '-'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-2 bg-slate-100/70 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/40">
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Total Received</span>
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-white">{packingInputDisplay.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-450 uppercase font-bold">Packed & Routed</span>
                                    <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">{totalRoutedFromPacking.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-amber-500 uppercase font-bold">Pending Packing</span>
                                    <span className="text-xs font-bold font-mono text-amber-600 dark:text-amber-400">{pendingPackingQty.toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-pink-500 uppercase font-bold">Pcs in Bag/Box</span>
                                    <span className="text-xs font-bold font-mono text-pink-650 dark:text-pink-400">{job.packingDetails?.pcsPerBagOrBox ? `${job.packingDetails.pcsPerBagOrBox} pcs` : 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-indigo-500 uppercase font-bold">Total Pieces (Pcs)</span>
                                    <span className="text-xs font-bold font-mono text-indigo-650 dark:text-indigo-400">{job.packingDetails?.totalPcs ? `${job.packingDetails.totalPcs.toLocaleString()} pcs` : 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Current Custody</span>
                                    <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400">{job.currentDepartment} ({job.currentQty} KG)</span>
                                  </div>
                                </div>
                                {isPackingRoutedDownstream && (
                                  <div className="mt-1.5 text-[10.5px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1 font-sans">
                                    <span>↪️ Currently processing downstream at {job.currentDepartment}. Remaining pending quantity can be processed & transferred below.</span>
                                  </div>
                                )}
                              </div>
                            ) : activeDept === 'Store' ? (
                              <div className="space-y-1 mt-1.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold">
                                  <span>{job.itemName}</span>
                                  <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                    Item Code: {job.itemCode || '-'}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2 bg-slate-100/70 dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200/40">
                                  <div>
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Total Received</span>
                                    <span className="text-xs font-bold font-mono text-slate-800 dark:text-white">{(getJobCardProcessMetrics(job, movements).qtyReceivedAtStore || job.storeDetails?.qtyReceivedFromPacking || 0).toLocaleString()} KG</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-450 uppercase font-bold">Box Count</span>
                                    <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400">{job.packingDetails?.boxCount || 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-pink-500 uppercase font-bold">Pcs in Bag/Box</span>
                                    <span className="text-xs font-bold font-mono text-pink-650 dark:text-pink-400">{job.packingDetails?.pcsPerBagOrBox ? `${job.packingDetails.pcsPerBagOrBox} pcs` : 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-indigo-500 uppercase font-bold">Total Pieces (Pcs)</span>
                                    <span className="text-xs font-bold font-mono text-indigo-650 dark:text-indigo-400">{job.packingDetails?.totalPcs ? `${job.packingDetails.totalPcs.toLocaleString()} pcs` : 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[10px] text-slate-450 uppercase font-bold font-sans">Bin Location</span>
                                    <span className="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400">{job.storeDetails?.locationBin || 'Pending placement'}</span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-700 dark:text-slate-200 font-bold mt-1">
                                <span>{job.itemName}</span>
                                <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
                                  Item Code: {job.itemCode || '-'}
                                </span>
                                <span className="text-[11px] text-slate-400 font-normal">
                                  • Order Qty: {job.orderQty} KG | <strong>Custody Weight: {job.currentQty} KG</strong>
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
                            {job.status === 'Pending' || job.status === 'Rejected' ? (
                              <button
                                onClick={() => {
                                  if ((activeDept as any) === 'Purchase') {
                                    handleStartPurchase(job);
                                  } else {
                                    handleStartProduction(job);
                                  }
                                }}
                                className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11.5px] font-bold py-1.5 px-3.5 rounded-md transition flex items-center gap-1 leading-none cursor-pointer"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                {(activeDept as any) === 'Purchase' ? 'Start Purchase Inwarding' : 'Start Production Processing'}
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  // Set appropriate form parameters before launching sub-form
                                  if ((activeDept as any) === 'Purchase') {
                                    setActivePurchaseJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      setPurchaseRecQty(job.orderQty);
                                      setPurchaseSentQty(job.orderQty);
                                    }
                                  } else if (activeDept === 'Production') {
                                    setActiveProdJob(isProcessing ? null : job.jobCardNo);
                                    setProdQty(pendingProdQty);
                                  } else if (activeDept === 'Heat Treatment') {
                                    setActiveHtJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      setHtQtyReceived(pendingHTQty);
                                      setHtQtySentToPlating(pendingHTQty);
                                    }
                                  } else if (activeDept === 'Plating') {
                                    setActivePlatingJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      setPlatingQtyReceived(pendingPlatingQty);
                                      setPlatingQtySentToPacking(pendingPlatingQty);
                                    }
                                  } else if (activeDept === 'Packing') {
                                    setActivePackingJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      setPackQtyReceived(pendingPackingQty);
                                      setPackQtySentToStore(pendingPackingQty);
                                      setPackQty(pendingPackingQty);
                                      setPackBoxCount(job.packingDetails?.boxCount || 5);
                                      setPackStyle(job.packingDetails?.packingType || 'Corrugated Boxes with wooden pallet support');
                                      setPackPcsPerBagOrBox(job.packingDetails?.pcsPerBagOrBox || 100);
                                      setPackTotalPcs(job.packingDetails?.totalPcs || (job.packingDetails?.boxCount || 5) * (job.packingDetails?.pcsPerBagOrBox || 100));
                                    }
                                  } else if (activeDept === 'Store') {
                                    setActiveStoreJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      const met = getJobCardProcessMetrics(job, movements);
                                      setStoreQtyReceived(met.qtyReceivedAtStore);
                                      const defaultSent = met.qtyDispatched > 0 ? met.qtyDispatched : met.qtyReceivedAtStore;
                                      setStoreQtySentToDispatch(defaultSent);
                                      setStoreVerifiedQty(defaultSent);
                                    }
                                  } else if (activeDept === 'Raw Material Store') {
                                    setActiveRawStoreJob(isProcessing ? null : job.jobCardNo);
                                    if (!isProcessing) {
                                      const met = getJobCardProcessMetrics(job, movements);
                                      const metReceived = movements
                                        .filter(m => m.jobCardNo.toLowerCase() === job.jobCardNo.toLowerCase() && m.toDepartment === 'Raw Material Store' && m.accepted)
                                        .reduce((sum, m) => sum + m.quantity, 0);
                                      setStoreQtyReceived(metReceived || job.currentQty);
                                      setStoreQtySentToDispatch(metReceived || job.currentQty);
                                      setStoreVerifiedQty(metReceived || job.currentQty);
                                    }
                                  }
                                }}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11.5px] font-bold py-1.5 px-3.5 rounded-md transition flex items-center gap-1 leading-none cursor-pointer"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Record Process Metrics
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Inline Process Metrics Form (No popup page) */}
                        {isProcessing && (
                          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs space-y-4 font-sans bg-slate-50/50 dark:bg-slate-900/30 p-4 rounded-xl">
                            <h4 className="font-extrabold text-slate-800 dark:text-slate-100 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                              Record {activeDept} Operational Specs
                            </h4>

                            {activeDept === 'Production' && (
                              <div className="space-y-4">
                                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Milling Lead Operator Name</label>
                                    <input
                                      type="text"
                                      placeholder="E.g. Ramesh Patil"
                                      value={prodOpName}
                                      onChange={e => setProdOpName(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Produced Quantity In KG</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={prodQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        setProdQty(clean === '' ? 0 : parseInt(clean, 10));
                                      }}
                                      placeholder="0"
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-1.5 font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-amber-600 dark:text-amber-400 font-bold uppercase text-[9.5px] tracking-wider mb-1 flex items-center gap-1">
                                      ✂️ Wire Scrap (KG)
                                    </label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={prodWireScrap || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        setProdWireScrap(clean === '' ? 0 : parseInt(clean, 10));
                                      }}
                                      placeholder="0"
                                      className="w-full bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-1.5 font-mono font-bold text-amber-900 dark:text-amber-200 focus:outline-none focus:border-amber-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Wire Scrap Category / Reason</label>
                                    <select
                                      value={prodWireScrapReason}
                                      onChange={e => setProdWireScrapReason(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded p-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    >
                                      <option value="Heading & Cut-Off Waste">Heading & Cut-Off Waste</option>
                                      <option value="Wire Drawing Trimming">Wire Drawing Trimming</option>
                                      <option value="Coil End Scrap">Coil End Scrap</option>
                                      <option value="Die Setting Waste">Die Setting Waste</option>
                                      <option value="Defective Wire Cut">Defective Wire Cut</option>
                                      <option value="Other Wire Scrap">Other Wire Scrap</option>
                                    </select>
                                  </div>
                                </div>
                                {getWireScrapQty(job, movements) > 0 && (
                                  <div className="p-2.5 bg-amber-50/70 dark:bg-amber-950/30 rounded-lg text-[10.5px] text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60 flex items-center justify-between">
                                    <span>✂️ <strong>Previous Wire Scrap Recorded:</strong> {getWireScrapQty(job, movements)} KG</span>
                                    <span className="font-mono text-[9.5px] text-amber-600 dark:text-amber-400">Total Scrap Cumulative</span>
                                  </div>
                                )}
                                <div className="p-3 bg-indigo-50/40 dark:bg-slate-950/20 rounded-lg text-[10.5px] text-slate-600 dark:text-slate-400 border border-indigo-100/35 leading-relaxed">
                                  <strong>Business Routing Rule:</strong> {job.heatTreatmentRequired 
                                    ? '⚠️ Heat Treatment is Required. Completing this step immediately transfers this job to the Furnace line queue.' 
                                    : '✔️ Heat Treatment Skipped. Completing this step transfers cargo directly to Electroplating.'}
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActiveProdJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!prodOpName || prodQty <= 0}
                                    onClick={() => handleCompleteProduction(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Save Production & Route Direct
                                  </button>
                                </div>
                              </div>
                            )}

                            {activeDept === 'Heat Treatment' && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Hardness Achieved</label>
                                    <input
                                      type="text"
                                      value={htHardness}
                                      onChange={e => setHtHardness(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Temperature (°C)</label>
                                    <input
                                      type="text"
                                      value={htTemp}
                                      onChange={e => setHtTemp(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Cycle Duration</label>
                                    <input
                                      type="text"
                                      value={htDuration}
                                      onChange={e => setHtDuration(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-rose-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Furnace Rejection (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={htRejectionQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const rej = Math.max(0, parseInt(clean, 10) || 0);
                                        if (rej > htQtyReceived) {
                                          setHtRejectionQty(htQtyReceived);
                                          setHtQtySentToPlating(0);
                                        } else {
                                          setHtRejectionQty(rej);
                                          setHtQtySentToPlating(Math.max(0, htQtyReceived - rej));
                                        }
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded p-1.5 font-mono font-bold text-rose-650 focus:outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg grid grid-cols-3 gap-3 text-[11px] font-mono border border-slate-200 dark:border-slate-800">
                                  <div>
                                    <span className="text-slate-450 block uppercase text-[8.5px]">Qty Received:</span>
                                    <strong className="text-blue-600">{htQtyReceived} KG</strong>
                                  </div>
                                  <div>
                                    <span className="text-indigo-600 block uppercase text-[8.5px]">Sent to Plating:</span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={htQtySentToPlating}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const val = Math.max(0, parseInt(clean, 10) || 0);
                                        setHtQtySentToPlating(val > htQtyReceived ? htQtyReceived : val);
                                      }}
                                      className="w-16 bg-white dark:bg-slate-950 border border-slate-300 rounded px-1 py-0.2 text-center text-[10.5px] font-bold text-indigo-700"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-amber-600 block uppercase text-[8.5px]">Remaining Balance:</span>
                                    <strong>{Math.max(0, htQtyReceived - htQtySentToPlating - htRejectionQty)} KG</strong>
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActiveHtJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteHeatTreatment(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Save Furnace Logs & Route
                                  </button>
                                </div>
                              </div>
                            )}

                            {activeDept === 'Plating' && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Plating Bath Type</label>
                                    <input
                                      type="text"
                                      value={platingType}
                                      onChange={e => setPlatingType(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Micron Thickness</label>
                                    <input
                                      type="text"
                                      value={platingThick}
                                      onChange={e => setPlatingThick(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Bath Duration</label>
                                    <input
                                      type="text"
                                      value={platingDur}
                                      onChange={e => setPlatingDur(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-rose-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Coating Rejection (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={platingRejectionQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const rej = Math.max(0, parseInt(clean, 10) || 0);
                                        if (rej > platingQtyReceived) {
                                          setPlatingRejectionQty(platingQtyReceived);
                                          setPlatingQtySentToPacking(0);
                                        } else {
                                          setPlatingRejectionQty(rej);
                                          setPlatingQtySentToPacking(Math.max(0, platingQtyReceived - rej));
                                        }
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded p-1.5 font-mono font-bold text-rose-650 focus:outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg grid grid-cols-3 gap-3 text-[11px] font-mono border border-slate-200 dark:border-slate-800">
                                  <div>
                                    <span className="text-slate-455 block uppercase text-[8.5px]">Qty Received:</span>
                                    <strong className="text-blue-600">{platingQtyReceived} KG</strong>
                                  </div>
                                  <div>
                                    <span className="text-indigo-600 block uppercase text-[8.5px]">Sent to Packing:</span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={platingQtySentToPacking}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const val = Math.max(0, parseInt(clean, 10) || 0);
                                        setPlatingQtySentToPacking(val > platingQtyReceived ? platingQtyReceived : val);
                                      }}
                                      className="w-16 bg-white dark:bg-slate-950 border border-slate-300 rounded px-1 py-0.2 text-center text-[10.5px] font-bold text-indigo-700"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-amber-600 block uppercase text-[8.5px]">Remaining Balance:</span>
                                    <strong>{Math.max(0, platingQtyReceived - platingQtySentToPacking - platingRejectionQty)} KG</strong>
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActivePlatingJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompletePlating(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Complete Coating & Route
                                  </button>
                                </div>
                              </div>
                            )}

                            {activeDept === 'Packing' && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Total Boxes count</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={packBoxCount}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const count = Math.max(0, parseInt(clean, 10) || 0);
                                        setPackBoxCount(count);
                                        setPackTotalPcs(count * packPcsPerBagOrBox);
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Pcs per Box</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={packPcsPerBagOrBox}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const pcs = Math.max(0, parseInt(clean, 10) || 0);
                                        setPackPcsPerBagOrBox(pcs);
                                        setPackTotalPcs(packBoxCount * pcs);
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-mono font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-indigo-600 font-bold uppercase text-[9.5px] tracking-wider mb-1">Total Pieces</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={packTotalPcs}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        setPackTotalPcs(Math.max(0, parseInt(clean, 10) || 0));
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-mono font-bold text-indigo-700 dark:text-indigo-400 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-rose-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Packing Rejection (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={packRejectionQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const rej = Math.max(0, parseInt(clean, 10) || 0);
                                        if (rej > packQtyReceived) {
                                          setPackRejectionQty(packQtyReceived);
                                          setPackQtySentToStore(0);
                                          setPackQty(0);
                                        } else {
                                          setPackRejectionQty(rej);
                                          const val = Math.max(0, packQtyReceived - rej);
                                          setPackQtySentToStore(val);
                                          setPackQty(val);
                                        }
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded p-1.5 font-mono font-bold text-rose-650 focus:outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Boxing Style</label>
                                    <input
                                      type="text"
                                      value={packStyle}
                                      onChange={e => setPackStyle(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-semibold text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                  <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg grid grid-cols-3 gap-3 text-[11px] font-mono border border-slate-200 dark:border-slate-800">
                                    <div>
                                      <span className="text-slate-455 block uppercase text-[8.5px]">Qty Received:</span>
                                      <strong className="text-blue-600">{packQtyReceived} KG</strong>
                                    </div>
                                    <div>
                                      <span className="text-indigo-600 block uppercase text-[8.5px]">Sent to Store:</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={packQtySentToStore}
                                        onChange={e => {
                                          const clean = e.target.value.replace(/\D/g, '');
                                          const val = Math.max(0, parseInt(clean, 10) || 0);
                                          setPackQtySentToStore(val > packQtyReceived ? packQtyReceived : val);
                                          setPackQty(val > packQtyReceived ? packQtyReceived : val);
                                        }}
                                        className="w-16 bg-white dark:bg-slate-950 border border-slate-300 rounded px-1 py-0.2 text-center text-[10.5px] font-bold text-indigo-700"
                                      />
                                    </div>
                                    <div>
                                      <span className="text-amber-600 block uppercase text-[8.5px]">Remaining Balance:</span>
                                      <strong>{Math.max(0, packQtyReceived - packQtySentToStore - packRejectionQty)} KG</strong>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActivePackingJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompletePacking(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Box completed cargos & Route
                                  </button>
                                </div>
                              </div>
                            )}

                            {activeDept === 'Store' && (
                              <div className="space-y-4">
                                {job.packingDetails && (
                                  <div className="bg-pink-50/20 dark:bg-pink-950/5 p-2.5 rounded border border-pink-100/50 grid grid-cols-3 gap-2 font-mono text-[10.5px]">
                                    <div><span className="text-pink-500 block text-[9px] uppercase">Boxes:</span> <strong>{job.packingDetails.boxCount || 0} boxes</strong></div>
                                    <div><span className="text-pink-500 block text-[9px] uppercase">Pcs per Box:</span> <strong>{job.packingDetails.pcsPerBagOrBox || 0} pcs</strong></div>
                                    <div><span className="text-pink-500 block text-[9px] uppercase">Total Pieces:</span> <strong>{(job.packingDetails.totalPcs || 0).toLocaleString()} pcs</strong></div>
                                  </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Warehouse Bin Coordinate</label>
                                    <input
                                      type="text"
                                      value={storeBinLoc}
                                      onChange={e => setStoreBinLoc(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-rose-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Store Rejection (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={storeRejectionQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const rej = Math.max(0, parseInt(clean, 10) || 0);
                                        if (rej > storeQtyReceived) {
                                          setStoreRejectionQty(storeQtyReceived);
                                          setStoreQtySentToDispatch(0);
                                          setStoreVerifiedQty(0);
                                        } else {
                                          setStoreRejectionQty(rej);
                                          const val = Math.max(0, storeQtyReceived - rej);
                                          setStoreQtySentToDispatch(val);
                                          setStoreVerifiedQty(val);
                                        }
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded p-1.5 font-mono font-bold text-rose-650 focus:outline-none"
                                    />
                                  </div>
                                </div>

                                {job.processType === 'Purchase' && (
                                  <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg space-y-2 border border-slate-200">
                                    <label className="block text-slate-500 font-extrabold uppercase text-[9px] tracking-wider">Routing Option (Next Destination)</label>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setStoreTargetDept('Packing')}
                                        className={`flex-1 py-1.5 rounded font-bold border transition text-xs cursor-pointer ${
                                          storeTargetDept === 'Packing' 
                                            ? 'bg-indigo-600 text-white border-indigo-700' 
                                            : 'bg-white hover:bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200'
                                        }`}
                                      >
                                        📦 Send to Packing Line
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setStoreTargetDept('Dispatch')}
                                        className={`flex-1 py-1.5 rounded font-bold border transition text-xs cursor-pointer ${
                                          storeTargetDept === 'Dispatch' 
                                            ? 'bg-indigo-600 text-white border-indigo-700' 
                                            : 'bg-white hover:bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200'
                                        }`}
                                      >
                                        🚚 Send to Direct Dispatch
                                      </button>
                                    </div>
                                  </div>
                                )}

                                <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg grid grid-cols-3 gap-3 text-[11px] font-mono border border-slate-200 dark:border-slate-800">
                                  <div>
                                    <span className="text-slate-455 block uppercase text-[8.5px]">Qty Received:</span>
                                    <strong className="text-blue-600">{storeQtyReceived} KG</strong>
                                  </div>
                                  <div>
                                    <span className="text-indigo-600 block uppercase text-[8.5px]">Route to {job.processType === 'Purchase' ? storeTargetDept : 'Dispatch'}:</span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={storeQtySentToDispatch}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const val = Math.max(0, parseInt(clean, 10) || 0);
                                        setStoreQtySentToDispatch(val > storeQtyReceived ? storeQtyReceived : val);
                                        setStoreVerifiedQty(val > storeQtyReceived ? storeQtyReceived : val);
                                      }}
                                      className="w-16 bg-white dark:bg-slate-950 border border-slate-300 rounded px-1 py-0.2 text-center text-[10.5px] font-bold text-indigo-700"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-amber-600 block uppercase text-[8.5px]">Remaining Balance:</span>
                                    <strong>{Math.max(0, storeQtyReceived - storeQtySentToDispatch - storeRejectionQty)} KG</strong>
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActiveStoreJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteStore(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Verify Stock & Send to {job.processType === 'Purchase' ? storeTargetDept : 'Dispatch'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {activeDept === 'Raw Material Store' && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <div>
                                    <label className="block text-slate-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Raw Material Bin Coordinate</label>
                                    <input
                                      type="text"
                                      value={storeBinLoc}
                                      onChange={e => setStoreBinLoc(e.target.value)}
                                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 rounded p-1.5 font-mono text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-rose-500 font-bold uppercase text-[9.5px] tracking-wider mb-1">Store Rejection (KG)</label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={storeRejectionQty || ''}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const rej = Math.max(0, parseInt(clean, 10) || 0);
                                        if (rej > storeQtyReceived) {
                                          setStoreRejectionQty(storeQtyReceived);
                                          setStoreQtySentToDispatch(0);
                                          setStoreVerifiedQty(0);
                                        } else {
                                          setStoreRejectionQty(rej);
                                          const val = Math.max(0, storeQtyReceived - rej);
                                          setStoreQtySentToDispatch(val);
                                          setStoreVerifiedQty(val);
                                        }
                                      }}
                                      className="w-full bg-white dark:bg-slate-900 border border-rose-200 rounded p-1.5 font-mono font-bold text-rose-650 focus:outline-none"
                                    />
                                  </div>
                                </div>

                                <div className="bg-slate-100 dark:bg-slate-900 p-3 rounded-lg grid grid-cols-3 gap-3 text-[11px] font-mono border border-slate-200 dark:border-slate-800">
                                  <div>
                                    <span className="text-slate-455 block uppercase text-[8.5px]">Qty Received:</span>
                                    <strong className="text-blue-600">{storeQtyReceived} KG</strong>
                                  </div>
                                  <div>
                                    <span className="text-indigo-600 block uppercase text-[8.5px]">Issue / Route to Production:</span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={storeQtySentToDispatch}
                                      onChange={e => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const val = Math.max(0, parseInt(clean, 10) || 0);
                                        setStoreQtySentToDispatch(val > storeQtyReceived ? storeQtyReceived : val);
                                        setStoreVerifiedQty(val > storeQtyReceived ? storeQtyReceived : val);
                                      }}
                                      className="w-16 bg-white dark:bg-slate-950 border border-slate-300 rounded px-1 py-0.2 text-center text-[10.5px] font-bold text-indigo-700"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-amber-600 block uppercase text-[8.5px]">Remaining Balance:</span>
                                    <strong>{Math.max(0, storeQtyReceived - storeQtySentToDispatch - storeRejectionQty)} KG</strong>
                                  </div>
                                </div>

                                <div className="flex gap-2 justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setActiveRawStoreJob(null)}
                                    className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-4 py-2 rounded text-xs font-bold cursor-pointer hover:bg-slate-300"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCompleteRawStore(job)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-4 rounded text-xs uppercase cursor-pointer"
                                  >
                                    Verify Stock & Issue to Production
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* C. OUTBOUND TRANSFERS LOGGED FOR ARCHIVING */}
          {activeSubView === 'completed' && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
              <h3 className="font-sans font-bold text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">
                📋 Completed Outbound Ledgers
              </h3>

              {completedDepartmentLogs.length === 0 ? (
                <div className="text-center py-10 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-2xl">⏳</span>
                  <p className="text-slate-400 text-xs font-mono font-medium">No archived outbound handoffs recorded in active session</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                        <th className="py-2.5 px-3">Job Card</th>
                        <th className="py-2.5 px-3">Dispatched to</th>
                        <th className="py-2.5 px-3">Handoff Weight</th>
                        <th className="py-2.5 px-3">Acceptance Status</th>
                        <th className="py-2.5 px-3">Recipient Signer</th>
                        <th className="py-2.5 px-3">Handoff Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedDepartmentLogs.map(m => (
                        <tr key={m.movementId} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/50">
                          <td className="py-3 px-3 font-mono font-bold text-indigo-500">{m.jobCardNo}</td>
                          <td className="py-3 px-3 font-semibold">{m.toDepartment}</td>
                          <td className="py-3 px-3 font-mono font-semibold">{m.quantity} KG</td>
                          <td className="py-3 px-3">
                            {m.accepted ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-105 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40">
                                Accepted
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-105 border border-purple-200 text-purple-850 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/40 animate-pulse">
                                Pending downstream
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-700 dark:text-slate-300">
                            {m.accepted ? (m.acceptedBy || 'System auto-close') : <span className="text-slate-400 italic font-normal text-[10px]">Awaiting Sign-off</span>}
                          </td>
                          <td className="py-3 px-3 text-slate-450 font-mono">
                            {new Date(m.acceptedDate || m.transferDate).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      <RawMaterialRequestModal
        isOpen={showRawMaterialRequestModal}
        onClose={() => {
          setShowRawMaterialRequestModal(false);
          setSelectedJobCardForRMRequest(null);
        }}
        jobCards={jobCards}
        currentUser={currentUser}
        onSubmit={handleRawMaterialModalSubmit}
        movements={movements}
        initialJobCardNo={selectedJobCardForRMRequest || undefined}
      />

    </div>
  );
}
