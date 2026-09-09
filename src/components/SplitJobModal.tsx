import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, GitBranch, AlertCircle, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { JobCard, UserProfile } from '../types';
import { DBService, getApiBaseUrl } from '../lib/firebase';
import { SimpleStore } from '../hardening/commitMaterialMovement';

interface SplitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCard: JobCard;
  currentUser?: UserProfile | null;
  onSuccess?: (result: any) => void;
}

export function createClientStore(): SimpleStore {
  return {
    async get(): Promise<any | null> {
      return null;
    },
    async set(): Promise<void> {
      throw new Error("Job card split cannot write from the client. Use POST /api/job-card/split.");
    },
    async list(): Promise<any[]> {
      return [];
    }
  };
}

export const SplitJobModal: React.FC<SplitJobModalProps> = ({
  isOpen,
  onClose,
  jobCard,
  currentUser,
  onSuccess
}) => {
  const parentJobNo = jobCard?.jobCardNo || '';
  const currentQty = jobCard?.currentQty ?? 0;
  const unitLabel = jobCard?.unit || 'KG';

  // Initialize with 2 default child splits
  const [splits, setSplits] = useState<Array<{ childJobCardNo: string; quantity: string }>>(() => {
    const half = Math.floor((currentQty / 2) * 100) / 100;
    const rem = Math.round((currentQty - half) * 100) / 100;
    return [
      { childJobCardNo: `${parentJobNo}-A`, quantity: half > 0 ? String(half) : '' },
      { childJobCardNo: `${parentJobNo}-B`, quantity: rem > 0 ? String(rem) : '' }
    ];
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const retryOperationIdRef = useRef<string>("");

  if (!isOpen || !jobCard) return null;

  const totalAllocated = splits.reduce((sum, s) => {
    const q = parseFloat(s.quantity);
    return sum + (isNaN(q) || q <= 0 ? 0 : q);
  }, 0);

  const roundedTotal = Math.round(totalAllocated * 1000) / 1000;
  const roundedParentQty = Math.round(currentQty * 1000) / 1000;
  const remainingQty = Math.max(0, Math.round((roundedParentQty - roundedTotal) * 1000) / 1000);
  const isOverAllocated = roundedTotal > roundedParentQty;

  const handleAddSplit = () => {
    const nextSuffix = String.fromCharCode(65 + splits.length); // C, D, E...
    const nextChildNo = `${parentJobNo}-${nextSuffix}`;
    setSplits([...splits, { childJobCardNo: nextChildNo, quantity: '' }]);
  };

  const handleRemoveSplit = (index: number) => {
    if (splits.length <= 1) return;
    setSplits(splits.filter((_, i) => i !== index));
  };

  const handleSplitChange = (index: number, field: 'childJobCardNo' | 'quantity', val: string) => {
    const updated = [...splits];
    updated[index] = { ...updated[index], [field]: val };
    setSplits(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (splits.length === 0) {
      setError('At least one child split is required.');
      return;
    }

    const childSplitsInput: Array<{ childJobCardNo: string; quantity: number }> = [];
    const usedChildIds = new Set<string>();

    for (let i = 0; i < splits.length; i++) {
      const entry = splits[i];
      const childNo = entry.childJobCardNo.trim().toUpperCase();
      const numQty = parseFloat(entry.quantity);

      if (!childNo) {
        setError(`Child Job #${i + 1} number cannot be empty.`);
        return;
      }
      if (childNo === parentJobNo.toUpperCase()) {
        setError(`Child Job #${i + 1} cannot have the same number as parent (${parentJobNo}).`);
        return;
      }
      if (usedChildIds.has(childNo)) {
        setError(`Duplicate child job card number '${childNo}'. Each child job card must have a unique ID.`);
        return;
      }
      usedChildIds.add(childNo);

      if (isNaN(numQty) || numQty <= 0) {
        setError(`Child Job #${i + 1} (${childNo}) must have a positive quantity (> 0).`);
        return;
      }
      childSplitsInput.push({ childJobCardNo: childNo, quantity: numQty });
    }

    if (isOverAllocated) {
      setError(`Total allocated quantity (${roundedTotal} ${unitLabel}) exceeds parent available quantity (${roundedParentQty} ${unitLabel}).`);
      return;
    }

    setLoading(true);

    try {
      if (!retryOperationIdRef.current) {
        retryOperationIdRef.current =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? `op-split-${crypto.randomUUID()}`
            : `op-split-${Date.now()}`;
      }
      const operationId = retryOperationIdRef.current;
      const headers = await DBService.getAuthHeaders();
      const res = await fetch(`${getApiBaseUrl()}/api/job-card/split`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parentJobCardNo: parentJobNo,
          childSplits: childSplitsInput,
          operationId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Split failed (status ${res.status}). Direct client fallback is disabled.`);
      }
      setSuccessMsg(`Successfully split ${parentJobNo} into ${childSplitsInput.map(c => c.childJobCardNo).join(', ')}.`);
      if (onSuccess) onSuccess(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to execute job card split.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        >
          {/* Modal Header */}
          <div className="px-6 py-4 bg-gradient-to-r from-indigo-700 to-indigo-800 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600/50 rounded-lg">
                <GitBranch className="w-5 h-5 text-indigo-100" />
              </div>
              <div>
                <h3 className="text-lg font-bold">Split Job Card</h3>
                <p className="text-xs text-indigo-200">Parent: <span className="font-semibold text-white">{parentJobNo}</span> ({currentQty} {unitLabel})</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-indigo-200 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700 text-xs font-medium">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-700 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Parent Qty Conservation Summary */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center text-xs">
              <div>
                <span className="text-slate-500">Available Parent Qty:</span>
                <span className="ml-1 font-bold text-slate-800">{roundedParentQty} {unitLabel}</span>
              </div>
              <div>
                <span className="text-slate-500">Allocated:</span>
                <span className={`ml-1 font-bold ${isOverAllocated ? 'text-red-600' : 'text-indigo-600'}`}>
                  {roundedTotal} {unitLabel}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Remaining:</span>
                <span className="ml-1 font-bold text-emerald-600">{remainingQty} {unitLabel}</span>
              </div>
            </div>

            {/* Child Splits Inputs */}
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Child Job Cards & Split Quantities
              </label>

              {splits.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={s.childJobCardNo}
                      onChange={(e) => handleSplitChange(idx, 'childJobCardNo', e.target.value)}
                      placeholder="Child Job Card #"
                      className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase"
                      required
                    />
                  </div>
                  <div className="w-32">
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      value={s.quantity}
                      onChange={(e) => handleSplitChange(idx, 'quantity', e.target.value)}
                      placeholder={`Qty (${unitLabel})`}
                      className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    />
                  </div>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSplit(idx)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove Child Split"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddSplit}
              className="w-full py-2 border-2 border-dashed border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Another Child Split</span>
            </button>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || isOverAllocated || Boolean(successMsg)}
                className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-md transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <span>Splitting...</span>
                ) : (
                  <>
                    <GitBranch className="w-4 h-4" />
                    <span>Confirm Split</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
