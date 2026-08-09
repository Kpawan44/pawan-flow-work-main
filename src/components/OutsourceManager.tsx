import React, { useState, useEffect } from 'react';
import { 
  OutsourceOrder, 
  OutsourceOrderItem,
  UserProfile, 
  JobCard,
  Department
} from '../types';
import { DBService } from '../lib/firebase';
import { 
  Truck, 
  PackageCheck, 
  ClipboardList, 
  UserCheck, 
  Building, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  Plus, 
  X, 
  Search, 
  AlertCircle, 
  AlertTriangle,
  ShoppingCart,
  CalendarClock,
  TrendingUp,
  Hourglass,
  CalendarDays,
  ShieldAlert,
  Edit3,
  ArrowUpRight,
  ListFilter,
  Check,
  Box,
  Trash2,
  Layers,
  User,
  Filter,
  Send,
  ArrowRight,
  Lock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff
} from 'lucide-react';

interface FormOrderItem {
  id: string;
  jobCardNo: string;
  itemName: string;
  itemCode: string;
  orderQty: number;
  unit: 'KGS' | 'PCS';
  processType: string;
  outsourceMaterialType: 'Semi Finished Goods' | 'Finished Goods';
}

interface OutsourceManagerProps {
  currentUser: UserProfile | null;
  users: UserProfile[];
  jobCards: JobCard[];
  onRefreshData?: () => void;
  showToast?: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const getOrderDeliveryStatus = (order: OutsourceOrder) => {
  const deliveryDateStr = order.estimatedDelivery || order.expectedDeliveryDate;
  
  if (order.status === 'Material Received' || order.status === 'Completed') {
    return {
      isDelayed: false,
      isToday: false,
      isUpcoming: false,
      isReceived: true,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50',
      text: order.receivedAt ? `Received ${new Date(order.receivedAt).toLocaleDateString()}` : 'Material Received',
      daysDiff: 0
    };
  }

  if (!deliveryDateStr) {
    return {
      isDelayed: false,
      isToday: false,
      isUpcoming: false,
      isReceived: false,
      badgeColor: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
      text: order.status === 'Assigned' ? 'Pending Supplier PO' : 'ETA Not Set',
      daysDiff: 0
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deliveryDate = new Date(deliveryDateStr);
  deliveryDate.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - deliveryDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    return {
      isDelayed: true,
      isToday: false,
      isUpcoming: false,
      isReceived: false,
      badgeColor: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900/50 animate-pulse',
      text: `Delayed by ${diffDays} day${diffDays > 1 ? 's' : ''}`,
      daysDiff: diffDays
    };
  } else if (diffDays === 0) {
    return {
      isDelayed: false,
      isToday: true,
      isUpcoming: false,
      isReceived: false,
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/50 font-bold',
      text: 'Arriving Today',
      daysDiff: 0
    };
  } else {
    const daysRemaining = Math.abs(diffDays);
    return {
      isDelayed: false,
      isToday: false,
      isUpcoming: true,
      isReceived: false,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/50',
      text: `Due in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}`,
      daysDiff: diffDays
    };
  }
};

export const OutsourceManager: React.FC<OutsourceManagerProps> = ({
  currentUser,
  users,
  jobCards,
  onRefreshData,
  showToast = (msg, type) => console.log(`[${type}] ${msg}`)
}) => {
  const [orders, setOrders] = useState<OutsourceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'my_assigned' | 'assigned' | 'po_placed' | 'delayed' | 'received' | 'completed'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all'); // 'all' | 'me' | specific userId
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal / Form States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [dispatchRemarks, setDispatchRemarks] = useState('');

  // Multi-Item Form Items State
  const [formItems, setFormItems] = useState<FormOrderItem[]>([
    {
      id: 'item-1',
      jobCardNo: '',
      itemName: '',
      itemCode: '',
      orderQty: 100,
      unit: 'KGS',
      processType: 'External Heat Treatment',
      outsourceMaterialType: 'Semi Finished Goods'
    }
  ]);

  // Supplier PO Modal State
  const [poModalOrder, setPoModalOrder] = useState<OutsourceOrder | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierPoNo, setSupplierPoNo] = useState('');
  const [supplierRate, setSupplierRate] = useState<number>(0);
  const [estimatedDelivery, setEstimatedDelivery] = useState('');
  const [poRemarks, setPoRemarks] = useState('');

  // Material Receipt Modal State
  const [receiptModalOrder, setReceiptModalOrder] = useState<OutsourceOrder | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [receivedChallanNo, setReceivedChallanNo] = useState('');
  const [receivedMaterialType, setReceivedMaterialType] = useState<'Semi Finished Goods' | 'Finished Goods'>('Semi Finished Goods');
  const [targetDepartmentAfterReceipt, setTargetDepartmentAfterReceipt] = useState<Department>('Store');
  const [receiptRemarks, setReceiptRemarks] = useState('');

  // Update Delivery Date Modal State
  const [editDeliveryOrder, setEditDeliveryOrder] = useState<OutsourceOrder | null>(null);
  const [newDeliveryDate, setNewDeliveryDate] = useState('');
  const [deliveryUpdateReason, setDeliveryUpdateReason] = useState('');

  // Expand / Collapse (Hide / Unhide) Order Details State
  const [collapsedOrderIds, setCollapsedOrderIds] = useState<Set<string>>(new Set());

  const toggleOrderCollapse = (orderId: string) => {
    setCollapsedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleCollapseAll = () => {
    if (collapsedOrderIds.size === filteredOrders.length && filteredOrders.length > 0) {
      setCollapsedOrderIds(new Set());
    } else {
      setCollapsedOrderIds(new Set(filteredOrders.map(o => o.orderId)));
    }
  };

  const isDispatchOrAdmin = true; // Any dispatch or authorized person can place an outsource order
  
  // Purchaser authorization check: only Purchaser department, super_admin/admin, assigned purchaser, or authorized outsourcer can modify / receive material
  const isPurchaserUser = (user: UserProfile | undefined, order?: OutsourceOrder) => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'admin') return true;
    if (user.department === 'Purchase') return true;
    if (user.canOutsource) return true;
    if (order && order.assignedToUserId === user.userId) return true;
    return false;
  };

  const isAssignee = users.some(u => u.userId === currentUser?.userId && u.canOutsource) || currentUser?.role === 'super_admin' || currentUser?.department === 'Purchase';

  // Available assignees: prioritize authorized outsourcing staff / Purchase / Super Admins, followed by all team members
  const availableAssignees = [...users].sort((a, b) => {
    const aAuth = a.canOutsource || a.role === 'super_admin' || a.department === 'Purchase';
    const bAuth = b.canOutsource || b.role === 'super_admin' || b.department === 'Purchase';
    if (aAuth && !bAuth) return -1;
    if (!aAuth && bAuth) return 1;
    return a.name.localeCompare(b.name);
  });

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await DBService.getOutsourceOrders();
      setOrders(data);
    } catch (err) {
      console.error('Failed to load outsource orders', err);
    } finally {
      setLoading(false);
    }
  };

  // Dynamic Item Row Handlers for Multi-Item Order
  const addItemRow = () => {
    setFormItems(prev => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        jobCardNo: '',
        itemName: '',
        itemCode: '',
        orderQty: 100,
        unit: 'KGS',
        processType: 'External Heat Treatment',
        outsourceMaterialType: 'Semi Finished Goods'
      }
    ]);
  };

  const removeItemRow = (index: number) => {
    if (formItems.length <= 1) return;
    setFormItems(prev => prev.filter((_, idx) => idx !== index));
  };

  const updateFormItem = (index: number, field: keyof FormOrderItem, value: any) => {
    setFormItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleSelectJobCardForItem = (index: number, jcNo: string) => {
    if (!jcNo) {
      updateFormItem(index, 'jobCardNo', '');
      return;
    }
    const card = jobCards.find(j => j.jobCardNo === jcNo);
    if (card) {
      setFormItems(prev => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          jobCardNo: jcNo,
          itemName: card.itemName || copy[index].itemName,
          itemCode: card.itemCode || copy[index].itemCode,
          orderQty: card.currentQty || card.orderQty || copy[index].orderQty,
          unit: (card.unit as any) || copy[index].unit
        };

        if (!partyName && card.partyName) {
          setPartyName(card.partyName);
        }
        return copy;
      });
    }
  };

  // Create Outsource Order from Dispatch
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyName.trim() || !assignedToUserId) {
      showToast('Please fill in Party Name and Assignee', 'error');
      return;
    }

    // Validate form items
    for (let i = 0; i < formItems.length; i++) {
      const it = formItems[i];
      if (!it.itemName.trim()) {
        showToast(`Item #${i + 1} is missing an Item Name`, 'error');
        return;
      }
      if (!it.orderQty || it.orderQty <= 0) {
        showToast(`Item #${i + 1} must have a valid quantity (> 0)`, 'error');
        return;
      }
    }

    const assignee = users.find(u => u.userId === assignedToUserId);
    if (!assignee) return;

    try {
      const itemsList: OutsourceOrderItem[] = formItems.map((it, idx) => {
        const itemObj: OutsourceOrderItem = {
          itemId: it.id || `item-${idx + 1}`,
          itemName: it.itemName.trim(),
          orderQty: Number(it.orderQty),
          unit: it.unit,
          processType: it.processType,
          outsourceMaterialType: it.outsourceMaterialType,
        };
        if (it.itemCode && it.itemCode.trim()) {
          itemObj.itemCode = it.itemCode.trim();
        }
        if (it.jobCardNo && it.jobCardNo.trim()) {
          itemObj.jobCardNo = it.jobCardNo.trim();
        }
        return itemObj;
      });

      const mainItem = itemsList[0];
      const totalQty = itemsList.reduce((sum, item) => sum + item.orderQty, 0);
      const summaryItemName = itemsList.length > 1
        ? `${itemsList.length} Items: ${itemsList.map(i => i.itemName).join(', ')}`
        : mainItem.itemName;

      const orderPayload: any = {
        partyName: partyName.trim(),
        itemName: summaryItemName,
        orderQty: totalQty,
        unit: mainItem.unit,
        processType: itemsList.length === 1 ? mainItem.processType : 'Multiple Processes',
        outsourceMaterialType: mainItem.outsourceMaterialType,
        items: itemsList,
        assignedToUserId,
        assignedToUserName: assignee.name,
      };

      if (mainItem.itemCode) orderPayload.itemCode = mainItem.itemCode;
      if (mainItem.jobCardNo) orderPayload.jobCardNo = mainItem.jobCardNo;
      if (dispatchRemarks && dispatchRemarks.trim()) orderPayload.dispatchRemarks = dispatchRemarks.trim();

      await DBService.createOutsourceOrder(
        orderPayload,
        currentUser?.userId || 'u-dispatch',
        currentUser?.name || 'Dispatch Person'
      );

      showToast(`Outsource order placed with ${itemsList.length} item(s) & assigned to ${assignee.name}`, 'success');
      setShowCreateModal(false);
      resetCreateForm();
      loadOrders();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      showToast(`Failed to create outsource order: ${err.message || err}`, 'error');
    }
  };

  const resetCreateForm = () => {
    setPartyName('');
    setAssignedToUserId('');
    setDispatchRemarks('');
    setFormItems([
      {
        id: `item-${Date.now()}`,
        jobCardNo: '',
        itemName: '',
        itemCode: '',
        orderQty: 100,
        unit: 'KGS',
        processType: 'External Heat Treatment',
        outsourceMaterialType: 'Semi Finished Goods'
      }
    ]);
  };

  // Open Supplier PO Modal
  const openPoModal = (order: OutsourceOrder) => {
    if (!isPurchaserUser(currentUser, order)) {
      showToast(`Access Denied: Only Purchase department or assigned purchaser (${order.assignedToUserName}) is authorized to enter supplier details and accept this order.`, 'error');
      return;
    }
    setPoModalOrder(order);
    setSupplierName(order.supplierName || '');
    setSupplierPoNo(order.supplierPoNo || `PO-OUT-${Date.now().toString().slice(-4)}`);
    setSupplierRate(order.supplierRate || 0);
    setEstimatedDelivery(order.estimatedDelivery ? order.estimatedDelivery.slice(0, 10) : new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10));
    setPoRemarks(order.poRemarks || '');
  };

  // Submit Supplier PO
  const handleSubmitPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poModalOrder) return;

    // Security & Role check: Only assigned purchaser or Purchase department / Admin can submit PO
    if (!isPurchaserUser(currentUser, poModalOrder)) {
      showToast(`Only Purchase department or assigned purchaser (${poModalOrder.assignedToUserName}) is authorized to enter supplier details and accept this order.`, 'error');
      return;
    }

    if (!supplierName.trim() || !supplierPoNo.trim()) {
      showToast('Supplier Name and PO Number are required', 'error');
      return;
    }

    try {
      await DBService.updateOutsourceOrder(
        poModalOrder.orderId,
        {
          supplierName,
          supplierPoNo,
          supplierRate,
          poDate: new Date().toISOString(),
          estimatedDelivery,
          poRemarks,
          status: 'Supplier PO Placed'
        },
        currentUser?.userId || 'u-assignee',
        currentUser?.name || 'Assignee'
      );

      // Notification to Dispatch
      await DBService.createNotification({
        userId: 'all_dispatch',
        department: 'Dispatch',
        title: '🚚 Supplier PO Placed & Vendor Assigned',
        message: `Supplier PO ${supplierPoNo} placed to '${supplierName}' for outsource order ${poModalOrder.orderId} (${poModalOrder.itemName}). Expected arrival: ${estimatedDelivery}.`
      });

      // Notification to Purchase (Next Process: Expect & Accept Material from Vendor)
      await DBService.createNotification({
        userId: 'all_purchase',
        department: 'Purchase',
        title: '📦 Vendor Assigned - Prepare for Material Receipt',
        message: `Vendor '${supplierName}' (PO ${supplierPoNo}) assigned for outsource order ${poModalOrder.orderId} (${poModalOrder.itemName}). Expected delivery: ${estimatedDelivery}. Purchase team will accept material upon arrival.`
      });

      // Notification to Target Department (Store, Heat Treatment, Plating)
      const targetDept: Department = poModalOrder.outsourceMaterialType === 'Finished Goods'
        ? 'Store'
        : (poModalOrder.processType.toLowerCase().includes('plat') ? 'Plating' : 'Heat Treatment');

      await DBService.createNotification({
        userId: `all_${targetDept.toLowerCase().replace(/\s+/g, '_')}`,
        department: targetDept,
        title: `📢 Outsource Vendor Assigned (${poModalOrder.processType})`,
        message: `Vendor '${supplierName}' assigned for ${poModalOrder.itemName}. Expected arrival on ${estimatedDelivery} for transfer to ${targetDept}.`
      });

      showToast(`Supplier PO ${supplierPoNo} placed to ${supplierName}. Purchase & next process notified!`, 'success');
      setPoModalOrder(null);
      loadOrders();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      showToast(`Failed to place Supplier PO: ${err.message || err}`, 'error');
    }
  };

  // Open Receipt Modal
  const openReceiptModal = (order: OutsourceOrder) => {
    if (!isPurchaserUser(currentUser, order)) {
      showToast('Access Denied: Only Purchase department or authorized purchaser can receive and accept outsource material.', 'error');
      return;
    }
    setReceiptModalOrder(order);
    setReceivedQty(order.orderQty);
    setReceivedChallanNo(`CH-${Date.now().toString().slice(-5)}`);
    setReceivedMaterialType(order.outsourceMaterialType);
    setReceiptRemarks('');

    // Default destination department based on material type and process
    if (order.outsourceMaterialType === 'Finished Goods') {
      setTargetDepartmentAfterReceipt('Store');
    } else {
      const proc = (order.processType || '').toLowerCase();
      if (proc.includes('plat')) {
        setTargetDepartmentAfterReceipt('Plating');
      } else if (proc.includes('heat') || proc.includes('treat')) {
        setTargetDepartmentAfterReceipt('Heat Treatment');
      } else {
        setTargetDepartmentAfterReceipt('Production');
      }
    }
  };

  const handleReceiptMaterialTypeChange = (type: 'Semi Finished Goods' | 'Finished Goods') => {
    setReceivedMaterialType(type);
    if (type === 'Finished Goods') {
      setTargetDepartmentAfterReceipt('Store');
    } else {
      const proc = (receiptModalOrder?.processType || '').toLowerCase();
      if (proc.includes('plat')) {
        setTargetDepartmentAfterReceipt('Plating');
      } else {
        setTargetDepartmentAfterReceipt('Heat Treatment');
      }
    }
  };

  // Submit Material Receipt
  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptModalOrder) return;

    if (!isPurchaserUser(currentUser, receiptModalOrder)) {
      showToast('Access Denied: Only Purchase department or authorized purchaser can record material receipt.', 'error');
      return;
    }

    if (receivedQty <= 0) {
      showToast('Received quantity must be greater than zero', 'error');
      return;
    }

    try {
      await DBService.updateOutsourceOrder(
        receiptModalOrder.orderId,
        {
          receivedQty,
          receivedAt: new Date().toISOString(),
          receivedChallanNo,
          receivedMaterialType,
          targetDepartmentAfterReceipt,
          receiptRemarks,
          receivedByUserId: currentUser?.userId,
          receivedByUserName: currentUser?.name,
          status: 'Completed'
        },
        currentUser?.userId || 'u-purchase',
        currentUser?.name || 'Purchase Received'
      );

      // Create material movement / log transfer from Purchase to target department
      await DBService.createMovement(
        {
          jobCardNo: receiptModalOrder.jobCardNo || receiptModalOrder.orderId,
          fromDepartment: 'Purchase',
          toDepartment: targetDepartmentAfterReceipt,
          quantity: receivedQty,
          transferBy: currentUser?.name || 'Purchase Staff',
          remarks: `Outsource Material Received from ${receiptModalOrder.supplierName || 'Vendor'} (${receivedMaterialType}). Sent to ${targetDepartmentAfterReceipt}. Challan: ${receivedChallanNo}`
        },
        currentUser?.userId || 'u-purchase',
        currentUser?.name || 'Purchase Received'
      );

      // Notify Dispatch
      await DBService.createNotification({
        userId: 'all_dispatch',
        department: 'Dispatch',
        title: '📦 Outsource Goods Accepted at Purchase',
        message: `Order ${receiptModalOrder.orderId} material (${receivedQty} ${receiptModalOrder.unit} as ${receivedMaterialType}) accepted from vendor '${receiptModalOrder.supplierName || 'Vendor'}' & sent to ${targetDepartmentAfterReceipt}.`
      });

      // Notify Destination Department (Store, Heat Treatment, Plating, etc.)
      const deptTitle = targetDepartmentAfterReceipt === 'Store'
        ? '🏬 Outsource Finished Goods Transferred to Store'
        : targetDepartmentAfterReceipt === 'Heat Treatment'
        ? '🔥 Outsource Semi-Finished Goods Sent to Heat Treatment'
        : targetDepartmentAfterReceipt === 'Plating'
        ? '⚡ Outsource Semi-Finished Goods Sent to Plating'
        : `📦 Outsource Goods Routed to ${targetDepartmentAfterReceipt}`;

      await DBService.createNotification({
        userId: `all_${targetDepartmentAfterReceipt.toLowerCase().replace(/\s+/g, '_')}`,
        department: targetDepartmentAfterReceipt,
        title: deptTitle,
        message: `Purchase accepted ${receivedQty} ${receiptModalOrder.unit} (${receiptModalOrder.itemName}) from vendor '${receiptModalOrder.supplierName || 'Vendor'}'. Material routed to ${targetDepartmentAfterReceipt}.`
      });

      showToast(`Material receipt recorded & routed to ${targetDepartmentAfterReceipt} successfully!`, 'success');
      setReceiptModalOrder(null);
      loadOrders();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      showToast(`Failed to record material receipt: ${err.message || err}`, 'error');
    }
  };

  // Handle Delivery Date Update
  const openEditDeliveryModal = (order: OutsourceOrder) => {
    if (!isPurchaserUser(currentUser, order)) {
      showToast('Access Denied: Only Purchase department or assigned purchaser can update delivery dates.', 'error');
      return;
    }
    setEditDeliveryOrder(order);
    setNewDeliveryDate(order.estimatedDelivery ? order.estimatedDelivery.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setDeliveryUpdateReason('');
  };

  const handleUpdateDeliveryDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDeliveryOrder || !newDeliveryDate) return;

    if (!isPurchaserUser(currentUser, editDeliveryOrder)) {
      showToast('Access Denied: Only Purchase department or assigned purchaser can update delivery dates.', 'error');
      return;
    }

    try {
      await DBService.updateOutsourceOrder(
        editDeliveryOrder.orderId,
        {
          estimatedDelivery: newDeliveryDate,
          poRemarks: deliveryUpdateReason ? `${editDeliveryOrder.poRemarks || ''}\n[ETA Updated to ${newDeliveryDate}]: ${deliveryUpdateReason}` : editDeliveryOrder.poRemarks
        },
        currentUser?.userId || 'u-user',
        currentUser?.name || 'User'
      );

      showToast(`Updated estimated delivery date for ${editDeliveryOrder.orderId} to ${newDeliveryDate}`, 'success');
      setEditDeliveryOrder(null);
      setNewDeliveryDate('');
      setDeliveryUpdateReason('');
      loadOrders();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      showToast(`Failed to update delivery date: ${err.message || err}`, 'error');
    }
  };

  // Mark Order as Completed
  const handleCompleteOrder = async (order: OutsourceOrder) => {
    if (!isPurchaserUser(currentUser, order)) {
      showToast('Access Denied: Only Purchase department or authorized purchaser can mark outsource order completed.', 'error');
      return;
    }
    try {
      await DBService.updateOutsourceOrder(
        order.orderId,
        { status: 'Completed' },
        currentUser?.userId || 'u-admin',
        currentUser?.name || 'Admin'
      );
      showToast(`Outsource order ${order.orderId} marked as Completed!`, 'success');
      loadOrders();
      if (onRefreshData) onRefreshData();
    } catch (err: any) {
      showToast(`Failed to mark order completed: ${err.message || err}`, 'error');
    }
  };

  // Dashboard Metrics & Delay Calculations
  const myAssignedOrders = orders.filter(
    o => o.assignedToUserId === currentUser?.userId ||
         (currentUser?.name && o.assignedToUserName?.toLowerCase() === currentUser?.name?.toLowerCase())
  );
  const delayedOrders = orders.filter(o => getOrderDeliveryStatus(o).isDelayed);
  const todayArrivals = orders.filter(o => getOrderDeliveryStatus(o).isToday);
  const upcomingDeliveries = orders.filter(o => getOrderDeliveryStatus(o).isUpcoming);
  const poPlacedOrders = orders.filter(o => o.status === 'Supplier PO Placed' || o.status === 'In Transit');
  const receivedOrders = orders.filter(o => o.status === 'Material Received' || o.status === 'Completed');

  // Filtering
  const filteredOrders = orders.filter(o => {
    const deliveryStatus = getOrderDeliveryStatus(o);

    // Filter by Assignee
    let matchesAssignee = true;
    if (assigneeFilter === 'me') {
      matchesAssignee = o.assignedToUserId === currentUser?.userId ||
                        (currentUser?.name && o.assignedToUserName?.toLowerCase() === currentUser?.name?.toLowerCase());
    } else if (assigneeFilter !== 'all') {
      matchesAssignee = o.assignedToUserId === assigneeFilter;
    }

    const matchesTab = 
      activeTab === 'all' ? true :
      activeTab === 'my_assigned' ? (o.assignedToUserId === currentUser?.userId || (currentUser?.name && o.assignedToUserName?.toLowerCase() === currentUser?.name?.toLowerCase())) :
      activeTab === 'assigned' ? o.status === 'Assigned' :
      activeTab === 'po_placed' ? o.status === 'Supplier PO Placed' || o.status === 'In Transit' :
      activeTab === 'delayed' ? deliveryStatus.isDelayed :
      activeTab === 'received' ? o.status === 'Material Received' :
      activeTab === 'completed' ? o.status === 'Completed' : true;

    const query = searchTerm.toLowerCase();
    const matchesSearch = 
      o.orderId.toLowerCase().includes(query) ||
      o.partyName.toLowerCase().includes(query) ||
      o.itemName.toLowerCase().includes(query) ||
      (o.itemCode && o.itemCode.toLowerCase().includes(query)) ||
      o.assignedToUserName.toLowerCase().includes(query) ||
      (o.supplierName && o.supplierName.toLowerCase().includes(query)) ||
      (o.supplierPoNo && o.supplierPoNo.toLowerCase().includes(query));

    return matchesAssignee && matchesTab && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white font-sans">
                Process Outsourcing &amp; Supplier Portal
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                Real-time supplier order tracking, shipment delay alerts, and material arrival schedule
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          {/* View Mode Switcher */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold w-full sm:w-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex-1 sm:flex-initial justify-center px-3 py-2 sm:py-1.5 rounded-lg flex items-center gap-1 transition min-h-[38px] sm:min-h-0 ${viewMode === 'grid' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400'}`}
            >
              <Box className="h-3.5 w-3.5" />
              Grid
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`flex-1 sm:flex-initial justify-center px-3 py-2 sm:py-1.5 rounded-lg flex items-center gap-1 transition min-h-[38px] sm:min-h-0 ${viewMode === 'timeline' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400'}`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule
            </button>
          </div>

          {/* Toggle Expand / Collapse All Details Button */}
          <button
            onClick={toggleCollapseAll}
            className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition border border-slate-200 dark:border-slate-700 cursor-pointer min-h-[38px] sm:min-h-0 shrink-0"
            title={collapsedOrderIds.size > 0 ? "Unhide details for all outsource orders" : "Hide details for all outsource orders"}
          >
            {collapsedOrderIds.size > 0 ? (
              <>
                <Eye className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Unhide All ({collapsedOrderIds.size})</span>
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                <span>Hide All Details</span>
              </>
            )}
          </button>

          {isDispatchOrAdmin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="w-full sm:w-auto px-4 py-2.5 sm:py-2 bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-sm cursor-pointer shrink-0 min-h-[40px]"
            >
              <Plus className="h-4 w-4" />
              Place Outsource Order
            </button>
          )}
        </div>
      </div>

      {/* VISUAL SUPPLIER & DELAYS DASHBOARD */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Orders Metric */}
        <div 
          onClick={() => setActiveTab('all')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2 shadow-xs hover:border-blue-300 dark:hover:border-blue-800 transition cursor-pointer"
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Outsource Orders</span>
            <div className="p-2 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
              <ClipboardList className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {orders.length}
            </span>
            <span className="text-[11px] font-bold text-slate-500">
              {orders.reduce((acc, o) => acc + (o.orderQty || 0), 0).toLocaleString()} Total Units
            </span>
          </div>
        </div>

        {/* PO Placed / In Transit */}
        <div 
          onClick={() => setActiveTab('po_placed')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2 shadow-xs hover:border-purple-300 dark:hover:border-purple-800 transition cursor-pointer"
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">POs Placed (In Transit)</span>
            <div className="p-2 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-xl">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-purple-600 dark:text-purple-400 font-mono">
              {poPlacedOrders.length}
            </span>
            <span className="text-[11px] text-purple-600 font-semibold">
              Active with Suppliers
            </span>
          </div>
        </div>

        {/* Delayed Shipments Alert Card */}
        <div 
          onClick={() => setActiveTab('delayed')}
          className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 space-y-2 shadow-xs transition cursor-pointer ${
            delayedOrders.length > 0
              ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50/20 dark:bg-rose-950/10 hover:border-rose-400'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className={`h-4 w-4 ${delayedOrders.length > 0 ? 'animate-bounce' : ''}`} />
              Delayed Shipments
            </span>
            <div className={`p-2 rounded-xl ${delayedOrders.length > 0 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-slate-100 text-slate-500'}`}>
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className={`text-2xl font-black font-mono ${delayedOrders.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
              {delayedOrders.length}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${delayedOrders.length > 0 ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' : 'bg-slate-100 text-slate-500'}`}>
              {delayedOrders.length > 0 ? 'Requires Follow-up' : 'All On-Time'}
            </span>
          </div>
        </div>

        {/* Material Arrivals Today / Soon */}
        <div 
          onClick={() => setActiveTab('all')}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2 shadow-xs hover:border-amber-300 dark:hover:border-amber-800 transition cursor-pointer"
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Arrivals Today / Upcoming</span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-xl">
              <CalendarDays className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
              {todayArrivals.length + upcomingDeliveries.length}
            </span>
            <span className="text-[11px] font-bold text-amber-600">
              {todayArrivals.length} Due Today
            </span>
          </div>
        </div>
      </div>

      {/* DELAYED SHIPMENTS HIGH-PRIORITY ALERT BANNER */}
      {delayedOrders.length > 0 && (
        <div className="bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-rose-500/5 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-rose-500 text-white rounded-xl shadow-xs">
                <AlertTriangle className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-rose-900 dark:text-rose-200 font-sans flex items-center gap-2">
                  Critical Shipment Delay Alerts ({delayedOrders.length} Order{delayedOrders.length > 1 ? 's' : ''})
                </h3>
                <p className="text-xs text-rose-700/80 dark:text-rose-300/80">
                  Supplier deliveries past their committed arrival dates. Immediate follow-up required.
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('delayed')}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-xs transition cursor-pointer"
            >
              Filter Delayed ({delayedOrders.length})
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {delayedOrders.map(order => {
              const delayInfo = getOrderDeliveryStatus(order);
              return (
                <div 
                  key={order.orderId}
                  className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/80 rounded-xl p-3.5 space-y-2.5 shadow-xs"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400">
                        {order.orderId}
                      </span>
                      <h4 className="font-bold text-xs text-slate-900 dark:text-white leading-tight">
                        {order.supplierName || 'Unassigned Supplier'}
                      </h4>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                      Overdue {delayInfo.daysDiff} day{delayInfo.daysDiff > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      Item: <span className="text-blue-600 dark:text-blue-400">{order.itemName}</span> ({order.orderQty} {order.unit})
                    </p>
                    <p className="text-[10px] text-slate-500">
                      PO No: <span className="font-mono font-bold">{order.supplierPoNo || 'N/A'}</span> | Process: {order.processType}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Committed Date: <span className="font-bold text-rose-600 dark:text-rose-400">{order.estimatedDelivery}</span>
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Assignee: <span className="font-medium text-slate-700 dark:text-slate-300">{order.assignedToUserName}</span>
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      onClick={() => openEditDeliveryModal(order)}
                      className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 text-[10px] font-bold rounded-lg border border-amber-200 dark:border-amber-900/50 flex items-center gap-1 transition cursor-pointer"
                    >
                      <Edit3 className="h-3 w-3" />
                      Revise ETA
                    </button>

                    <button
                      onClick={() => openReceiptModal(order)}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition cursor-pointer"
                    >
                      <PackageCheck className="h-3 w-3" />
                      Receive
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-1.5 sm:gap-1 bg-slate-100 dark:bg-slate-850 p-1.5 sm:p-1 rounded-xl text-xs font-semibold w-full md:w-auto">
          <button
            onClick={() => { setActiveTab('all'); setAssigneeFilter('all'); }}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition text-center min-h-[38px] sm:min-h-0 flex items-center justify-center ${activeTab === 'all' && assigneeFilter === 'all' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
          >
            All Orders ({orders.length})
          </button>

          <button
            onClick={() => { setActiveTab('my_assigned'); setAssigneeFilter('me'); }}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 ${
              activeTab === 'my_assigned' || assigneeFilter === 'me'
                ? 'bg-purple-600 text-white font-bold shadow-xs' 
                : 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30 font-semibold'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5 shrink-0" />
            <span>Assigned to Me ({myAssignedOrders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('delayed')}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition flex items-center justify-center gap-1 min-h-[38px] sm:min-h-0 ${activeTab === 'delayed' ? 'bg-rose-500 text-white font-bold shadow-xs' : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30'}`}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Delayed ({delayedOrders.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('assigned')}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition text-center min-h-[38px] sm:min-h-0 flex items-center justify-center ${activeTab === 'assigned' ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
          >
            Pending Assignee ({orders.filter(o => o.status === 'Assigned').length})
          </button>

          <button
            onClick={() => setActiveTab('po_placed')}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition text-center min-h-[38px] sm:min-h-0 flex items-center justify-center ${activeTab === 'po_placed' ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
          >
            Supplier PO Placed ({poPlacedOrders.length})
          </button>

          <button
            onClick={() => setActiveTab('received')}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition text-center min-h-[38px] sm:min-h-0 flex items-center justify-center ${activeTab === 'received' ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
          >
            Material Received ({orders.filter(o => o.status === 'Material Received').length})
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg transition text-center min-h-[38px] sm:min-h-0 flex items-center justify-center ${activeTab === 'completed' ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
          >
            Completed ({orders.filter(o => o.status === 'Completed').length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Assignee Filter Dropdown */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-xs shadow-2xs">
            <Filter className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
            <span className="font-semibold text-slate-500 shrink-0">Filter:</span>
            <select
              value={assigneeFilter}
              onChange={e => {
                const val = e.target.value;
                setAssigneeFilter(val);
                if (val === 'me') setActiveTab('my_assigned');
                else if (activeTab === 'my_assigned') setActiveTab('all');
              }}
              className="bg-transparent font-bold text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer text-xs"
            >
              <option value="all">All Assignees</option>
              <option value="me">Assigned to Me ({currentUser?.name || 'Me'}) ({myAssignedOrders.length})</option>
              {users.filter(u => orders.some(o => o.assignedToUserId === u.userId)).map(u => (
                <option key={u.userId} value={u.userId}>
                  {u.name} ({orders.filter(o => o.assignedToUserId === u.userId).length})
                </option>
              ))}
            </select>
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search Party, Item, PO, Supplier..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-800 dark:text-slate-200"
            />
          </div>
        </div>
      </div>

      {/* VIEW CONTENT: GRID OR TIMELINE SCHEDULE */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs font-mono">
          Loading process outsource orders &amp; schedule...
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-400">
            <ClipboardList className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300 font-sans">
            No Outsource Orders Found
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {activeTab === 'my_assigned' || assigneeFilter === 'me'
              ? `No process outsource items currently assigned to ${currentUser?.name || 'you'}.`
              : activeTab === 'delayed'
              ? "Great news! There are currently no delayed supplier shipments."
              : `No orders matching active filters.`}
          </p>
        </div>
      ) : viewMode === 'timeline' ? (
        /* MATERIAL ARRIVAL SCHEDULE TIMELINE VIEW */
        <div className="space-y-6">
          {/* Timeline Schedule Sections */}
          {[
            {
              title: '🚨 Delayed / Overdue Shipments',
              accent: 'border-rose-500 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30',
              list: filteredOrders.filter(o => getOrderDeliveryStatus(o).isDelayed)
            },
            {
              title: '🚚 Arriving Today',
              accent: 'border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
              list: filteredOrders.filter(o => getOrderDeliveryStatus(o).isToday)
            },
            {
              title: '🗓️ Upcoming Supplier Deliveries',
              accent: 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30',
              list: filteredOrders.filter(o => getOrderDeliveryStatus(o).isUpcoming || (o.status === 'Supplier PO Placed' && !o.estimatedDelivery))
            },
            {
              title: '✅ Recently Received Goods',
              accent: 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
              list: filteredOrders.filter(o => getOrderDeliveryStatus(o).isReceived)
            }
          ].map((group, gIdx) => {
            if (group.list.length === 0) return null;

            return (
              <div key={gIdx} className="space-y-3">
                <div className={`px-4 py-2 rounded-xl border-l-4 font-bold text-xs flex justify-between items-center ${group.accent}`}>
                  <span>{group.title}</span>
                  <span className="text-[10px] bg-white/80 dark:bg-slate-900/80 px-2 py-0.5 rounded-full font-mono">
                    {group.list.length} Order{group.list.length > 1 ? 's' : ''}
                  </span>
                </div>

                <div className="space-y-3 pl-2">
                  {group.list.map(order => {
                    const deliveryStatus = getOrderDeliveryStatus(order);
                    const isMyAssigned = order.assignedToUserId === currentUser?.userId;
                    const isCollapsed = collapsedOrderIds.has(order.orderId);

                    return (
                      <div 
                        key={order.orderId}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs flex flex-col justify-between items-stretch gap-3 hover:border-blue-300 transition"
                      >
                        <div 
                          onClick={() => toggleOrderCollapse(order.orderId)}
                          className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer select-none group"
                        >
                          <div className="space-y-1 max-w-lg">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-extrabold text-blue-600 dark:text-blue-400">
                                {order.orderId}
                              </span>
                              <span className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {order.partyName}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${deliveryStatus.badgeColor}`}>
                                {deliveryStatus.text}
                              </span>
                            </div>

                            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                              <p>
                                <strong className="text-slate-800 dark:text-slate-200">{order.itemName}</strong> ({order.orderQty} {order.unit}) &bull; <span className="text-slate-500">{order.processType}</span>
                              </p>
                              {!isCollapsed && (
                                <p className="text-[11px] text-slate-500">
                                  Supplier: <strong className="text-purple-600 dark:text-purple-400">{order.supplierName || 'Not Assigned Yet'}</strong> {order.supplierPoNo && `(PO: ${order.supplierPoNo})`}
                                  {order.estimatedDelivery && ` | Target ETA: ${order.estimatedDelivery}`}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOrderCollapse(order.orderId);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold flex items-center gap-1 transition"
                            >
                              {isCollapsed ? (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                  <span>Unhide Details</span>
                                </>
                              ) : (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                  <span>Hide Details</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            {/* Visual Progress Bar */}
                            <div className="w-full md:w-64 space-y-1">
                              <div className="flex justify-between text-[10px] font-semibold text-slate-400">
                                <span>Dispatch</span>
                                <span>PO Placed</span>
                                <span>Received</span>
                              </div>
                              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden flex">
                                <div className="bg-blue-500 h-full w-1/3" />
                                <div className={`h-full w-1/3 ${order.status === 'Supplier PO Placed' || order.status === 'In Transit' || order.status === 'Material Received' || order.status === 'Completed' ? 'bg-purple-500' : 'bg-transparent'}`} />
                                <div className={`h-full w-1/3 ${order.status === 'Material Received' || order.status === 'Completed' ? 'bg-emerald-500' : 'bg-transparent'}`} />
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
                          {order.estimatedDelivery && (order.status === 'Supplier PO Placed' || order.status === 'In Transit') && isPurchaserUser(currentUser, order) && (
                            <button
                              onClick={() => openEditDeliveryModal(order)}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl flex items-center gap-1 transition cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Update ETA
                            </button>
                          )}

                          {order.status === 'Assigned' && (
                            isPurchaserUser(currentUser, order) ? (
                              <button
                                onClick={() => openPoModal(order)}
                                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition cursor-pointer shadow-xs"
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Accept &amp; Enter Supplier
                              </button>
                            ) : (
                              <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[11px] font-semibold rounded-lg flex items-center gap-1">
                                <UserCheck className="h-3.5 w-3.5 text-amber-600" />
                                Assigned to: {order.assignedToUserName}
                              </span>
                            )
                          )}

                          {(order.status === 'Supplier PO Placed' || order.status === 'In Transit') && (
                            isPurchaserUser(currentUser, order) ? (
                              <button
                                onClick={() => openReceiptModal(order)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 transition cursor-pointer"
                              >
                                <PackageCheck className="h-3.5 w-3.5" />
                                Receive Goods
                              </button>
                            ) : (
                              <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 text-[11px] font-semibold rounded-lg flex items-center gap-1 border border-slate-200 dark:border-slate-700" title="Only Purchase team or assigned purchaser can receive goods">
                                <Lock className="h-3.5 w-3.5 text-slate-400" />
                                Purchase Only
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* GRID CARDS VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map(order => {
            const isMyAssigned = order.assignedToUserId === currentUser?.userId;
            const deliveryStatus = getOrderDeliveryStatus(order);
            const isCollapsed = collapsedOrderIds.has(order.orderId);

            return (
              <div
                key={order.orderId}
                className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-xs transition ${
                  isCollapsed ? 'space-y-3' : 'space-y-4'
                } ${
                  deliveryStatus.isDelayed 
                    ? 'border-rose-300 dark:border-rose-900/80 bg-rose-50/10 dark:bg-rose-950/10' 
                    : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800'
                }`}
              >
                {/* Top status bar - Clickable to toggle hide/unhide */}
                <div 
                  onClick={() => toggleOrderCollapse(order.orderId)}
                  className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 cursor-pointer select-none group"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-extrabold text-blue-600 dark:text-blue-400">
                        {order.orderId}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOrderCollapse(order.orderId);
                        }}
                        className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold flex items-center gap-1 transition"
                      >
                        {isCollapsed ? (
                          <>
                            <ChevronDown className="h-3 w-3 text-blue-500 shrink-0" />
                            <span>Unhide Details</span>
                          </>
                        ) : (
                          <>
                            <ChevronUp className="h-3 w-3 text-slate-400 shrink-0" />
                            <span>Hide Details</span>
                          </>
                        )}
                      </button>
                    </div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {order.partyName}
                    </h3>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 shrink-0 ${
                        order.status === 'Assigned'
                          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400'
                          : order.status === 'Supplier PO Placed'
                          ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400'
                          : order.status === 'Material Received'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : order.status === 'Completed'
                          ? 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      {order.status}
                    </span>

                    {/* Delivery Status Badge */}
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${deliveryStatus.badgeColor}`}>
                      {deliveryStatus.text}
                    </span>
                  </div>
                </div>

                {/* Collapsed vs Unhidden Body */}
                {isCollapsed ? (
                  <div 
                    onClick={() => toggleOrderCollapse(order.orderId)}
                    className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs flex items-center justify-between cursor-pointer hover:bg-blue-50/50 dark:hover:bg-slate-850 transition"
                  >
                    <div className="space-y-0.5 pr-2">
                      <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px] truncate max-w-[200px]">
                        {order.items && order.items.length > 1 ? `Multi-Item Sourcing (${order.items.length} items)` : order.itemName}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {order.orderQty} {order.unit} &bull; {order.processType} {order.supplierName ? `&bull; ${order.supplierName}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOrderCollapse(order.orderId);
                      }}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 px-2 py-1 rounded-lg border border-blue-200 dark:border-blue-800 shrink-0 flex items-center gap-1 hover:bg-blue-50 dark:hover:bg-slate-800 transition"
                    >
                      <span>Show Details</span>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Details */}
                    <div className="space-y-2 text-xs">
                      {order.items && order.items.length > 1 ? (
                        <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                          <div className="flex justify-between items-center text-xs font-bold text-blue-600 dark:text-blue-400">
                            <span className="flex items-center gap-1.5">
                              <Layers className="h-3.5 w-3.5 text-blue-500" />
                              Multi-Item Sourcing ({order.items.length} Items)
                            </span>
                            <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">Total: {order.orderQty} {order.unit}</span>
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                            {order.items.map((it, idx) => (
                              <div key={it.itemId || idx} className="bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] space-y-1">
                                <div className="flex justify-between items-start font-bold">
                                  <span className="text-slate-900 dark:text-white leading-tight">{it.itemName}</span>
                                  <span className="text-blue-600 dark:text-blue-400 font-mono text-xs shrink-0 ml-2">{it.orderQty} {it.unit}</span>
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500">
                                  <span>{it.processType}</span>
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                                    {it.outsourceMaterialType}
                                  </span>
                                </div>
                                {(it.itemCode || it.jobCardNo) && (
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono pt-0.5">
                                    {it.itemCode && <span>Code: {it.itemCode}</span>}
                                    {it.jobCardNo && <span className="text-amber-600 dark:text-amber-400">JC: {it.jobCardNo}</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 space-y-1">
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 font-medium">Item Name:</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{order.itemName}</span>
                          </div>
                          {order.itemCode && (
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-slate-400 font-medium">Item Code:</span>
                              <span className="font-mono text-slate-600 dark:text-slate-400">{order.itemCode}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 font-medium">Quantity:</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">
                              {order.orderQty} {order.unit}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 font-medium">Process:</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{order.processType}</span>
                          </div>
                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 font-medium">Material Type:</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                              {order.outsourceMaterialType}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Flow Progress */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 flex items-center gap-1">
                            <UserCheck className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            Assignee:
                          </span>
                          <span className={`font-bold ${isMyAssigned ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}`}>
                            {order.assignedToUserName} {isMyAssigned && '(You)'}
                          </span>
                        </div>

                        {order.supplierName && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Building className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                              Supplier PO:
                            </span>
                            <span className="font-bold text-purple-700 dark:text-purple-300">
                              {order.supplierName} ({order.supplierPoNo})
                            </span>
                          </div>
                        )}

                        {order.estimatedDelivery && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                              Target Arrival:
                            </span>
                            <span className={`font-bold ${deliveryStatus.isDelayed ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                              {order.estimatedDelivery}
                            </span>
                          </div>
                        )}

                        {order.receivedQty && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 flex items-center gap-1">
                              <PackageCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              Received Goods:
                            </span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">
                              {order.receivedQty} {order.unit} ({order.receivedMaterialType})
                            </span>
                          </div>
                        )}

                        {order.targetDepartmentAfterReceipt && (
                          <div className="flex items-center justify-between text-[11px] bg-emerald-50 dark:bg-emerald-950/40 p-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/80">
                            <span className="text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-1">
                              <Send className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              Routed To:
                            </span>
                            <span className="font-extrabold text-emerald-900 dark:text-emerald-200">
                              {order.targetDepartmentAfterReceipt}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions depending on workflow step */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                      {/* Step 1: Assignee places Supplier PO */}
                      {order.status === 'Assigned' && (
                        isPurchaserUser(currentUser, order) ? (
                          <button
                            onClick={() => openPoModal(order)}
                            className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" />
                            Accept Order &amp; Enter Supplier
                          </button>
                        ) : (
                          <div className="w-full py-2 bg-amber-50/80 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-xs font-semibold rounded-xl text-center flex items-center justify-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 text-amber-600" />
                            Only Purchase / {order.assignedToUserName} can enter supplier
                          </div>
                        )
                      )}

                      {/* Step 2: Receive Material against Supplier PO */}
                      {(order.status === 'Supplier PO Placed' || order.status === 'In Transit') && (
                        isPurchaserUser(currentUser, order) ? (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => openEditDeliveryModal(order)}
                              className="py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              Update ETA
                            </button>

                            <button
                              onClick={() => openReceiptModal(order)}
                              className="py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition shadow-xs cursor-pointer"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              Receive Material
                            </button>
                          </div>
                        ) : (
                          <div className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs font-semibold rounded-xl text-center flex items-center justify-center gap-1.5 border border-slate-200 dark:border-slate-700">
                            <Lock className="h-3.5 w-3.5 text-slate-400" />
                            Only Purchase Department can receive material
                          </div>
                        )
                      )}

                      {/* Step 3: Complete Order */}
                      {order.status === 'Material Received' && (
                        isPurchaserUser(currentUser, order) ? (
                          <button
                            onClick={() => handleCompleteOrder(order)}
                            className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            Mark Order Completed
                          </button>
                        ) : (
                          <div className="w-full py-2 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 text-xs font-semibold rounded-xl text-center flex items-center justify-center gap-1.5 border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            Material Accepted by Purchase
                          </div>
                        )
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE ORDER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white font-sans">
                  Place Process Outsource Order
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4 text-xs">
              {/* Header Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Party / Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Acme Corporation"
                    value={partyName}
                    onChange={e => setPartyName(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Assign Authorized Person to Handle Outsourcing *
                  </label>
                  <select
                    required
                    value={assignedToUserId}
                    onChange={e => setAssignedToUserId(e.target.value)}
                    className="w-full bg-blue-50/80 dark:bg-slate-900 border border-blue-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 font-bold focus:outline-none"
                  >
                    <option value="">-- Select Authorized Assignee --</option>
                    {availableAssignees.map(u => (
                      <option key={u.userId} value={u.userId}>
                        {u.name} ({u.department} - {u.role === 'super_admin' ? 'Super Admin' : 'Authorized Assignee'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Items Section */}
              <div className="space-y-3">
                <div className="flex justify-between items-center pt-1">
                  <div className="flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                      Sourcing Order Items ({formItems.length})
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-xl font-bold text-xs flex items-center gap-1 cursor-pointer transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Another Item
                  </button>
                </div>

                <div className="space-y-3">
                  {formItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="bg-slate-50/70 dark:bg-slate-950 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 relative transition"
                    >
                      <div className="flex justify-between items-center border-b border-slate-200/60 dark:border-slate-800/60 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-600 text-white font-mono font-bold text-[10px] flex items-center justify-center">
                            {index + 1}
                          </span>
                          <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                            Item #{index + 1} Details
                          </span>
                          {item.jobCardNo && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-mono text-[10px] font-bold">
                              Linked: {item.jobCardNo}
                            </span>
                          )}
                        </div>

                        {formItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItemRow(index)}
                            className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
                            title="Remove this item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Optional Job Card Sync for this item */}
                      <div>
                        <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                          Link Job Card to Auto-Fill Item (Optional)
                        </label>
                        <select
                          value={item.jobCardNo}
                          onChange={e => handleSelectJobCardForItem(index, e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none text-[11px]"
                        >
                          <option value="">-- Custom / Direct Item --</option>
                          {jobCards.map(jc => (
                            <option key={jc.jobCardNo} value={jc.jobCardNo}>
                              {jc.jobCardNo} - {jc.partyName} ({jc.itemName})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                            Item Name *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Gear Shaft 40mm"
                            value={item.itemName}
                            onChange={e => updateFormItem(index, 'itemName', e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                            Item Code
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. MFR-1004"
                            value={item.itemCode}
                            onChange={e => updateFormItem(index, 'itemCode', e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-slate-500 font-medium mb-1 text-[11px]">Quantity *</label>
                            <input
                              type="number"
                              required
                              min={1}
                              value={item.orderQty}
                              onChange={e => updateFormItem(index, 'orderQty', Number(e.target.value))}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 font-bold focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-500 font-medium mb-1 text-[11px]">Unit *</label>
                            <select
                              value={item.unit}
                              onChange={e => updateFormItem(index, 'unit', e.target.value as any)}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none"
                            >
                              <option value="KGS">KGS</option>
                              <option value="PCS">PCS</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                            Outsource Process Type *
                          </label>
                          <select
                            value={item.processType}
                            onChange={e => updateFormItem(index, 'processType', e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none text-[11px]"
                          >
                            <option value="External Heat Treatment">External Heat Treatment</option>
                            <option value="Precision Plating & Coating">Precision Plating &amp; Coating</option>
                            <option value="CNC Threading & Grinding">CNC Threading &amp; Grinding</option>
                            <option value="Braking & Bending">Braking &amp; Bending</option>
                            <option value="Full Component Outsourcing">Full Component Outsourcing</option>
                          </select>
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-slate-500 font-medium mb-1 text-[11px]">
                            Outsource Material Classification *
                          </label>
                          <select
                            value={item.outsourceMaterialType}
                            onChange={e => updateFormItem(index, 'outsourceMaterialType', e.target.value as any)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none text-[11px]"
                          >
                            <option value="Semi Finished Goods">Semi Finished Goods</option>
                            <option value="Finished Goods">Finished Goods</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">
                  Dispatch Instructions / Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="Special instructions for outsourcing..."
                  value={dispatchRemarks}
                  onChange={e => setDispatchRemarks(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  <Truck className="h-4 w-4" />
                  Place Order ({formItems.length} {formItems.length === 1 ? 'Item' : 'Items'})
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUPPLIER PO MODAL */}
      {poModalOrder && (() => {
        const isAssignedPerson = poModalOrder.assignedToUserId === currentUser?.userId || currentUser?.role === 'super_admin';
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white font-sans">
                    Place Supplier Purchase Order
                  </h3>
                  <span className="text-xs font-mono text-purple-600 dark:text-purple-400 font-bold">
                    {poModalOrder.orderId} - {poModalOrder.itemName}
                  </span>
                </div>
                <button
                  onClick={() => setPoModalOrder(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Assignee Authorization Notice */}
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 ${
                isAssignedPerson 
                  ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-300'
                  : 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-300'
              }`}>
                {isAssignedPerson ? (
                  <UserCheck className="h-5 w-5 text-blue-600 shrink-0" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
                )}
                <div>
                  <p className="font-bold">
                    {isAssignedPerson ? 'Authorized Assignee' : 'Restricted Access'}
                  </p>
                  <p className="text-[11px] leading-tight mt-0.5">
                    Order Assigned to: <strong>{poModalOrder.assignedToUserName}</strong>
                    {!isAssignedPerson && ' — Only this assigned person can enter supplier details and accept this order.'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmitPo} className="space-y-3.5 text-xs">
                {/* Supplier Name Input Field - Specifically for Assigned Person on Order Acceptance */}
                <div className="bg-purple-50/50 dark:bg-purple-950/20 p-3 rounded-xl border border-purple-100 dark:border-purple-900/40 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="block text-slate-800 dark:text-slate-200 font-bold text-xs">
                      Supplier / Vendor Name *
                    </label>
                    {isAssignedPerson ? (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/80 dark:text-emerald-300 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800/80 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Assigned Person Access
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 dark:bg-rose-950/80 dark:text-rose-300 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-800/80">
                        Locked (Only {poModalOrder.assignedToUserName})
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    disabled={!isAssignedPerson}
                    placeholder="e.g. Apex Heat Treaters Pvt Ltd"
                    value={supplierName}
                    onChange={e => setSupplierName(e.target.value)}
                    className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Specify the external vendor/supplier executing this outsource job upon order acceptance.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-500 font-medium mb-1">PO Number *</label>
                    <input
                      type="text"
                      required
                      disabled={!isAssignedPerson}
                      value={supplierPoNo}
                      onChange={e => setSupplierPoNo(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 font-mono text-slate-800 dark:text-slate-200 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-medium mb-1">Unit Rate (&#8377;)</label>
                    <input
                      type="number"
                      step="0.01"
                      disabled={!isAssignedPerson}
                      placeholder="0.00"
                      value={supplierRate}
                      onChange={e => setSupplierRate(Number(e.target.value))}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-500 font-medium mb-1">Estimated Material Arrival Date *</label>
                  <input
                    type="date"
                    required
                    disabled={!isAssignedPerson}
                    value={estimatedDelivery}
                    onChange={e => setEstimatedDelivery(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none font-bold text-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-slate-500 font-medium mb-1">PO Remarks / Terms</label>
                  <textarea
                    rows={2}
                    disabled={!isAssignedPerson}
                    placeholder="e.g. High surface hardness spec required..."
                    value={poRemarks}
                    onChange={e => setPoRemarks(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setPoModalOrder(null)}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!isAssignedPerson}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Confirm Supplier PO
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* UPDATE DELIVERY DATE MODAL */}
      {editDeliveryOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white font-sans flex items-center gap-1.5">
                  <CalendarClock className="h-5 w-5 text-amber-500" />
                  Revise Estimated Arrival Date
                </h3>
                <span className="text-xs font-mono text-blue-600 dark:text-blue-400 font-bold">
                  {editDeliveryOrder.orderId} - {editDeliveryOrder.supplierName}
                </span>
              </div>
              <button
                onClick={() => setEditDeliveryOrder(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateDeliveryDate} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 font-medium mb-1">
                  New Promised Delivery Date *
                </label>
                <input
                  type="date"
                  required
                  value={newDeliveryDate}
                  onChange={e => setNewDeliveryDate(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 font-bold text-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">
                  Reason for Revision / Supplier Update
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Supplier requested 2 extra days due to furnace maintenance..."
                  value={deliveryUpdateReason}
                  onChange={e => setDeliveryUpdateReason(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditDeliveryOrder(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-sm cursor-pointer"
                >
                  Update Arrival Date
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MATERIAL RECEIPT MODAL */}
      {receiptModalOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white font-sans">
                  Record Material Receipt (Purchase)
                </h3>
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  {receiptModalOrder.orderId} - {receiptModalOrder.supplierName}
                </span>
              </div>
              <button
                onClick={() => setReceiptModalOrder(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitReceipt} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-500 font-medium mb-1">
                    Received Quantity ({receiptModalOrder.unit}) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={receivedQty}
                    onChange={e => setReceivedQty(Number(e.target.value))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 font-bold text-blue-600 dark:text-blue-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-500 font-medium mb-1">Challan / Invoice No. *</label>
                  <input
                    type="text"
                    required
                    value={receivedChallanNo}
                    onChange={e => setReceivedChallanNo(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 font-mono text-slate-800 dark:text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">
                  Received Material Classification *
                </label>
                <select
                  value={receivedMaterialType}
                  onChange={e => handleReceiptMaterialTypeChange(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 font-bold focus:outline-none"
                >
                  <option value="Semi Finished Goods">Semi Finished Goods (Requires further plant work)</option>
                  <option value="Finished Goods">Finished Goods (Ready for Final Packing/Dispatch)</option>
                </select>
              </div>

              {/* Destination Department Routing */}
              <div className="bg-emerald-50/70 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/80 space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block text-slate-900 dark:text-slate-100 font-bold text-xs flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Destination Department (Next Process) *
                  </label>
                  <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/60 px-2 py-0.5 rounded-md">
                    {receivedMaterialType === 'Finished Goods' ? 'Store Transfer' : 'In-House Operation Route'}
                  </span>
                </div>
                <select
                  value={targetDepartmentAfterReceipt}
                  onChange={e => setTargetDepartmentAfterReceipt(e.target.value as Department)}
                  className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {receivedMaterialType === 'Finished Goods' ? (
                    <>
                      <option value="Store">Store (Finished Goods Warehouse / Stock)</option>
                      <option value="Dispatch">Dispatch (Ready for Direct Customer Shipment)</option>
                    </>
                  ) : (
                    <>
                      <option value="Heat Treatment">Heat Treatment (Furnace / Hardening / Annealing)</option>
                      <option value="Plating">Plating (Surface Coating / Zinc / Nickel)</option>
                      <option value="Production">Production (Machining / Shop Floor Work)</option>
                      <option value="Store">Store (Semi-Finished Buffer Storage)</option>
                    </>
                  )}
                </select>
                <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
                  {receivedMaterialType === 'Finished Goods'
                    ? 'Finished goods accepted from vendor will be transferred directly to Store.'
                    : `Semi-finished goods accepted from vendor will be routed to ${targetDepartmentAfterReceipt} for subsequent processing.`}
                </p>
              </div>

              <div>
                <label className="block text-slate-500 font-medium mb-1">
                  Material Quality / Inspection Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Inspected 100% ok, surface plating thickness verified."
                  value={receiptRemarks}
                  onChange={e => setReceiptRemarks(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setReceiptModalOrder(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm cursor-pointer"
                >
                  Record Material Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
