import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, FileText, CheckCircle, Flame, ShieldAlert, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile } from '../types';
import { getRawMaterialIssuedQty } from '../lib/metrics';
import { INVENTORY_RAW_MATERIALS_SEED, computeRmRuntimeStock } from '../hardening/rmSkuMaster';
import { DBService } from '../lib/firebase';

interface RawMaterial {
  code: string;
  name: string;
  category: string;
  availableStock: number;
  unit: string;
  location: string;
}

export const INVENTORY_RAW_MATERIALS: RawMaterial[] = INVENTORY_RAW_MATERIALS_SEED.map((s) => ({
  code: s.code,
  name: s.name,
  category: s.category,
  availableStock: s.availableStock,
  unit: s.unit,
  location: s.location
}));

interface RawMaterialRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  currentUser: UserProfile | null;
  onSubmit: (request: {
    jobCardNo: string;
    rawMaterialCode: string;
    rawMaterialName: string;
    quantity: number;
    urgency: 'Low' | 'Medium' | 'High' | 'Critical';
    remarks: string;
  }) => Promise<void>;
  movements?: MaterialMovement[];
  initialJobCardNo?: string;
}

export function getDynamicRawMaterialsStock(movements: MaterialMovement[], master?: Array<{ code: string; openingQty: number; name?: string; category?: string; unit?: string; location?: string }>): RawMaterial[] {
  const rows = master && master.length > 0
    ? master.map((m) => ({
        code: m.code,
        name: m.name || m.code,
        category: m.category || '',
        availableStock: m.openingQty,
        unit: m.unit || 'KG',
        location: m.location || ''
      }))
    : INVENTORY_RAW_MATERIALS;

  return rows.map((item) => {
    const opening = item.availableStock;
    const currentStock = computeRmRuntimeStock(opening, movements, item.code);
    return { ...item, availableStock: currentStock };
  });
}

export default function RawMaterialRequestModal({
  isOpen,
  onClose,
  jobCards,
  currentUser,
  onSubmit,
  movements = [],
  initialJobCardNo = ''
}: RawMaterialRequestModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState<RawMaterial | null>(null);
  const [selectedJobCardNo, setSelectedJobCardNo] = useState('');
  const [quantity, setQuantity] = useState<number>(100);
  const [urgency, setUrgency] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [remarks, setRemarks] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [skuMaster, setSkuMaster] = useState<Array<{ code: string; openingQty: number; name?: string; category?: string; unit?: string; location?: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    DBService.getRmSkuMaster().then((rows) => {
      if (Array.isArray(rows) && rows.length > 0) setSkuMaster(rows);
    }).catch(() => {});
  }, [isOpen]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedMaterial(null);
      setSelectedJobCardNo(initialJobCardNo || '');
      setQuantity(100);
      setUrgency('Medium');
      setRemarks('');
      setSuccess(false);
      setError('');

      // Auto pre-fill quantity if initialJobCardNo provided
      if (initialJobCardNo) {
        const jc = jobCards.find(j => j.jobCardNo.toLowerCase() === initialJobCardNo.toLowerCase());
        if (jc && jc.orderQty > 0) {
          setQuantity(jc.orderQty);
        }
      }
    }
  }, [isOpen, initialJobCardNo, jobCards]);

  const dynamicMaterials = getDynamicRawMaterialsStock(movements, skuMaster);

  const filteredMaterials = dynamicMaterials.filter(m =>
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Find active, incomplete job cards to link across all active departments
  const activeJobs = jobCards.filter(jc => !jc.completed && jc.status !== 'Rejected');

  const handleSelectMaterial = (material: RawMaterial) => {
    setSelectedMaterial(material);
    // Auto-prefill default quantity if empty or 0
    if (!quantity || quantity <= 0) {
      setQuantity(100);
    }
  };

  const handleJobCardChange = (jobCardNo: string) => {
    setSelectedJobCardNo(jobCardNo);
    const targetJob = jobCards.find(j => j.jobCardNo.toLowerCase() === jobCardNo.toLowerCase());
    if (targetJob && targetJob.orderQty > 0) {
      setQuantity(targetJob.orderQty);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) {
      setError('Please select a raw material from the inventory list.');
      return;
    }
    if (!selectedJobCardNo) {
      setError('Please select or specify a Job Card No to assign this request.');
      return;
    }
    if (quantity <= 0) {
      setError('Quantity requested must be greater than 0.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onSubmit({
        jobCardNo: selectedJobCardNo,
        rawMaterialCode: selectedMaterial.code,
        rawMaterialName: selectedMaterial.name,
        quantity,
        urgency,
        remarks: remarks || `Production requested ${quantity} KG of ${selectedMaterial.name}. Urgency: ${urgency}`
      });

      setSuccess(true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate([40, 40, 80]); } catch (_) {}
      }
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to submit raw material request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-950/70 backdrop-blur-xs print:hidden">
        {/* Backdrop close handler */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          onClick={() => !isSubmitting && !success && onClose()}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden z-10 flex flex-col max-h-[92vh] sm:max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">🪵</span>
                <h2 className="font-sans font-bold text-base text-slate-900 dark:text-white uppercase tracking-wider">
                  Raw Material Request
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Submit raw steel/materials requisitions from inventory to Raw Material Store
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting || success}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {success ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4"
            >
              <div className="h-16 w-16 bg-emerald-100 dark:bg-emerald-950/40 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-10 w-10 animate-bounce" />
              </div>
              <div>
                <h3 className="font-sans font-extrabold text-slate-900 dark:text-white text-lg uppercase tracking-wide">
                  Request Submitted Successfully!
                </h3>
                <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                  The requisition for <strong className="text-indigo-600 dark:text-indigo-400">{selectedMaterial?.name}</strong> has been logged in the Raw Material Store Ledger.
                </p>
                <div className="inline-flex items-center gap-1.5 mt-4 bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200/50 dark:border-emerald-900/40 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold text-emerald-800 dark:text-emerald-400 animate-pulse">
                  <Sparkles className="h-4 w-4 animate-spin" /> Store Operators Notified
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-y-auto lg:overflow-hidden">
              {/* Left Column: Inventory Picker */}
              <div className="lg:col-span-7 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 lg:h-full lg:overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      🔍 Step 1: Select Material Spec
                    </span>
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full font-mono">
                      {filteredMaterials.length} available specs
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search by code, material spec name, alloy type..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 pl-9 pr-4 py-2 rounded-xl text-xs focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>

                {/* Inventory Specs Scroll Area */}
                <div className="p-4 overflow-y-auto flex-1 space-y-2.5 max-h-[280px] lg:max-h-none">
                  {filteredMaterials.map(m => {
                    const isSelected = selectedMaterial?.code === m.code;
                    return (
                      <div
                        key={m.code}
                        onClick={() => handleSelectMaterial(m)}
                        className={`group p-3 rounded-xl border transition-all cursor-pointer text-left flex justify-between items-start ${
                          isSelected
                            ? 'bg-indigo-50/85 dark:bg-indigo-950/30 border-indigo-500 shadow-sm'
                            : 'bg-white dark:bg-slate-950 border-slate-200/60 dark:border-slate-850 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                            }`}>
                              {m.code}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                              {m.category}
                            </span>
                          </div>
                          <h4 className="font-sans font-bold text-slate-800 dark:text-slate-200 text-xs mt-1.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {m.name}
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-1 font-mono flex items-center gap-1">
                            📍 Location: <strong className="text-slate-500 dark:text-slate-350">{m.location}</strong>
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <span className="text-[10px] text-slate-400 block font-medium">Available Stock</span>
                          <span className={`font-mono text-xs font-bold ${
                            m.availableStock > 10000 
                              ? 'text-emerald-600 dark:text-emerald-400' 
                              : 'text-amber-600 dark:text-amber-400'
                          }`}>
                            {m.availableStock.toLocaleString()} {m.unit}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {filteredMaterials.length === 0 && (
                    <div className="text-center py-12 text-slate-400 space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                      <Search className="h-6 w-6 mx-auto text-slate-300" />
                      <p className="text-xs font-mono">No matching specifications found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Submission Form */}
              <form onSubmit={handleFormSubmit} className="lg:col-span-5 flex flex-col lg:h-full lg:overflow-hidden">
                <div className="p-5 flex-1 lg:overflow-y-auto space-y-4 text-left">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                    📝 Step 2: Request Settings
                  </span>

                  {selectedMaterial ? (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-indigo-50/40 dark:bg-indigo-950/15 border border-indigo-150 dark:border-indigo-900/40 rounded-xl p-3.5 space-y-1.5"
                    >
                      <span className="text-[9px] font-extrabold uppercase tracking-widest text-indigo-500 dark:text-indigo-400 block">Selected Material</span>
                      <h4 className="font-sans font-bold text-slate-800 dark:text-slate-100 text-xs">
                        {selectedMaterial.name}
                      </h4>
                      <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        Code: <strong>{selectedMaterial.code}</strong> | Stock: <strong>{selectedMaterial.availableStock.toLocaleString()} KG</strong>
                      </p>
                    </motion.div>
                  ) : (
                    <div className="bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
                      <p className="text-xs text-slate-400 italic">No material selected. Please click an item in the left inventory panel first.</p>
                    </div>
                  )}

                  {/* Job Card Link selector */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                      Link to Production Job Card *
                    </label>
                    <select
                      value={selectedJobCardNo}
                      onChange={e => handleJobCardChange(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 font-sans cursor-pointer text-slate-800 dark:text-slate-100 font-medium"
                    >
                      <option value="">-- Choose Job Card (Active Orders) --</option>
                      {selectedJobCardNo && !activeJobs.some(jc => jc.jobCardNo.toLowerCase() === selectedJobCardNo.toLowerCase()) && selectedJobCardNo !== 'GENERAL' && (
                        <option value={selectedJobCardNo}>
                          {selectedJobCardNo} (Selected Order)
                        </option>
                      )}
                      {activeJobs.map(jc => {
                        const prevIssued = getRawMaterialIssuedQty(jc, movements);
                        return (
                          <option key={jc.jobCardNo} value={jc.jobCardNo}>
                            {jc.jobCardNo} - {jc.partyName} ({jc.itemName}) [{jc.currentDepartment || 'Active'}] - {jc.orderQty} KG {prevIssued > 0 ? `(Issued so far: ${prevIssued} KG)` : ''}
                          </option>
                        );
                      })}
                      <option value="GENERAL">General / Internal Maintenance Store Request</option>
                    </select>

                    {selectedJobCardNo && selectedJobCardNo !== 'GENERAL' && (() => {
                      const selJob = activeJobs.find(jc => jc.jobCardNo.toLowerCase() === selectedJobCardNo.toLowerCase());
                      if (!selJob) return null;
                      const issuedSoFar = getRawMaterialIssuedQty(selJob, movements);
                      return (
                        <div className="mt-2 p-2.5 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-900/40 rounded-xl text-[10.5px] text-indigo-900 dark:text-indigo-300 font-sans flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span>🪵</span>
                            <span>Issued RM so far: <strong className="font-mono font-bold text-indigo-700 dark:text-indigo-300">{issuedSoFar} KG</strong> for order {selJob.orderQty} KG</span>
                          </div>
                          {issuedSoFar > 0 && (
                            <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase shrink-0">
                              Re-issue Allowed
                            </span>
                          )}
                        </div>
                      );
                    })()}

                    <p className="text-[9.5px] text-slate-400 mt-1">
                      *Multiple raw material requisitions for a single job card are supported. Requisitions are logged in the RM Store ledger.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Quantity field */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                        Quantity Required (KG) *
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={quantity || ''}
                        onChange={e => {
                          const clean = e.target.value.replace(/[^0-9.]/g, '');
                          setQuantity(clean === '' ? 0 : parseFloat(clean));
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 py-3.5 px-4 rounded-xl font-mono text-xs focus:outline-none focus:border-indigo-500 font-bold text-slate-800 dark:text-white"
                        placeholder="E.g., 250"
                      />
                      {selectedMaterial && quantity > selectedMaterial.availableStock && (
                        <div className="flex items-center gap-1 text-[9.5px] text-amber-600 dark:text-amber-400 font-medium mt-1">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Exceeds available stock
                        </div>
                      )}
                    </div>

                    {/* Urgency selection */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                        Urgency Level *
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['Low', 'Medium', 'High', 'Critical'] as const).map(level => {
                          const isSel = urgency === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              onClick={() => setUrgency(level)}
                              className={`py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wide border cursor-pointer text-center transition-all ${
                                isSel
                                  ? level === 'Critical'
                                    ? 'bg-rose-500 border-rose-500 text-white shadow-sm ring-1 ring-rose-500 animate-pulse'
                                    : level === 'High'
                                    ? 'bg-amber-600 border-amber-600 text-white shadow-sm'
                                    : level === 'Medium'
                                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                    : 'bg-slate-600 border-slate-600 text-white shadow-sm'
                                  : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900'
                              }`}
                            >
                              {level === 'Critical' ? '🔥 Crit' : level}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Special Remarks */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                      Requisition Remarks / Instructions
                    </label>
                    <textarea
                      rows={3}
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="E.g., High alloy composition needed. Deliver to cutting floor section B."
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5 rounded-xl text-xs focus:outline-none focus:border-indigo-500 text-slate-800 dark:text-slate-100"
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/40 p-3 rounded-xl">
                      <ShieldAlert className="h-4 w-4 shrink-0" />
                      <p className="font-semibold">{error}</p>
                    </div>
                  )}
                </div>

                {/* Footer buttons */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/35 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-xs transition cursor-pointer disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedMaterial || !selectedJobCardNo}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-550 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl font-extrabold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Submitting Request...
                      </>
                    ) : (
                      <>
                        Submit Request to Store
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
