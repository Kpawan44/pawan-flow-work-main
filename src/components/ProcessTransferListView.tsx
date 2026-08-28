import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PackageCheck, 
  Sparkles, 
  Check, 
  Play, 
  ArrowRight, 
  RotateCcw, 
  Search, 
  Filter, 
  Calendar, 
  User, 
  Warehouse, 
  AlertCircle, 
  CheckCircle2, 
  X,
  FileText,
  Clock
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
}

export default function ProcessTransferListView({
  transfers,
  processType = 'All',
  currentUser,
  onReceive,
  onStartProcess,
  onCompleteAndReturn
}: ProcessTransferListViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  
  // Return Modal State
  const [completingTransfer, setCompletingTransfer] = useState<ProcessTransfer | null>(null);
  const [completedQty, setCompletedQty] = useState<number | string>('');
  const [rejectionQty, setRejectionQty] = useState<number | string>(0);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [returnBin, setReturnBin] = useState<string>('BIN-A1');
  const [returnRack, setReturnRack] = useState<string>('RACK-01');
  const [completionRemarks, setCompletionRemarks] = useState<string>('');
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>('');

  const filteredTransfers = transfers.filter(t => {
    if (processType !== 'All' && t.toProcess !== processType) return false;
    if (statusFilter !== 'All' && t.status !== statusFilter) return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchNo = t.transferNo.toLowerCase().includes(q);
      const matchJob = t.jobCardNo.toLowerCase().includes(q);
      const matchItem = t.itemName.toLowerCase().includes(q);
      const matchCust = t.customer.toLowerCase().includes(q);
      if (!matchNo && !matchJob && !matchItem && !matchCust) return false;
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
        return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/30';
      case 'Repacking in Process':
      case 'Replating in Process':
        return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/30';
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
    setCompletedQty(t.quantity);
    setRejectionQty(0);
    setRejectionReason('');
    setReturnBin(t.currentLocation ? t.currentLocation.split('/')[0].trim() : 'BIN-A1');
    setReturnRack(t.currentLocation && t.currentLocation.includes('/') ? t.currentLocation.split('/')[1].trim() : 'RACK-01');
    setCompletionRemarks('');
    setActionError('');
  };

  const handleConfirmCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingTransfer) return;

    const parsedComp = typeof completedQty === 'number' ? completedQty : parseFloat(completedQty) || 0;
    const parsedRej = typeof rejectionQty === 'number' ? rejectionQty : parseFloat(rejectionQty) || 0;

    if (parsedComp < 0 || parsedRej < 0) {
      setActionError('Quantities cannot be negative.');
      return;
    }
    if (parsedComp + parsedRej > completingTransfer.quantity) {
      setActionError(`Total of completed (${parsedComp}) + rejected (${parsedRej}) cannot exceed original transfer quantity (${completingTransfer.quantity}).`);
      return;
    }

    setIsProcessingAction(true);
    try {
      await onCompleteAndReturn(
        completingTransfer.transferId,
        parsedComp,
        parsedRej,
        rejectionReason,
        returnBin,
        returnRack,
        completionRemarks
      );
      setCompletingTransfer(null);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to complete transfer.');
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div className="space-y-4 font-sans">
      
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Transfer No (STP-...), Job Card, Item, Customer..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-white font-medium focus:outline-none"
          >
            <option value="All">All Statuses</option>
            <option value="Sent to Repacking">Sent to Repacking</option>
            <option value="Received at Repacking">Received at Repacking</option>
            <option value="Repacking in Process">Repacking in Process</option>
            <option value="Sent to Replating">Sent to Replating</option>
            <option value="Received at Replating">Received at Replating</option>
            <option value="Replating in Process">Replating in Process</option>
            <option value="Returned to Store">Returned to Store</option>
          </select>
        </div>
      </div>

      {/* Transfers Cards / Table */}
      {filteredTransfers.length === 0 ? (
        <div className="p-10 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center space-y-2">
          <div className="inline-flex p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-slate-400">
            <FileText className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No process transfers found</p>
          <p className="text-xs text-slate-400">Transfers sent from Store to Repacking or Replating will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTransfers.map(t => {
            const isRepacking = t.toProcess === 'Repacking';
            const isPendingReceipt = t.status === 'Sent to Repacking' || t.status === 'Sent to Replating';
            const isReceived = t.status === 'Received at Repacking' || t.status === 'Received at Replating';
            const isInProcess = t.status === 'Repacking in Process' || t.status === 'Replating in Process';
            const isReturned = t.status === 'Returned to Store';

            return (
              <div 
                key={t.transferId}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all space-y-4"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-150 dark:border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-xl text-white ${isRepacking ? 'bg-pink-500 shadow-xs shadow-pink-500/20' : 'bg-purple-500 shadow-xs shadow-purple-500/20'}`}>
                      {isRepacking ? <PackageCheck className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    </div>
                    <div>
                      <span className="font-mono font-extrabold text-xs text-slate-800 dark:text-white block">
                        {t.transferNo}
                      </span>
                      <span className="text-[10.5px] text-slate-400 font-mono">
                        Job Card: <strong className="text-indigo-600 dark:text-indigo-400">{t.jobCardNo}</strong>
                      </span>
                    </div>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wide border ${getStatusBadge(t.status)}`}>
                    {t.status}
                  </span>
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
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">From / Origin</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{t.fromLocation} ({t.currentLocation || 'Main Bin'})</span>
                  </div>
                </div>

                {/* Timeline / Progress Trace */}
                <div className="bg-slate-50 dark:bg-slate-850/60 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800 text-[10.5px] space-y-1 text-slate-500 dark:text-slate-400 font-mono">
                  <div className="flex items-center justify-between">
                    <span>Sent: {t.transferDate} {t.transferTime}</span>
                    <span>By: {t.createdBy}</span>
                  </div>
                  {t.receivedBy && (
                    <div className="flex items-center justify-between text-blue-600 dark:text-blue-400">
                      <span>Received: {t.receivedAt ? new Date(t.receivedAt).toLocaleDateString('en-GB') : '-'}</span>
                      <span>By: {t.receivedBy}</span>
                    </div>
                  )}
                  {t.completedBy && (
                    <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Returned: {t.completedQty} {t.unit} (Rej: {t.rejectionQty || 0})</span>
                      <span>By: {t.completedBy}</span>
                    </div>
                  )}
                  {t.remarks && (
                    <div className="pt-1 text-slate-600 dark:text-slate-300 italic border-t border-slate-200 dark:border-slate-800">
                      Note: {t.remarks}
                    </div>
                  )}
                </div>

                {/* Lifecycle Action Buttons */}
                <div className="pt-1 flex items-center justify-end gap-2">
                  {isPendingReceipt && (
                    <button
                      onClick={() => onReceive(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Check className="h-4 w-4" />
                      <span>Confirm Receipt at {t.toProcess}</span>
                    </button>
                  )}

                  {isReceived && (
                    <button
                      onClick={() => onStartProcess(t.transferId)}
                      className="w-full sm:w-auto px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <Play className="h-4 w-4" />
                      <span>Start {t.toProcess}</span>
                    </button>
                  )}

                  {isInProcess && (
                    <button
                      onClick={() => handleOpenCompleteModal(t)}
                      className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold shadow-sm active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>Complete & Return to Store</span>
                    </button>
                  )}

                  {isReturned && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Returned to Store Inventory</span>
                    </div>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Completion & Return Modal */}
      {completingTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 w-full max-w-md space-y-4">
            
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-slate-800 dark:text-white uppercase font-mono flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-emerald-600" />
                Complete & Return to Store
              </h3>
              <button
                onClick={() => setCompletingTransfer(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
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
                  min={0}
                  max={completingTransfer.quantity}
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
                  max={completingTransfer.quantity}
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
                    placeholder="e.g. Plating peel off / Bag rupture"
                    className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-800 dark:text-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                    Return Bin Location
                  </label>
                  <input
                    type="text"
                    value={returnBin}
                    onChange={e => setReturnBin(e.target.value)}
                    placeholder="BIN-A1"
                    className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 font-mono font-bold text-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                    Return Rack No
                  </label>
                  <input
                    type="text"
                    value={returnRack}
                    onChange={e => setReturnRack(e.target.value)}
                    placeholder="RACK-01"
                    className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 font-mono font-bold text-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-600 dark:text-slate-350 uppercase text-[10px] mb-1">
                  Completion Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={completionRemarks}
                  onChange={e => setCompletionRemarks(e.target.value)}
                  placeholder="Notes on completed batch"
                  className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-800 dark:text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCompletingTransfer(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingAction}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-sm active:scale-98 transition"
                >
                  {isProcessingAction ? 'Submitting...' : 'Confirm Return'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
