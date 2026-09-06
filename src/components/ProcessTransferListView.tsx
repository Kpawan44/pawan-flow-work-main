import React, { useState } from 'react';
import { 
  PackageCheck, 
  Sparkles, 
  Check, 
  Play, 
  ArrowRight, 
  RotateCcw, 
  Search, 
  Filter, 
  Warehouse, 
  AlertCircle, 
  CheckCircle2, 
  X,
  FileText,
  Clock,
  MapPin,
  Send,
  Boxes,
  Info
} from 'lucide-react';
import { ProcessTransfer, ProcessTransferType, ProcessTransferStatus, UserProfile } from '../types';

interface ProcessTransferListViewProps {
  transfers: ProcessTransfer[];
  processType?: ProcessTransferType | 'All';
  currentUser: UserProfile;
  onReceive: (transferId: string, remarks?: string) => Promise<void>;
  onStartProcess: (transferId: string, remarks?: string) => Promise<void>;
  onCompleteAndReturn: (
    transferId: string, 
    completedQty: number, 
    rejectionQty: number, 
    reason: string, 
    bin: string, 
    rack: string, 
    remarks?: string
  ) => Promise<void>;
  onAssignRack?: (
    transferId: string,
    returnRack: string,
    returnBin: string,
    remarks?: string
  ) => Promise<void>;
}

export default function ProcessTransferListView({
  transfers,
  processType = 'All',
  currentUser,
  onReceive,
  onStartProcess,
  onCompleteAndReturn,
  onAssignRack
}: ProcessTransferListViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [flowFilter, setFlowFilter] = useState<'All' | 'Plating' | 'Packing'>('All');
  
  // Complete Modal State (used by Plating to send to Packing, and Packing to send to Store)
  const [completingTransfer, setCompletingTransfer] = useState<ProcessTransfer | null>(null);
  const [completedQty, setCompletedQty] = useState<number | string>('');
  const [rejectionQty, setRejectionQty] = useState<number | string>(0);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [completionRemarks, setCompletionRemarks] = useState<string>('');
  
  // Store Rack Assignment Modal State (used by Store to assign rack upon arrival from packing)
  const [rackAssigningTransfer, setRackAssigningTransfer] = useState<ProcessTransfer | null>(null);
  const [assignRackNo, setAssignRackNo] = useState<string>('RACK-01');
  const [assignLocationBin, setAssignLocationBin] = useState<string>('BIN-A1');
  const [assignRemarks, setAssignRemarks] = useState<string>('');

  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');

  // Quick rack & bin presets
  const quickRacks = ['RACK-01', 'RACK-02', 'RACK-03', 'RACK-04', 'RACK-A', 'RACK-B', 'RACK-C'];
  const quickBins = ['BIN-A1', 'BIN-A2', 'BIN-B1', 'BIN-B2', 'BIN-C1', 'BIN-D1', 'STORE-MAIN'];

  const filteredTransfers = transfers.filter(t => {
    // If rendered for Packing department tab, include direct Repacking transfers AND Plating-completed transfers arrived at Packing
    if (processType === 'Repacking') {
      const isForPacking = t.toProcess === 'Repacking' ||
        t.status === 'Plating Completed - Sent to Packing' ||
        t.status === 'Sent to Packing' ||
        t.status === 'Received at Packing' ||
        t.status === 'Packing in Process';
      if (!isForPacking) return false;
    } else if (processType === 'Replating') {
      if (t.toProcess !== 'Replating') return false;
    }

    if (flowFilter === 'Plating' && t.toProcess !== 'Replating') return false;
    if (flowFilter === 'Packing' && t.toProcess !== 'Repacking') return false;

    if (statusFilter !== 'All' && t.status !== statusFilter) return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNo = t.transferNo.toLowerCase().includes(q);
      const matchJob = t.jobCardNo.toLowerCase().includes(q);
      const matchItem = t.itemName.toLowerCase().includes(q);
      const matchCust = t.customer.toLowerCase().includes(q);
      const matchRack = (t.returnRackNo || '').toLowerCase().includes(q);
      if (!matchNo && !matchJob && !matchItem && !matchCust && !matchRack) return false;
    }
    return true;
  });

  const getStatusBadge = (status: ProcessTransferStatus) => {
    switch (status) {
      case 'Sent to Repacking':
      case 'Sent to Replating':
        return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/30 animate-pulse';
      case 'Received at Repacking':
      case 'Received at Replating':
      case 'Received at Packing':
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/30';
      case 'Replating in Process':
      case 'Repacking in Process':
      case 'Packing in Process':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/30';
      case 'Plating Completed - Sent to Packing':
      case 'Sent to Packing':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/30 animate-pulse';
      case 'Packing Completed - Sent to Store':
        return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700/50 ring-2 ring-amber-500/20 animate-pulse';
      case 'Repacking Completed':
      case 'Replating Completed':
      case 'Returned to Store':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/30';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const handleOpenCompleteModal = (t: ProcessTransfer) => {
    setCompletingTransfer(t);
    // If completing plating, default to plating transfer quantity
    const defaultQty = t.status === 'Packing in Process'
      ? (t.platingCompletedQty || t.quantity)
      : t.quantity;
    setCompletedQty(defaultQty);
    setRejectionQty(0);
    setRejectionReason('');
    setCompletionRemarks('');
    setActionError('');
  };

  const handleOpenAssignRackModal = (t: ProcessTransfer) => {
    setRackAssigningTransfer(t);
    setAssignRackNo(t.returnRackNo || 'RACK-01');
    setAssignLocationBin(t.returnLocationBin || (t.currentLocation ? t.currentLocation.split('/')[0].trim() : 'BIN-A1'));
    setAssignRemarks('');
    setActionError('');
  };

  const handleConfirmCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingTransfer) return;

    const parsedComp = typeof completedQty === 'number' ? completedQty : parseFloat(completedQty) || 0;
    const parsedRej = typeof rejectionQty === 'number' ? rejectionQty : parseFloat(rejectionQty) || 0;

    if (parsedComp <= 0) {
      setActionError('Completed quantity must be greater than 0.');
      return;
    }
    if (parsedRej < 0) {
      setActionError('Rejection quantity cannot be negative.');
      return;
    }

    const maxAllowed = completingTransfer.status === 'Packing in Process' && completingTransfer.platingCompletedQty
      ? completingTransfer.platingCompletedQty
      : completingTransfer.quantity;

    if (parsedComp + parsedRej > maxAllowed * 1.05) { // 5% tolerance for weighing variance
      setActionError(`Total completed (${parsedComp}) + rejected (${parsedRej}) exceeds input quantity (${maxAllowed} ${completingTransfer.unit}).`);
      return;
    }

    setIsProcessingAction(true);
    try {
      await onCompleteAndReturn(
        completingTransfer.transferId,
        parsedComp,
        parsedRej,
        rejectionReason,
        '', // Bin will be assigned by Store
        '', // Rack will be assigned by Store
        completionRemarks
      );
      setCompletingTransfer(null);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to complete process step.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  const handleConfirmRackAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rackAssigningTransfer) return;

    if (!assignRackNo.trim()) {
      setActionError('Rack number is mandatory for store storage.');
      return;
    }
    if (!assignLocationBin.trim()) {
      setActionError('Bin location is mandatory for store storage.');
      return;
    }

    setIsProcessingAction(true);
    try {
      if (onAssignRack) {
        await onAssignRack(
          rackAssigningTransfer.transferId,
          assignRackNo.trim(),
          assignLocationBin.trim(),
          assignRemarks.trim()
        );
      } else {
        // Fallback to completeAndReturn
        const qtyToReturn = rackAssigningTransfer.packingCompletedQty ?? rackAssigningTransfer.completedQty ?? rackAssigningTransfer.quantity;
        await onCompleteAndReturn(
          rackAssigningTransfer.transferId,
          qtyToReturn,
          0,
          '',
          assignLocationBin.trim(),
          assignRackNo.trim(),
          assignRemarks.trim()
        );
      }
      setRackAssigningTransfer(null);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to assign rack.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Check pending rack assignments count
  const pendingRackCount = transfers.filter(t => t.status === 'Packing Completed - Sent to Store').length;

  return (
    <div className="space-y-4 font-sans">
      
      {/* Alert banner for Store when material arrives from Packing waiting for Rack */}
      {pendingRackCount > 0 && (
        <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border-2 border-amber-300 dark:border-amber-700/60 rounded-2xl flex items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-extrabold uppercase font-mono text-amber-900 dark:text-amber-200">
                Action Required: {pendingRackCount} Batch{pendingRackCount > 1 ? 'es' : ''} Arrived from Packing
              </h4>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-0.5">
                Material has finished packing and arrived in Store. Store personnel must assign <strong>Rack & Bin location</strong> to restore into inventory.
              </p>
            </div>
          </div>
          <button
            onClick={() => setStatusFilter('Packing Completed - Sent to Store')}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-extrabold shadow-sm transition shrink-0 cursor-pointer"
          >
            Filter Pending Racks
          </button>
        </div>
      )}

      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Transfer No, Job Card, Item, Customer, Rack..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Flow Filter */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
            <button
              onClick={() => setFlowFilter('All')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                flowFilter === 'All' ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              All Flows
            </button>
            <button
              onClick={() => setFlowFilter('Plating')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition flex items-center gap-1 ${
                flowFilter === 'Plating' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Plating ➔ Packing ➔ Store</span>
            </button>
            <button
              onClick={() => setFlowFilter('Packing')}
              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition flex items-center gap-1 ${
                flowFilter === 'Packing' ? 'bg-pink-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              <PackageCheck className="h-3 w-3" />
              <span>Packing ➔ Store</span>
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-white font-medium focus:outline-none"
            >
              <option value="All">All Statuses</option>
              <option value="Sent to Replating">Sent to Replating</option>
              <option value="Received at Replating">Received at Replating</option>
              <option value="Replating in Process">Replating in Process</option>
              <option value="Plating Completed - Sent to Packing">Plating Completed ➔ Sent to Packing</option>
              <option value="Sent to Repacking">Sent to Repacking</option>
              <option value="Received at Packing">Received at Packing</option>
              <option value="Packing in Process">Packing in Process</option>
              <option value="Packing Completed - Sent to Store">Packing Completed ➔ Assign Store Rack</option>
              <option value="Returned to Store">Returned to Store (Stocked)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Transfers Cards / Table */}
      {filteredTransfers.length === 0 ? (
        <div className="p-10 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <div className="inline-flex p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-400">
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No process transfers found</p>
          <p className="text-xs text-slate-400">
            Transfers between Store, Plating, and Packing will appear here with live workflow progression.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTransfers.map(t => {
            const isReplatingFlow = t.toProcess === 'Replating' || t.flowType === 'STORE_PLATING_PACKING_STORE';
            
            // Plating Stage Statuses
            const isPlatingPending = t.status === 'Sent to Replating';
            const isPlatingReceived = t.status === 'Received at Replating';
            const isPlatingInProcess = t.status === 'Replating in Process';
            const isPlatingDone = t.status === 'Plating Completed - Sent to Packing' || 
              t.status === 'Received at Packing' || 
              t.status === 'Packing in Process' || 
              t.status === 'Packing Completed - Sent to Store' || 
              t.status === 'Returned to Store';

            // Packing Stage Statuses
            const isPackingPending = t.status === 'Sent to Repacking' || t.status === 'Plating Completed - Sent to Packing' || t.status === 'Sent to Packing';
            const isPackingReceived = t.status === 'Received at Repacking' || t.status === 'Received at Packing';
            const isPackingInProcess = t.status === 'Repacking in Process' || t.status === 'Packing in Process';
            const isPackingDone = t.status === 'Packing Completed - Sent to Store' || t.status === 'Returned to Store';

            // Store Rack Assignment Status
            const isAwaitingRack = t.status === 'Packing Completed - Sent to Store' || t.status === 'Repacking Completed';
            const isReturned = t.status === 'Returned to Store';

            return (
              <div 
                key={t.transferId}
                className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all space-y-4 ${
                  isAwaitingRack 
                    ? 'border-amber-300 dark:border-amber-700/60 ring-2 ring-amber-500/10' 
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-150 dark:border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl text-white ${isReplatingFlow ? 'bg-purple-600 shadow-xs shadow-purple-600/20' : 'bg-pink-600 shadow-xs shadow-pink-600/20'}`}>
                      {isReplatingFlow ? <Sparkles className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-extrabold text-xs text-slate-800 dark:text-white">
                          {t.transferNo}
                        </span>
                        <span className={`px-2 py-0.2 rounded text-[9px] font-extrabold ${isReplatingFlow ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300'}`}>
                          {isReplatingFlow ? 'Store ➔ Plating (KGS) ➔ Packing ➔ Store' : 'Store ➔ Packing ➔ Store'}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-slate-400 font-mono block mt-0.5">
                        Job Card: <strong className="text-indigo-600 dark:text-indigo-400">{t.jobCardNo}</strong>
                      </span>
                    </div>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${getStatusBadge(t.status)}`}>
                    {t.status}
                  </span>
                </div>

                {/* Workflow Stepper Progress Bar */}
                <div className="bg-slate-50 dark:bg-slate-850/80 p-3 rounded-xl border border-slate-200/70 dark:border-slate-800">
                  <div className="text-[9px] uppercase font-mono font-bold text-slate-400 mb-2 flex items-center justify-between">
                    <span>Workflow Stages</span>
                    <span>{isReturned ? 'Completed' : 'Active'}</span>
                  </div>

                  {isReplatingFlow ? (
                    // 4-Step: Store -> Plating (KGS) -> Packing -> Store Rack
                    <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                      {/* Step 1: Store (Sent in KGS) */}
                      <div className="p-1.5 bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-lg border border-emerald-300/40 font-semibold">
                        <span className="block font-bold">1. Store</span>
                        <span className="text-[9px] font-mono">{t.quantity} KGS</span>
                      </div>

                      {/* Step 2: Plating */}
                      <div className={`p-1.5 rounded-lg border font-semibold ${
                        isPlatingDone 
                          ? 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300/40' 
                          : isPlatingInProcess || isPlatingReceived || isPlatingPending
                            ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 border-purple-400 ring-1 ring-purple-400 animate-pulse' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200'
                      }`}>
                        <span className="block font-bold">2. Plating</span>
                        <span className="text-[9px] font-mono">
                          {isPlatingDone ? `${t.platingCompletedQty || t.quantity} KGS` : isPlatingInProcess ? 'Processing' : 'Pending'}
                        </span>
                      </div>

                      {/* Step 3: Packing */}
                      <div className={`p-1.5 rounded-lg border font-semibold ${
                        isPackingDone 
                          ? 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300/40' 
                          : isPackingInProcess || isPackingReceived || isPackingPending
                            ? 'bg-pink-100 dark:bg-pink-950/60 text-pink-900 dark:text-pink-200 border-pink-400 ring-1 ring-pink-400 animate-pulse' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200'
                      }`}>
                        <span className="block font-bold">3. Packing</span>
                        <span className="text-[9px] font-mono">
                          {isPackingDone ? 'Packed' : isPackingInProcess ? 'Packing' : isPlatingDone ? 'Queue' : 'Waiting'}
                        </span>
                      </div>

                      {/* Step 4: Store Rack */}
                      <div className={`p-1.5 rounded-lg border font-semibold ${
                        isReturned 
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                          : isAwaitingRack
                            ? 'bg-amber-400 text-amber-950 border-amber-500 font-extrabold animate-bounce shadow-xs' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200'
                      }`}>
                        <span className="block font-bold">4. Store Rack</span>
                        <span className="text-[9px] font-mono">
                          {isReturned ? (t.returnRackNo || 'Stocked') : isAwaitingRack ? 'Assign Rack' : 'Waiting'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    // 3-Step: Store -> Packing -> Store Rack
                    <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                      {/* Step 1: Store */}
                      <div className="p-1.5 bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-lg border border-emerald-300/40 font-semibold">
                        <span className="block font-bold">1. Store</span>
                        <span className="text-[9px] font-mono">{t.quantity} {t.unit}</span>
                      </div>

                      {/* Step 2: Packing */}
                      <div className={`p-1.5 rounded-lg border font-semibold ${
                        isPackingDone 
                          ? 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300/40' 
                          : isPackingInProcess || isPackingReceived || isPackingPending
                            ? 'bg-pink-100 dark:bg-pink-950/60 text-pink-900 dark:text-pink-200 border-pink-400 ring-1 ring-pink-400 animate-pulse' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200'
                      }`}>
                        <span className="block font-bold">2. Packing</span>
                        <span className="text-[9px] font-mono">
                          {isPackingDone ? 'Packed' : isPackingInProcess ? 'Packing' : 'Pending'}
                        </span>
                      </div>

                      {/* Step 3: Store Rack */}
                      <div className={`p-1.5 rounded-lg border font-semibold ${
                        isReturned 
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                          : isAwaitingRack
                            ? 'bg-amber-400 text-amber-950 border-amber-500 font-extrabold animate-bounce shadow-xs' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200'
                      }`}>
                        <span className="block font-bold">3. Store Rack</span>
                        <span className="text-[9px] font-mono">
                          {isReturned ? (t.returnRackNo || 'Stocked') : isAwaitingRack ? 'Assign Rack' : 'Waiting'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Item / Part</span>
                    <span className="font-bold text-slate-800 dark:text-white truncate block">{t.itemName}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Customer</span>
                    <span className="font-bold text-slate-800 dark:text-white truncate block">{t.customer}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Transfer Quantity</span>
                    <span className="font-mono font-extrabold text-sm text-indigo-700 dark:text-indigo-300">
                      {t.quantity.toLocaleString()} {t.unit}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Current Location / Rack</span>
                    <span className="font-bold text-slate-800 dark:text-white">
                      {t.returnRackNo ? `${t.returnLocationBin || 'Bin'} / ${t.returnRackNo}` : (t.currentLocation || 'Store Main Floor')}
                    </span>
                  </div>
                </div>

                {/* Stage Activity Log */}
                <div className="bg-slate-50 dark:bg-slate-850/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800 text-[10.5px] space-y-1 text-slate-500 dark:text-slate-400 font-mono">
                  <div className="flex items-center justify-between">
                    <span>Sent by Store: {t.transferDate}</span>
                    <span>User: {t.createdBy}</span>
                  </div>

                  {/* Plating Info if applicable */}
                  {isReplatingFlow && t.platingCompletedBy && (
                    <div className="flex items-center justify-between text-purple-600 dark:text-purple-400 border-t border-slate-200 dark:border-slate-800 pt-1">
                      <span>Plating Completed: {t.platingCompletedQty} KGS</span>
                      <span>By: {t.platingCompletedBy}</span>
                    </div>
                  )}

                  {/* Packing Info if applicable */}
                  {t.packingCompletedBy && (
                    <div className="flex items-center justify-between text-pink-600 dark:text-pink-400 border-t border-slate-200 dark:border-slate-800 pt-1">
                      <span>Packing Completed: {t.packingCompletedQty} {t.unit}</span>
                      <span>By: {t.packingCompletedBy}</span>
                    </div>
                  )}

                  {/* Store Rack Info if assigned */}
                  {t.rackAssignedBy && (
                    <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 font-bold border-t border-slate-200 dark:border-slate-800 pt-1">
                      <span>Assigned Rack: {t.returnRackNo} ({t.returnLocationBin})</span>
                      <span>By: {t.rackAssignedBy}</span>
                    </div>
                  )}

                  {t.remarks && (
                    <div className="pt-1 text-slate-600 dark:text-slate-300 italic border-t border-slate-200 dark:border-slate-800">
                      Note: {t.remarks}
                    </div>
                  )}
                </div>

                {/* Lifecycle Action Buttons */}
                <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                  
                  {/* Plating Actions */}
                  {isPlatingPending && (
                    <button
                      onClick={() => onReceive(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Check className="h-4 w-4" />
                      <span>Confirm Receipt at Plating ({t.quantity} KGS)</span>
                    </button>
                  )}

                  {isPlatingReceived && (
                    <button
                      onClick={() => onStartProcess(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Play className="h-4 w-4" />
                      <span>Start Plating Process</span>
                    </button>
                  )}

                  {isPlatingInProcess && (
                    <button
                      onClick={() => handleOpenCompleteModal(t)}
                      className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <ArrowRight className="h-4 w-4" />
                      <span>Complete Plating & Forward to Packing</span>
                    </button>
                  )}

                  {/* Packing Actions */}
                  {isPackingPending && (
                    <button
                      onClick={() => onReceive(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Check className="h-4 w-4" />
                      <span>Confirm Receipt at Packing</span>
                    </button>
                  )}

                  {isPackingReceived && (
                    <button
                      onClick={() => onStartProcess(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Play className="h-4 w-4" />
                      <span>Start Packing Process</span>
                    </button>
                  )}

                  {isPackingInProcess && (
                    <button
                      onClick={() => handleOpenCompleteModal(t)}
                      className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-pink-600 to-amber-600 hover:from-pink-700 hover:to-amber-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Send className="h-4 w-4" />
                      <span>Complete Packing & Send to Store</span>
                    </button>
                  )}

                  {/* Store Rack Assignment Action (Both processes conclude here!) */}
                  {isAwaitingRack && (
                    <button
                      onClick={() => handleOpenAssignRackModal(t)}
                      className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-amber-500 to-emerald-600 hover:from-amber-600 hover:to-emerald-700 text-white rounded-xl text-xs font-extrabold shadow-md active:scale-98 transition flex items-center justify-center gap-2 cursor-pointer min-h-[42px] ring-2 ring-amber-400/40"
                    >
                      <Warehouse className="h-4 w-4 text-white" />
                      <span>Assign Rack & Receive in Store</span>
                    </button>
                  )}

                  {isReturned && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Stocked in Store: Rack {t.returnRackNo || 'Assigned'} ({t.returnLocationBin || 'Bin'})</span>
                    </div>
                  )}

                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Complete Process Modal (Plating -> Packing OR Packing -> Store) */}
      {completingTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl text-white ${completingTransfer.status === 'Replating in Process' ? 'bg-purple-600' : 'bg-pink-600'}`}>
                  {completingTransfer.status === 'Replating in Process' ? <Sparkles className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-800 dark:text-white uppercase font-mono">
                    {completingTransfer.status === 'Replating in Process' ? 'Complete Plating ➔ Forward to Packing' : 'Complete Packing ➔ Send to Store'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Transfer No: <strong className="text-indigo-600 font-mono">{completingTransfer.transferNo}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCompletingTransfer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Informative notice */}
            <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
              completingTransfer.status === 'Replating in Process'
                ? 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 text-purple-900 dark:text-purple-200'
                : 'bg-pink-50 dark:bg-pink-950/30 border-pink-200 text-pink-900 dark:text-pink-200'
            }`}>
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-[11px] leading-relaxed">
                {completingTransfer.status === 'Replating in Process'
                  ? 'Plating is recorded in KGS. Once confirmed, this batch will automatically appear in the Packing department queue.'
                  : 'Packing completion will dispatch material to Store. Store personnel will assign the final Rack & Bin location upon putaway.'}
              </p>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 rounded-xl text-red-700 dark:text-red-300 text-xs font-semibold">
                {actionError}
              </div>
            )}

            <form onSubmit={handleConfirmCompletion} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                  Completed / Accepted Quantity ({completingTransfer.unit}) *
                </label>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  required
                  value={completedQty}
                  onChange={e => setCompletedQty(e.target.value)}
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 font-mono font-bold text-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                  Process Rejection Quantity ({completingTransfer.unit})
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={rejectionQty}
                  onChange={e => setRejectionQty(e.target.value)}
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 font-mono font-bold text-slate-800 dark:text-white"
                />
              </div>

              {Number(rejectionQty) > 0 && (
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                    Rejection Reason
                  </label>
                  <input
                    type="text"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="e.g. Plating peel off / Defective bag"
                    className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-800 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                  Remarks / Notes (Optional)
                </label>
                <input
                  type="text"
                  value={completionRemarks}
                  onChange={e => setCompletionRemarks(e.target.value)}
                  placeholder="e.g. Completed without issues"
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-800 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCompletingTransfer(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingAction}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-extrabold shadow-sm active:scale-98 transition cursor-pointer"
                >
                  {isProcessingAction ? 'Submitting...' : completingTransfer.status === 'Replating in Process' ? 'Forward to Packing' : 'Send to Store'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* MODAL 2: Store Assign Rack Modal (Crucial user requirement: store assigns rack in both processes) */}
      {rackAssigningTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-lg space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500 text-white rounded-xl shadow-xs">
                  <Warehouse className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-800 dark:text-white uppercase font-mono">
                    Store ➔ Assign Rack & Bin Location
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Job Card: <strong className="text-indigo-600 font-mono">{rackAssigningTransfer.jobCardNo}</strong> ({rackAssigningTransfer.itemName})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRackAssigningTransfer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Banner detailing return */}
            <div className="p-3.5 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-2xl text-xs text-amber-900 dark:text-amber-200 space-y-1">
              <div className="flex items-center justify-between font-mono font-bold">
                <span>Material Returned from Packing:</span>
                <span className="text-sm text-emerald-700 dark:text-emerald-400">
                  {rackAssigningTransfer.packingCompletedQty ?? rackAssigningTransfer.completedQty ?? rackAssigningTransfer.quantity} {rackAssigningTransfer.unit}
                </span>
              </div>
              <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                Please assign the storage Rack & Bin location. Once confirmed, this material is officially stocked in Store inventory and ready for dispatch.
              </p>
            </div>

            {actionError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/30 rounded-xl text-red-700 dark:text-red-300 text-xs font-semibold">
                {actionError}
              </div>
            )}

            <form onSubmit={handleConfirmRackAssignment} className="space-y-4 text-xs">
              
              {/* Rack Selection */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-200 uppercase text-[10.5px]">
                  Store Rack Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={assignRackNo}
                  onChange={e => setAssignRackNo(e.target.value.toUpperCase())}
                  placeholder="e.g. RACK-01, RACK-02"
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 font-mono font-extrabold text-slate-800 dark:text-white uppercase focus:outline-none focus:border-amber-500"
                />
                {/* Quick Rack Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {quickRacks.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAssignRackNo(r)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition cursor-pointer ${
                        assignRackNo === r
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bin Location */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-200 uppercase text-[10.5px]">
                  Store Bin / Shelf Location <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={assignLocationBin}
                  onChange={e => setAssignLocationBin(e.target.value.toUpperCase())}
                  placeholder="e.g. BIN-A1, BIN-B2"
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 font-mono font-extrabold text-slate-800 dark:text-white uppercase focus:outline-none focus:border-amber-500"
                />
                {/* Quick Bin Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {quickBins.map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setAssignLocationBin(b)}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition cursor-pointer ${
                        assignLocationBin === b
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                  Putaway Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={assignRemarks}
                  onChange={e => setAssignRemarks(e.target.value)}
                  placeholder="e.g. Inspected and placed on upper shelf"
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-800 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRackAssigningTransfer(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingAction || !assignRackNo.trim() || !assignLocationBin.trim()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold shadow-sm active:scale-98 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{isProcessingAction ? 'Assigning...' : `Confirm Rack Assignment (${assignRackNo})`}</span>
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
