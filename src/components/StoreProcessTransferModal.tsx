import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Send,
  PackageCheck,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Warehouse,
  Scale,
  ShoppingBag,
  Hash
} from 'lucide-react';
import { JobCard, MaterialMovement, ProcessTransfer, ProcessTransferType, UserProfile, DispatchStoreIssue } from '../types';
import { calculateStoreAuthoritativeItemStock, AuthoritativeItemStockSummary } from '../hardening/dispatchStoreIssue';
import { uniqueJobCardItemNames } from '../hardening/departmentJobCardFilter';
import { DBService } from '../lib/firebase';

interface StoreProcessTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  dispatchStoreIssues?: DispatchStoreIssue[];
  processTransfers?: ProcessTransfer[];
  currentUser: UserProfile;
  preselectedItemName?: string | null;
  onSubmit?: (transfer: any) => Promise<void>;
  onSuccess?: () => void;
}

export default function StoreProcessTransferModal({
  isOpen,
  onClose,
  jobCards,
  movements,
  dispatchStoreIssues = [],
  processTransfers = [],
  currentUser,
  preselectedItemName,
  onSubmit,
  onSuccess
}: StoreProcessTransferModalProps) {
  const [toProcess, setToProcess] = useState<ProcessTransferType>('Repacking');
  const [selectedItemName, setSelectedItemName] = useState<string>('');
  const [selectedItemCode, setSelectedItemCode] = useState<string>('');

  const [sendKgQty, setSendKgQty] = useState<string>('');
  const [sendPcsQty, setSendPcsQty] = useState<string>('');
  const [sendBagQty, setSendBagQty] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  // Extract all distinct items available in Store using established uniqueJobCardItemNames helper
  const availableItemNames = useMemo(() => {
    const activeJobs = (jobCards || []).filter(
      (j) => !j.completed && j.status !== 'Completed' && j.currentDepartment !== 'Completed'
    );
    const allNames = uniqueJobCardItemNames(activeJobs);

    // Keep items that have positive stock in Store (or include all active store items if none found)
    const itemsWithStock = allNames.filter((name) => {
      const stock = calculateStoreAuthoritativeItemStock(
        name,
        jobCards,
        movements,
        dispatchStoreIssues,
        undefined,
        processTransfers
      );
      return stock.availableKg > 0 || stock.availableBags > 0 || stock.availablePcs > 0;
    });

    return itemsWithStock.length > 0 ? itemsWithStock : allNames;
  }, [jobCards, movements, dispatchStoreIssues, processTransfers]);

  // Authoritative stock for the currently selected item
  const selectedItemStock: AuthoritativeItemStockSummary | null = useMemo(() => {
    if (!selectedItemName) return null;
    return calculateStoreAuthoritativeItemStock(
      selectedItemName,
      jobCards,
      movements,
      dispatchStoreIssues,
      selectedItemCode || undefined,
      processTransfers
    );
  }, [selectedItemName, selectedItemCode, jobCards, movements, dispatchStoreIssues, processTransfers]);

  // Initial load / synchronization
  useEffect(() => {
    if (isOpen) {
      setError('');
      setSuccess('');
      setIsSubmitting(false);
      setRemarks('');
      setSendKgQty('');
      setSendPcsQty('');
      setSendBagQty('');

      if (preselectedItemName && availableItemNames.includes(preselectedItemName)) {
        setSelectedItemName(preselectedItemName);
      } else if (preselectedItemName) {
        setSelectedItemName(preselectedItemName);
      } else if (availableItemNames.length === 1) {
        setSelectedItemName(availableItemNames[0]);
      } else {
        setSelectedItemName('');
      }
    }
  }, [isOpen, preselectedItemName, availableItemNames]);

  // When selectedItemStock changes, sync itemCode if available
  useEffect(() => {
    if (selectedItemStock && selectedItemStock.itemCode) {
      setSelectedItemCode(selectedItemStock.itemCode);
    }
  }, [selectedItemStock]);

  // Quantity parsing & validation
  const parsedKg = parseFloat(sendKgQty) || 0;
  const parsedPcs = sendPcsQty.trim() === '' ? 0 : (parseInt(sendPcsQty, 10) || 0);
  const parsedBags = sendBagQty.trim() === '' ? 0 : (parseInt(sendBagQty, 10) || 0);

  const availKg = selectedItemStock?.availableKg ?? 0;
  const availPcs = selectedItemStock?.availablePcs ?? 0;
  const availBags = selectedItemStock?.availableBags ?? 0;

  const isKgOver = parsedKg > availKg;
  const isPcsOver = parsedPcs > availPcs;
  const isBagsOver = parsedBags > availBags;
  const isFormValid = parsedKg > 0 && !isKgOver && !isPcsOver && !isBagsOver && Boolean(selectedItemName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedItemName) {
      setError('Please select an item from available Store inventory.');
      return;
    }
    if (parsedKg <= 0) {
      setError('KG to send is mandatory and must be greater than 0.');
      return;
    }
    if (isKgOver) {
      setError(`KG to send (${parsedKg} KG) exceeds available Store stock (${availKg} KG).`);
      return;
    }
    if (isPcsOver) {
      setError(`PCS to send (${parsedPcs} PCS) exceeds available Store stock (${availPcs} PCS).`);
      return;
    }
    if (isBagsOver) {
      setError(`BAGS to send (${parsedBags} BAGS) exceeds available Store stock (${availBags} BAGS).`);
      return;
    }

    setIsSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit({
          toProcess,
          itemName: selectedItemName,
          itemCode: selectedItemCode || undefined,
          issuedKgQty: parsedKg,
          issuedPcsQty: parsedPcs,
          issuedBagQty: parsedBags,
          remarks: remarks.trim() || undefined
        });
      } else {
        await DBService.issueStoreProcessTransfer({
          toProcess,
          itemName: selectedItemName,
          itemCode: selectedItemCode || undefined,
          issuedKgQty: parsedKg,
          issuedPcsQty: parsedPcs,
          issuedBagQty: parsedBags,
          remarks: remarks.trim() || undefined
        });
      }

      setSuccess(`Successfully issued ${parsedKg} KG of '${selectedItemName}' to ${toProcess}!`);
      if (onSuccess) onSuccess();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error('Store Process Transfer error:', err);
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
                Internal material movement for Repacking or Replating
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

          {/* 1. Destination Selection (Exactly Two Options) */}
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
                  <span className="text-sm font-extrabold block">1. REPACKING</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">Store ➔ Repacking ➔ Packing ➔ Store</span>
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
                  <span className="text-sm font-extrabold block">2. REPLATING</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">Store ➔ Replating ➔ Plating ➔ Store</span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Existing Item Name List / Selector */}
          <div className="space-y-1.5">
            <label htmlFor="store-process-item-select" className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Select Item Name <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                id="store-process-item-select"
                value={selectedItemName}
                onChange={(e) => {
                  setSelectedItemName(e.target.value);
                  setSendKgQty('');
                  setSendPcsQty('');
                  setSendBagQty('');
                  setError('');
                }}
                className="w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="">
                  {availableItemNames.length === 0
                    ? '-- No active items found in Store --'
                    : `-- Select Item Name from Store (${availableItemNames.length} available) --`}
                </option>
                {availableItemNames.map((name) => (
                  <option key={name} value={name}>
                    📦 {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. 3-Unit Available Stock Cards */}
          {selectedItemStock ? (
            <div className="p-4 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Selected Item</span>
                  <span className="text-sm font-extrabold text-slate-800 dark:text-white font-mono">
                    {selectedItemStock.itemName}
                  </span>
                  {selectedItemStock.itemCode && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
                      [{selectedItemStock.itemCode}]
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">Matching Job Cards</span>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                    {selectedItemStock.candidateJobCards.length} Job Card(s)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pt-1">
                {/* Available KG */}
                <div className="p-3 bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 rounded-xl text-center">
                  <div className="flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400 text-[10px] font-bold uppercase">
                    <Scale className="h-3 w-3" />
                    <span>Available KG</span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold font-mono text-blue-900 dark:text-blue-100 mt-0.5 block">
                    {availKg.toLocaleString()} KG
                  </span>
                </div>

                {/* Available PCS */}
                <div className="p-3 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/40 rounded-xl text-center">
                  <div className="flex items-center justify-center gap-1 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase">
                    <Hash className="h-3 w-3" />
                    <span>Available PCS</span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold font-mono text-indigo-900 dark:text-indigo-100 mt-0.5 block">
                    {availPcs.toLocaleString()} PCS
                  </span>
                </div>

                {/* Available BAGS */}
                <div className="p-3 bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-center">
                  <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400 text-[10px] font-bold uppercase">
                    <ShoppingBag className="h-3 w-3" />
                    <span>Available Bags</span>
                  </div>
                  <span className="text-sm sm:text-base font-extrabold font-mono text-amber-900 dark:text-amber-100 mt-0.5 block">
                    {availBags.toLocaleString()} BAGS
                  </span>
                </div>
              </div>

              {/* Candidate Job Cards FIFO Preview */}
              {selectedItemStock.candidateJobCards.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    <span>Store Job Cards FIFO Breakdown</span>
                    <span>{selectedItemStock.candidateJobCards.length} Batch(es)</span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] font-mono">
                    {selectedItemStock.candidateJobCards.map((c) => (
                      <div key={c.jobCardNo} className="flex items-center justify-between px-2 py-1 bg-white dark:bg-slate-900 rounded border border-slate-150 dark:border-slate-800">
                        <span className="font-bold text-indigo-500">{c.jobCardNo}</span>
                        <span className="text-slate-500 dark:text-slate-400 font-sans">{c.partyName || '-'}</span>
                        <span className="text-slate-700 dark:text-slate-200 font-semibold">
                          {c.availableKg} KG | {c.availablePcs} PCS | {c.availableBags} Bags
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-slate-50 dark:bg-slate-850/40 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-xs text-center font-medium">
              Please select an item from the Store list above to view available stock.
            </div>
          )}

          {/* 4. Form Inputs: KG TO SEND (Mandatory), PCS TO SEND (Optional), BAGS TO SEND (Optional) */}
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* KG TO SEND - MANDATORY */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1">
                  KG TO SEND <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0.001}
                    max={availKg}
                    step="any"
                    required
                    value={sendKgQty}
                    onChange={e => setSendKgQty(e.target.value)}
                    placeholder="Enter KG (mandatory)"
                    className={`w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:text-white focus:outline-none ${
                      isKgOver ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-800 focus:border-emerald-500'
                    }`}
                  />
                  {availKg > 0 && (
                    <button
                      type="button"
                      onClick={() => setSendKgQty(String(availKg))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[9.5px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                    >
                      Max
                    </button>
                  )}
                </div>
                {isKgOver && (
                  <span className="text-[10px] text-red-500 font-semibold block mt-0.5">
                    Exceeds available KG ({availKg})
                  </span>
                )}
              </div>

              {/* PCS TO SEND - OPTIONAL */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1">
                  PCS TO SEND <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={availPcs}
                    step={1}
                    value={sendPcsQty}
                    onChange={e => setSendPcsQty(e.target.value)}
                    placeholder="0"
                    className={`w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:text-white focus:outline-none ${
                      isPcsOver ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-800 focus:border-emerald-500'
                    }`}
                  />
                  {availPcs > 0 && (
                    <button
                      type="button"
                      onClick={() => setSendPcsQty(String(availPcs))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[9.5px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                    >
                      Max
                    </button>
                  )}
                </div>
                {isPcsOver && (
                  <span className="text-[10px] text-red-500 font-semibold block mt-0.5">
                    Exceeds available PCS ({availPcs})
                  </span>
                )}
              </div>

              {/* BAGS TO SEND - OPTIONAL */}
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200 mb-1">
                  BAGS TO SEND <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={availBags}
                    step={1}
                    value={sendBagQty}
                    onChange={e => setSendBagQty(e.target.value)}
                    placeholder="0"
                    className={`w-full min-h-[44px] bg-[#F8FAFC] dark:bg-slate-950 border rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-800 dark:text-white focus:outline-none ${
                      isBagsOver ? 'border-red-500 focus:border-red-500' : 'border-slate-200 dark:border-slate-800 focus:border-emerald-500'
                    }`}
                  />
                  {availBags > 0 && (
                    <button
                      type="button"
                      onClick={() => setSendBagQty(String(availBags))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[9.5px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                    >
                      Max
                    </button>
                  )}
                </div>
                {isBagsOver && (
                  <span className="text-[10px] text-red-500 font-semibold block mt-0.5">
                    Exceeds available Bags ({availBags})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 5. Remarks */}
          <div className="space-y-1.5">
            <label htmlFor="process-remarks" className="block text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Remarks / Process Instructions (Optional)
            </label>
            <input
              id="process-remarks"
              type="text"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="e.g. Special repacking request or plating thickness instructions"
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
              disabled={isSubmitting || !isFormValid}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-lg shadow-emerald-600/20 active:scale-98 transition disabled:opacity-50 flex items-center gap-2 cursor-pointer min-h-[44px]"
            >
              <Send className="h-4 w-4" />
              <span>{isSubmitting ? 'Transferring...' : `Confirm Transfer to ${toProcess}`}</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
