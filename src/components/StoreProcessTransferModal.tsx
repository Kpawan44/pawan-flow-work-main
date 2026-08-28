import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Send, 
  PackageCheck, 
  Sparkles, 
  QrCode, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  Search, 
  Warehouse, 
  Layers, 
  ArrowRight 
} from 'lucide-react';
import { JobCard, MaterialMovement, ProcessTransfer, ProcessTransferType, UserProfile } from '../types';
import { getJobCardProcessMetrics } from '../lib/metrics';
import ScannerModal from './ScannerModal';

interface StoreProcessTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  processTransfers: ProcessTransfer[];
  currentUser: UserProfile;
  preselectedJobCardNo?: string | null;
  onSubmit: (transfer: {
    jobCardNo: string;
    poNumber?: string;
    orderNo?: string;
    customer: string;
    itemName: string;
    itemCode?: string;
    material?: string;
    currentLocation?: string;
    quantity: number;
    unit: 'PCS' | 'KGS';
    toProcess: ProcessTransferType;
    remarks?: string;
  }) => Promise<void>;
}

export default function StoreProcessTransferModal({
  isOpen,
  onClose,
  jobCards,
  movements,
  processTransfers,
  currentUser,
  preselectedJobCardNo,
  onSubmit
}: StoreProcessTransferModalProps) {
  const [selectedJobCardNo, setSelectedJobCardNo] = useState<string>('');
  const [toProcess, setToProcess] = useState<ProcessTransferType>('Repacking');
  const [transferQty, setTransferQty] = useState<number | string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [showScanner, setShowScanner] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Calculate available material items in Store
  const storeAvailableItems = React.useMemo(() => {
    return jobCards
      .map(j => {
        const metrics = getJobCardProcessMetrics(j, movements, processTransfers);
        const availableQty = metrics.qtyRemainingInStock;
        return {
          jobCard: j,
          availableQty,
          unit: j.unit || 'PCS',
          location: j.storeDetails?.locationBin 
            ? `${j.storeDetails.locationBin}${j.storeDetails?.rackNo ? ' / ' + j.storeDetails.rackNo : ''}`
            : 'Store Main Floor'
        };
      })
      .filter(item => item.availableQty > 0);
  }, [jobCards, movements, processTransfers]);

  // Set initial selected item when modal opens
  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccess('');
      setIsSubmitting(false);
      setRemarks('');
      
      if (preselectedJobCardNo) {
        setSelectedJobCardNo(preselectedJobCardNo);
        const matched = storeAvailableItems.find(i => i.jobCard.jobCardNo.toLowerCase() === preselectedJobCardNo.toLowerCase());
        if (matched) {
          setTransferQty(matched.availableQty);
        }
      } else if (storeAvailableItems.length > 0) {
        setSelectedJobCardNo(storeAvailableItems[0].jobCard.jobCardNo);
        setTransferQty(storeAvailableItems[0].availableQty);
      } else {
        setSelectedJobCardNo('');
        setTransferQty('');
      }
    }
  }, [isOpen, preselectedJobCardNo, storeAvailableItems]);

  const activeItem = React.useMemo(() => {
    return storeAvailableItems.find(i => i.jobCard.jobCardNo.toLowerCase() === selectedJobCardNo.toLowerCase());
  }, [storeAvailableItems, selectedJobCardNo]);

  // Update quantity default when user changes selected card
  const handleSelectJobCard = (cardNo: string) => {
    setSelectedJobCardNo(cardNo);
    setError('');
    const matched = storeAvailableItems.find(i => i.jobCard.jobCardNo.toLowerCase() === cardNo.toLowerCase());
    if (matched) {
      setTransferQty(matched.availableQty);
    }
  };

  const parsedQty = typeof transferQty === 'number' ? transferQty : parseFloat(transferQty) || 0;
  const availableQty = activeItem ? activeItem.availableQty : 0;
  const remainingStoreBalance = Math.max(0, availableQty - parsedQty);
  const isOverAllocated = parsedQty > availableQty;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!activeItem) {
      setError('Please select a valid material item from available Store inventory.');
      return;
    }
    if (parsedQty <= 0) {
      setError('Transfer quantity must be greater than 0.');
      return;
    }
    if (isOverAllocated) {
      setError(`Cannot transfer ${parsedQty.toLocaleString()} ${activeItem.unit}. Available in Store is only ${availableQty.toLocaleString()} ${activeItem.unit}.`);
      return;
    }
    if (!toProcess) {
      setError('Please select a destination process (Repacking or Replating).');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        jobCardNo: activeItem.jobCard.jobCardNo,
        poNumber: activeItem.jobCard.poNumber || activeItem.jobCard.orderNo || '',
        orderNo: activeItem.jobCard.orderNo || '',
        customer: activeItem.jobCard.partyName || 'Internal Store Stock',
        itemName: activeItem.jobCard.itemName,
        itemCode: activeItem.jobCard.itemCode,
        material: activeItem.jobCard.materialType || 'Finished Goods',
        currentLocation: activeItem.location,
        quantity: parsedQty,
        unit: activeItem.unit,
        toProcess,
        remarks: remarks.trim()
      });

      setSuccess(`Successfully sent ${parsedQty.toLocaleString()} ${activeItem.unit} to ${toProcess}!`);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Process transfer error:', err);
      setError(err?.message || 'Failed to submit process transfer.');
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col font-sans">
        
        {/* Modal Header */}
        <div className="px-6 py-4.5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/15 rounded-xl border border-white/20">
              <Warehouse className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-wide uppercase font-mono">
                Store ➔ Send for Process
              </h2>
              <p className="text-[11px] text-emerald-100 font-sans">
                Internal material movement to Repacking or Replating
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          
          {/* Alerts */}
          {error && (
            <div className="p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-xl text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* 1. Destination Selection (Mandatory) */}
          <div className="space-y-2">
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Select Destination Process <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Repacking Option */}
              <button
                type="button"
                onClick={() => setToProcess('Repacking')}
                className={`p-3.5 rounded-2xl border-2 transition-all flex items-center gap-3 cursor-pointer text-left ${
                  toProcess === 'Repacking'
                    ? 'bg-pink-50/80 dark:bg-pink-950/30 border-pink-500 text-pink-900 dark:text-pink-100 shadow-md shadow-pink-500/10 scale-[1.01]'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className={`p-2.5 rounded-xl ${toProcess === 'Repacking' ? 'bg-pink-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-sm font-extrabold block">Repacking</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">Custom boxing & labeling</span>
                </div>
              </button>

              {/* Replating Option */}
              <button
                type="button"
                onClick={() => setToProcess('Replating')}
                className={`p-3.5 rounded-2xl border-2 transition-all flex items-center gap-3 cursor-pointer text-left ${
                  toProcess === 'Replating'
                    ? 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-500 text-purple-900 dark:text-purple-100 shadow-md shadow-purple-500/10 scale-[1.01]'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className={`p-2.5 rounded-xl ${toProcess === 'Replating' ? 'bg-purple-500 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-sm font-extrabold block">Replating</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">Surface recoating & touch-up</span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Material Selection from Store */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="store-jobcard-select" className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Select Store Material <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="px-2.5 py-1 text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-100 rounded-lg border border-indigo-200 dark:border-indigo-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>Scan QR / Barcode</span>
              </button>
            </div>

            {storeAvailableItems.length === 0 ? (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-medium">
                No material is currently available in the Store inventory to transfer.
              </div>
            ) : (
              <select
                id="store-jobcard-select"
                value={selectedJobCardNo}
                onChange={e => handleSelectJobCard(e.target.value)}
                className="w-full min-h-[48px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-800 dark:text-white font-medium focus:outline-none focus:border-emerald-500"
              >
                {storeAvailableItems.map(item => (
                  <option key={item.jobCard.jobCardNo} value={item.jobCard.jobCardNo}>
                    {item.jobCard.jobCardNo} — {item.jobCard.itemName} ({item.availableQty.toLocaleString()} {item.unit} available @ {item.location})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected Item Detail Card */}
          {activeItem && (
            <div className="p-4 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 font-sans">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                <span className="font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400">
                  {activeItem.jobCard.jobCardNo}
                </span>
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  PO: {activeItem.jobCard.poNumber || activeItem.jobCard.orderNo || '-'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Part / Item</span>
                  <span className="font-bold text-slate-800 dark:text-white">{activeItem.jobCard.itemName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Customer / Party</span>
                  <span className="font-bold text-slate-800 dark:text-white">{activeItem.jobCard.partyName || '-'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Location</span>
                  <span className="font-bold text-slate-800 dark:text-white">{activeItem.location}</span>
                </div>
              </div>
            </div>
          )}

          {/* 3. Quantity & Live Stock Calculation */}
          <div className="space-y-3 pt-1">
            <label htmlFor="transfer-quantity" className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Transfer Quantity ({activeItem?.unit || 'PCS'}) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="transfer-quantity"
                type="number"
                min={1}
                max={availableQty}
                step="any"
                required
                value={transferQty}
                onChange={e => {
                  setTransferQty(e.target.value);
                  setError('');
                }}
                placeholder={`Enter quantity to send (max ${availableQty})`}
                className={`w-full min-h-[48px] h-12 bg-[#F8FAFC] dark:bg-slate-950 border rounded-xl px-4 py-3 text-sm font-mono font-bold text-slate-800 dark:text-white focus:outline-none ${
                  isOverAllocated ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-800 focus:border-emerald-500'
                }`}
              />
              <button
                type="button"
                onClick={() => setTransferQty(availableQty)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 text-[10.5px] font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition"
              >
                Max ({availableQty.toLocaleString()})
              </button>
            </div>

            {/* Live Calculation Overview Cards */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 rounded-xl text-center">
                <span className="text-[9.5px] font-bold uppercase text-blue-600 dark:text-blue-400 block font-mono">Store Available</span>
                <span className="text-xs sm:text-sm font-extrabold font-mono text-slate-800 dark:text-white mt-0.5 block">
                  {availableQty.toLocaleString()} {activeItem?.unit}
                </span>
              </div>

              <div className="p-3 bg-purple-50/70 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40 rounded-xl text-center">
                <span className="text-[9.5px] font-bold uppercase text-purple-600 dark:text-purple-400 block font-mono">Send for {toProcess}</span>
                <span className={`text-xs sm:text-sm font-extrabold font-mono mt-0.5 block ${isOverAllocated ? 'text-red-600' : 'text-purple-700 dark:text-purple-300'}`}>
                  {parsedQty.toLocaleString()} {activeItem?.unit}
                </span>
              </div>

              <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/40 rounded-xl text-center">
                <span className="text-[9.5px] font-bold uppercase text-emerald-600 dark:text-emerald-400 block font-mono">Store Balance</span>
                <span className="text-xs sm:text-sm font-extrabold font-mono text-emerald-700 dark:text-emerald-300 mt-0.5 block">
                  {remainingStoreBalance.toLocaleString()} {activeItem?.unit}
                </span>
              </div>
            </div>
          </div>

          {/* 4. Remarks */}
          <div className="space-y-1.5">
            <label htmlFor="process-remarks" className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Remarks / Process Instructions (Optional)
            </label>
            <input
              id="process-remarks"
              type="text"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="e.g. Special packing spec for export or Zinc blue replating"
              className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-800 dark:text-white font-medium focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition cursor-pointer min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || storeAvailableItems.length === 0 || isOverAllocated || parsedQty <= 0}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-lg shadow-emerald-600/20 active:scale-98 transition disabled:opacity-50 flex items-center gap-2 cursor-pointer min-h-[44px]"
            >
              <Send className="h-4 w-4" />
              <span>{isSubmitting ? 'Transferring...' : `Confirm Transfer to ${toProcess}`}</span>
            </button>
          </div>

        </form>

      </div>

      {/* QR Scanner Modal Overlay */}
      {showScanner && (
        <ScannerModal
          isOpen={showScanner}
          onClose={() => setShowScanner(false)}
          onScan={(scannedVal) => {
            const clean = scannedVal.trim();
            const matched = storeAvailableItems.find(i => 
              i.jobCard.jobCardNo.toLowerCase() === clean.toLowerCase() ||
              clean.toLowerCase().includes(i.jobCard.jobCardNo.toLowerCase())
            );
            if (matched) {
              handleSelectJobCard(matched.jobCard.jobCardNo);
              setShowScanner(false);
            } else {
              alert(`Job Card "${clean}" not found in available Store inventory.`);
            }
          }}
        />
      )}
    </div>
  );
}
