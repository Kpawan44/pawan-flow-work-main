import React, { useEffect, useState } from 'react';
import { JobCard, MaterialMovement, UserProfile } from '../types';
import {
  canIssueOtherRawMaterialQty,
  displayUnitLabel,
  listIncomingStoreOtherRmCatalog
} from '../hardening/process248OtherRawMaterial';

interface IssueOtherRawMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  currentUser: UserProfile | null;
  onIssue: (payload: {
    jobCardNo: string;
    rawMaterialCode: string;
    rawMaterialName: string;
    quantity: number;
    unit: string;
  }) => Promise<void>;
}

export default function IssueOtherRawMaterialModal({
  isOpen,
  onClose,
  jobCards,
  movements,
  currentUser,
  onIssue
}: IssueOtherRawMaterialModalProps) {
  const [jobCardNo, setJobCardNo] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const catalog = listIncomingStoreOtherRmCatalog(movements);
  const selected = catalog.find((m) => m.code === materialCode) || null;
  const activeJobs = jobCards.filter((jc) => !jc.completed && jc.status !== 'Rejected' && jc.processType !== 'Purchase');

  useEffect(() => {
    if (!isOpen) return;
    setJobCardNo('');
    setMaterialCode('');
    setQuantity(0);
    setError('');
    setBusy(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobCardNo) {
      setError('Select a Job Card.');
      return;
    }
    if (!selected) {
      setError('Select an Other Raw Material. Wire is not issued here.');
      return;
    }
    const gate = canIssueOtherRawMaterialQty(selected.availableStock, quantity, selected.unit);
    if (!gate.ok) {
      setError(gate.error || 'Invalid quantity.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onIssue({
        jobCardNo,
        rawMaterialCode: selected.code,
        rawMaterialName: selected.name,
        quantity,
        unit: selected.unit
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Issue failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
              Issue Other Raw Material
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Incoming Store → Job Card. Optional only. Wire remains on the existing Raw Material Store issue flow.
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">Operator: {currentUser?.name || 'Incoming Store'}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 font-bold cursor-pointer">
            ✕
          </button>
        </div>

        <label className="block text-[10px] font-bold uppercase text-slate-500">
          Job Card
          <select
            value={jobCardNo}
            onChange={(e) => setJobCardNo(e.target.value)}
            className="mt-1 w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs font-semibold"
          >
            <option value="">Select Job Card</option>
            {activeJobs.map((j) => (
              <option key={j.jobCardNo} value={j.jobCardNo}>
                {j.jobCardNo} — {j.itemName} ({j.orderQty} {displayUnitLabel(j.unit)})
              </option>
            ))}
          </select>
        </label>

        <label className="block text-[10px] font-bold uppercase text-slate-500">
          Other Raw Material
          <select
            value={materialCode}
            onChange={(e) => setMaterialCode(e.target.value)}
            className="mt-1 w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs font-semibold"
          >
            <option value="">Select material (optional catalog)</option>
            {catalog.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} ({m.code}) — avail {m.availableStock} {m.unit}
              </option>
            ))}
          </select>
        </label>

        {selected && (
          <p className="text-[11px] font-mono text-indigo-700 dark:text-indigo-300">
            Available: {selected.availableStock} {selected.unit}
          </p>
        )}

        <label className="block text-[10px] font-bold uppercase text-slate-500">
          Quantity
          <input
            type="text"
            inputMode="decimal"
            value={quantity || ''}
            onChange={(e) => setQuantity(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
            placeholder="0"
            className="mt-1 w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs font-mono font-bold"
          />
        </label>
        <p className="text-[10px] text-slate-400">Unit follows the material. PCS is not converted to KG.</p>

        {error && <p className="text-[11px] text-rose-600 font-semibold">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold bg-slate-200 dark:bg-slate-800 cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-2 rounded-lg text-xs font-bold bg-purple-600 text-white disabled:opacity-40 cursor-pointer"
          >
            {busy ? 'Issuing…' : 'Issue'}
          </button>
        </div>
      </form>
    </div>
  );
}
