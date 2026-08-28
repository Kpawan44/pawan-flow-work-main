import React from 'react';
import { AlertTriangle, RefreshCw, Check, X, User, Clock } from 'lucide-react';
import { JobCard } from '../types';

export interface ConcurrencyConflictData {
  isOpen: boolean;
  jobCardNo: string;
  expectedVersion?: number;
  attemptedUpdates: Partial<JobCard>;
  currentData?: JobCard;
  onResolveReload: () => void;
  onResolveOverwrite: () => void;
  onClose: () => void;
}

export const ConcurrencyConflictModal: React.FC<ConcurrencyConflictData> = ({
  isOpen,
  jobCardNo,
  expectedVersion,
  attemptedUpdates,
  currentData,
  onResolveReload,
  onResolveOverwrite,
  onClose
}) => {
  if (!isOpen) return null;

  // Extract fields that differ between attemptedUpdates and currentData
  const conflictingFields: { field: string; yourValue: any; serverValue: any }[] = [];

  const fieldLabels: Record<string, string> = {
    orderQty: 'Order Quantity',
    currentQty: 'Current Quantity',
    balanceQty: 'Balance Quantity',
    status: 'Status',
    currentDepartment: 'Current Department',
    partyName: 'Party / Customer Name',
    itemName: 'Item Description',
    itemCode: 'Item Code',
    priority: 'Priority',
    heatTreatmentRequired: 'Heat Treatment Required',
    deliveryDate: 'Delivery Date',
    targetDate: 'Target Date',
    processType: 'Process Type',
    customRoutedToPlating: 'Routed to Plating',
    customRoutedToPacking: 'Routed to Packing',
    customRoutedToStore: 'Routed to Store'
  };

  for (const [key, yourVal] of Object.entries(attemptedUpdates)) {
    if (key === 'version' || key === 'updatedAt' || key === 'updatedBy') continue;
    const serverVal = currentData ? (currentData as any)[key] : undefined;
    if (yourVal !== undefined && yourVal !== serverVal) {
      conflictingFields.push({
        field: fieldLabels[key] || key,
        yourValue: typeof yourVal === 'boolean' ? (yourVal ? 'Yes' : 'No') : String(yourVal ?? '—'),
        serverValue: typeof serverVal === 'boolean' ? (serverVal ? 'Yes' : 'No') : String(serverVal ?? '—')
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/75 backdrop-blur-xs animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/30 p-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                Edit Conflict Detected
              </h3>
              <p className="text-xs text-amber-800 dark:text-amber-300 font-semibold mt-0.5">
                Record was updated by another user
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-amber-100/50 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-350 font-mono text-[11px]">
              <span className="font-bold text-blue-600 dark:text-blue-400">Job Card: {jobCardNo}</span>
              <span className="bg-slate-200 dark:bg-slate-750 px-2 py-0.5 rounded text-[10px]">
                Server Version: v{currentData?.version || 1}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-slate-500 dark:text-slate-400 pt-1">
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-450" />
                <span>Last updated by: <strong>{currentData?.updatedBy || 'Another crew member'}</strong></span>
              </div>
              {currentData?.updatedAt && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-slate-450" />
                  <span>{new Date(currentData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
            </div>
          </div>

          <p className="text-slate-600 dark:text-slate-350 leading-relaxed">
            Another user saved modifications to this Job Card while you were editing. Below is a comparison of your unsaved edits versus the latest database values:
          </p>

          {/* Conflict Comparison Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-750">
                  <th className="py-2.5 px-3">Field</th>
                  <th className="py-2.5 px-3 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400">Your Edit</th>
                  <th className="py-2.5 px-3 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400">Database Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-800">
                {conflictingFields.length > 0 ? (
                  conflictingFields.map((cf, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/60">
                      <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">{cf.field}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-700 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/10">
                        {cf.yourValue}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-700 dark:text-blue-400 bg-blue-50/30 dark:bg-blue-950/10">
                        {cf.serverValue}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-3 px-3 text-center text-slate-400">
                      Record version has advanced. Please reload to see latest department state.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onResolveReload}
            className="w-full sm:w-auto px-4 py-2.5 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Reload Latest Data (Recommended)</span>
          </button>

          <button
            type="button"
            onClick={onResolveOverwrite}
            className="w-full sm:w-auto px-4 py-2.5 min-h-[48px] rounded-xl bg-slate-200 dark:bg-slate-750 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Apply My Edits Overwrite</span>
          </button>
        </div>

      </div>
    </div>
  );
};
