import React from 'react';
import { 
  FileText, 
  RefreshCw, 
  CheckCircle2, 
  Scale, 
  TrendingUp, 
  AlertTriangle,
  PackageCheck,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { JobCard, MaterialMovement, Department, ProcessTransfer } from '../types';

interface DashboardStatsProps {
  department: Department | 'Admin';
  jobCards: JobCard[];
  movements: MaterialMovement[];
  processTransfers?: ProcessTransfer[];
}

export default function DashboardStats({ department, jobCards, movements, processTransfers = [] }: DashboardStatsProps) {
  // Filter job cards belonging to this department
  const isAll = department === 'Admin';
  
  const deptJobs = jobCards.filter(card => {
    if (isAll) return true;
    return card.currentDepartment === department;
  });

  const pendingCount = deptJobs.filter(j => j.status === 'Pending' || j.status === 'Pending Acceptance').length;
  const inProcessCount = deptJobs.filter(j => j.status === 'In Process' || j.status === 'Rejected').length;
  const completedCount = isAll 
    ? jobCards.filter(j => j.completed).length 
    : jobCards.filter(j => j.completed && j.currentDepartment === 'Completed').length; // Adjust logic for completed count

  // Process transfer active counts
  const activeRepackingCount = processTransfers.filter(t => t.toProcess === 'Repacking' && t.status !== 'Returned to Store').length;
  const activeReplatingCount = processTransfers.filter(t => t.toProcess === 'Replating' && t.status !== 'Returned to Store').length;
  const totalActiveProcessTransfers = activeRepackingCount + activeReplatingCount;

  // Calculated Outstanding Balance Weight (In KG)
  // Formula: Sum of Balance quantity of active job cards in this department
  const activeBalanceQty = deptJobs.reduce((acc, j) => {
    if (!j.completed) {
      return acc + (j.balanceQty || 0);
    }
    return acc;
  }, 0);

  // Today's movements transferred out of this department
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  
  const todaysTransfersQty = movements.reduce((acc, m) => {
    const mDate = new Date(m.transferDate);
    const isToday = mDate >= todayStart;
    const isFromThisDept = isAll || m.fromDepartment === department;
    
    if (isToday && isFromThisDept) {
      return acc + m.quantity;
    }
    return acc;
  }, 0);

  // Display configurations
  const statsConfig = [
    {
      id: 'pending',
      title: 'Pending / Unaccepted',
      value: pendingCount,
      subtitle: isAll ? 'Across all lines' : `Awaiting action in ${department}`,
      icon: AlertTriangle,
      color: 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border border-amber-100 dark:border-amber-900/30'
    },
    {
      id: 'in-process',
      title: 'Active In-Process',
      value: inProcessCount,
      subtitle: isAll ? 'In operation right now' : `Currently processing`,
      icon: RefreshCw,
      color: 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 border border-blue-100 dark:border-blue-900/30'
    },
    {
      id: 'completed',
      title: isAll ? 'Fully Archived' : 'Delivered / Closed',
      value: completedCount,
      subtitle: isAll ? 'Shipped to clients' : `Transferred to downstream`,
      icon: CheckCircle2,
      color: 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border border-emerald-100 dark:border-emerald-900/30'
    },
    {
      id: 'balance-qty',
      title: 'Current Dept Weight',
      value: `${activeBalanceQty.toLocaleString()} KG`,
      subtitle: 'Outstanding balance mass',
      icon: Scale,
      color: 'bg-indigo-50 dark:bg-slate-900/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-slate-800'
    },
    {
      id: 'today-exports',
      title: "Today's Dispatched",
      value: `${todaysTransfersQty.toLocaleString()} KG`,
      subtitle: 'Quantity moved today',
      icon: TrendingUp,
      color: 'bg-rose-50 dark:bg-slate-900/50 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-slate-800'
    }
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4">
        {statsConfig.map((stat) => {
          const IconComponent = stat.icon;
          return (
            <div 
              key={stat.id}
              id={`kpi-card-${stat.id}`}
              className={`p-3 sm:p-5 rounded-xl shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between ${stat.color} ${
                stat.id === 'today-exports' ? 'col-span-2 sm:col-span-1' : ''
              }`}
            >
              <div className="flex items-center justify-between pointer-events-none">
                <span className="text-[9px] sm:text-[11px] font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 truncate">
                  {stat.title}
                </span>
                <IconComponent className="h-4 w-4 sm:h-5 sm:w-5 opacity-75 shrink-0" />
              </div>
              
              <div className="mt-2 sm:mt-3">
                <h3 className="text-base sm:text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100 truncate">
                  {stat.value}
                </h3>
                <p className="text-[8px] sm:text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 sm:mt-1 uppercase font-semibold truncate">
                  {stat.subtitle}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Internal Process Transfers Quick Bar (Repacking & Replating) */}
      {totalActiveProcessTransfers > 0 && (department === 'Admin' || department === 'Store' || department === 'Packing' || department === 'Plating') && (
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 shadow-xs text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200 font-mono">
            <RotateCcw className="h-4 w-4 text-emerald-600 animate-spin-slow" />
            <span>Store Process In-Flight:</span>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            {activeRepackingCount > 0 && (
              <span className="px-2.5 py-1 bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300 border border-pink-200 dark:border-pink-900/40 rounded-lg font-bold flex items-center gap-1.5">
                <PackageCheck className="h-3.5 w-3.5" />
                <span>Repacking: {activeRepackingCount} {activeRepackingCount === 1 ? 'batch' : 'batches'}</span>
              </span>
            )}

            {activeReplatingCount > 0 && (
              <span className="px-2.5 py-1 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-900/40 rounded-lg font-bold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Replating: {activeReplatingCount} {activeReplatingCount === 1 ? 'batch' : 'batches'}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

