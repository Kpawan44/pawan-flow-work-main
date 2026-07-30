import React from 'react';
import { 
  Check, 
  MapPin, 
  TrendingUp, 
  ArrowRight,
  Flame,
  Truck,
  Sparkles,
  PackageCheck,
  Warehouse,
  Factory
} from 'lucide-react';
import { JobCard, MaterialMovement, Department } from '../types';

interface TimelineVisualProps {
  jobCard: JobCard;
  movements: MaterialMovement[];
}

export default function TimelineVisual({ jobCard, movements }: TimelineVisualProps) {
  // Define the ordered steps of the manufacturing layout
  const steps: { key: string; label: string; icon: any; desc: string }[] = [
    { key: 'Dispatch-Init', label: 'Order Created', icon: Truck, desc: 'Dispatch books raw order' },
    { key: 'Production', label: 'Production Milling', icon: Factory, desc: 'Machining and sizing' },
    { key: 'Heat Treatment', label: 'Heat Treatment', icon: Flame, desc: 'Hardening & quenching' },
    { key: 'Plating', label: 'Surface Plating', icon: Sparkles, desc: 'Anti-rust zinc coating' },
    { key: 'Packing', label: 'Industrial Packing', icon: PackageCheck, desc: 'Weight check & boxing' },
    { key: 'Store', label: 'Warehouse Ingestion', icon: Warehouse, desc: 'Stock update & bin loc' },
    { key: 'Completed', label: 'Dispatch Shipped', icon: Check, desc: 'Final audit & customer delivery' }
  ];

  // Helper to trace and format movement history details for a target phase
  const getPhaseDetails = (phase: string) => {
    if (phase === 'Dispatch-Init') {
      return {
        completed: true,
        operator: jobCard.createdBy,
        date: jobCard.createdAt,
        info: `HT Spec: ${jobCard.heatTreatmentRequired ? 'YES (Required)' : 'NO (Skip Direct to Plating)'}`,
        type: 'initial'
      };
    }

    // Is it Heat Treatment and marked as not required?
    if (phase === 'Heat Treatment' && !jobCard.heatTreatmentRequired && jobCard.processType !== 'Purchase') {
      return {
        completed: true,
        skipped: true,
        operator: 'System',
        date: null,
        info: 'Bypassed by order spec',
        type: 'skipped'
      };
    }

    // Find the movement that ended inside this department
    const incomingMov = movements.find(m => m.toDepartment === phase && m.accepted);
    const pendingMov = movements.find(m => m.toDepartment === phase && !m.accepted);

    const deptOrder = ['Production', 'Heat Treatment', 'Plating', 'Packing', 'Store', 'Dispatch', 'Completed'];

    // Dynamic bypass logic for Purchase process
    if (jobCard.processType === 'Purchase') {
      if (phase === 'Production') {
        return {
          completed: true,
          skipped: true,
          operator: 'System',
          date: null,
          info: 'Bypassed (Purchased)',
          type: 'skipped'
        };
      }
      
      const currentDeptIdx = deptOrder.indexOf(jobCard.completed ? 'Completed' : jobCard.currentDepartment);
      const phaseIdx = deptOrder.indexOf(phase);
      
      if (phaseIdx !== -1 && currentDeptIdx > phaseIdx && !incomingMov && !pendingMov) {
        return {
          completed: true,
          skipped: true,
          operator: 'System',
          date: null,
          info: 'Bypassed (Direct)',
          type: 'skipped'
        };
      }
    }

    if (incomingMov) {
      let extraInfo = '';
      if (phase === 'Plating' && jobCard.platingDetails) {
        extraInfo = `Plating: ${jobCard.platingDetails.platingType || 'Std'}, Thickness: ${jobCard.platingDetails.micronThickness || '8'}μm`;
      } else if (phase === 'Packing' && jobCard.packingDetails) {
        extraInfo = `Qty: ${jobCard.packingDetails.packedQty || incomingMov.quantity} KG, Boxes: ${jobCard.packingDetails.boxCount || 1}`;
      } else if (phase === 'Store' && jobCard.storeDetails) {
        extraInfo = `Verify: ${jobCard.storeDetails.verifiedQty || incomingMov.quantity} KG, Bin: ${jobCard.storeDetails.locationBin || '-'}`;
      } else if (phase === 'Production' && jobCard.operatorName) {
        extraInfo = `Ops: ${jobCard.operatorName}`;
      } else if (phase === 'Heat Treatment' && jobCard.heatTreatmentDetails) {
        extraInfo = `Hardness: ${jobCard.heatTreatmentDetails.hardnessRequired || 'HRC 32-38'}`;
      }

      return {
        completed: true,
        operator: incomingMov.acceptedBy || incomingMov.transferBy,
        date: incomingMov.acceptedDate || incomingMov.transferDate,
        info: extraInfo || `Accepted ${incomingMov.quantity} KG`,
        type: 'completed'
      };
    }

    if (pendingMov) {
      return {
        completed: false,
        pending: true,
        operator: pendingMov.transferBy,
        date: pendingMov.transferDate,
        info: `In transit: ${pendingMov.quantity} KG`,
        type: 'transit'
      };
    }

    // Is it currently sitting here?
    const isCurrentlyHere = jobCard.currentDepartment === phase;
    if (isCurrentlyHere && !jobCard.completed) {
      return {
        completed: false,
        active: true,
        operator: null,
        date: null,
        info: `Processing... (${jobCard.status})`,
        type: 'processing'
      };
    }

    // For final step
    if (phase === 'Completed' && jobCard.completed) {
      return {
        completed: true,
        operator: jobCard.dispatchDetails?.vehicleNo ? 'Invoiced Dispatch' : 'System',
        date: jobCard.dispatchDetails?.dispatchDate || jobCard.createdAt,
        info: `Invoice: ${jobCard.dispatchDetails?.invoiceNo || 'INV-Done'}, Vehicle: ${jobCard.dispatchDetails?.vehicleNo || 'N/A'}`,
        type: 'completed'
      };
    }

    return {
      completed: false,
      notStarted: true,
      operator: null,
      date: null,
      info: 'Queue pending',
      type: 'waiting'
    };
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-900/60 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-500" />
            <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wider">
              Material Traceability Tracker
            </h4>
          </div>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 mt-1 flex items-center gap-2 flex-wrap">
            <span>Item: {jobCard.itemName}</span>
            <span className="font-mono text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded">
              Item Code: {jobCard.itemCode || '-'}
            </span>
            {jobCard.partyName && <span className="text-[11px] text-slate-400 font-normal">({jobCard.partyName})</span>}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[10px] bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-mono font-bold uppercase py-1 px-2.5 rounded-full shrink-0 self-start sm:self-auto">
          Ref: {jobCard.jobCardNo}
        </div>
      </div>

      {/* Horizontal / Vertical Timeline Flow */}
      <div className="flex flex-col lg:flex-row items-stretch justify-between gap-6 relative">
        {steps.map((step, idx) => {
          const detail = getPhaseDetails(step.key);
          const IconComp = step.icon;

          // Compute circle classes depending on stage state
          let circleBg = 'bg-slate-200 dark:bg-slate-800 text-slate-400 border-2 border-slate-300 dark:border-slate-700';
          let textColor = 'text-slate-500 dark:text-slate-400';
          let borderConnector = 'bg-slate-200 dark:bg-slate-800';

          if (detail.active) {
            circleBg = 'bg-indigo-600 text-white ring-4 ring-indigo-100 dark:ring-indigo-950 border-2 border-indigo-700 animate-pulse';
            textColor = 'text-indigo-600 dark:text-indigo-400 font-semibold';
          } else if (detail.pending) {
            circleBg = 'bg-purple-500 text-white ring-4 ring-purple-100 dark:ring-purple-950 border-2 border-purple-600';
            textColor = 'text-purple-600 dark:text-purple-400 font-medium';
          } else if (detail.skipped) {
            circleBg = 'bg-slate-100 dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-400';
            textColor = 'text-slate-400 dark:text-slate-500 line-through';
          } else if (detail.completed) {
            circleBg = 'bg-emerald-500 text-white border-2 border-emerald-600';
            textColor = 'text-slate-800 dark:text-slate-200';
            borderConnector = 'bg-emerald-500';
          }

          const hasNext = idx < steps.length - 1;

          return (
            <div key={step.key} className="flex-1 flex flex-row lg:flex-col items-start lg:items-center relative z-10">
              {/* Connector line behind circles (horizontal desktop, vertical mobile) */}
              {hasNext && (
                <div className="absolute left-[18px] top-9 bottom-0 w-0.5 lg:-bottom-auto lg:top-[18px] lg:left-1/2 lg:right-[-50%] lg:h-0.5 lg:w-full z-[-1] pointer-events-none transition-all duration-300">
                  <div className={`h-full w-full ${borderConnector}`} />
                </div>
              )}

              {/* Step Circle with Icon */}
              <div className="flex items-center justify-center shrink-0">
                <div className={`h-9 w-9 rounded-full flex items-center justify-center transition-colors duration-300 ${circleBg}`}>
                  {detail.completed && !detail.skipped ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <IconComp className="h-4 w-4" />
                  )}
                </div>
              </div>

              {/* Text content details */}
              <div className="ml-4 lg:ml-0 lg:mt-3 flex-1 lg:text-center">
                <h5 className={`text-xs font-bold leading-tight ${textColor}`}>
                  {step.label}
                </h5>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-medium leading-tight">
                  {step.desc}
                </p>
                
                {/* Specific movement metadata values */}
                <div className="mt-1.5 min-h-[30px] flex flex-col lg:items-center">
                  {detail.info && (
                    <span className="inline-block text-[9px] font-mono bg-white dark:bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 max-w-full lg:max-w-[130px] truncate leading-tight">
                      {detail.info}
                    </span>
                  )}
                  {detail.operator && (
                    <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mt-1">
                      By: {detail.operator}
                    </span>
                  )}
                  {detail.date && (
                    <span className="text-[8px] font-mono text-slate-400 dark:text-slate-500">
                      {new Date(detail.date).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
