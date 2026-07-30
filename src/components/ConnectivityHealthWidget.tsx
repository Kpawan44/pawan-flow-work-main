import React from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip 
} from 'recharts';
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ExternalLink,
  ShieldCheck,
  Clock
} from 'lucide-react';
import { SyncQueueItem } from '../types';

interface ConnectivityHealthWidgetProps {
  isOnline: boolean;
  syncQueue: SyncQueueItem[];
  onOpenSyncDrawer: () => void;
  onRetryAllSyncs: () => void;
}

export const ConnectivityHealthWidget: React.FC<ConnectivityHealthWidgetProps> = ({
  isOnline,
  syncQueue,
  onOpenSyncDrawer,
  onRetryAllSyncs,
}) => {
  const pendingCount = syncQueue.filter(item => item.status === 'pending').length;
  const failedCount = syncQueue.filter(item => item.status === 'failed').length;
  const syncedCount = syncQueue.filter(item => item.status === 'synced').length;
  const totalQueue = syncQueue.length;

  // Calculate health percentage:
  // If no items ever queued, or all queued items are synced, health = 100%.
  // If there are queue items, health = (syncedCount / totalQueue) * 100,
  // or adjusted based on pending (partial penalty) and failed (full penalty).
  let healthPercentage = 100;
  if (totalQueue > 0) {
    const unhealthScore = (pendingCount * 0.5 + failedCount * 1) / totalQueue;
    healthPercentage = Math.max(0, Math.round((1 - unhealthScore) * 100));
  } else if (!isOnline) {
    healthPercentage = 85; // Offline with clean queue
  }

  // Determine status color and label based on health & online state
  const getStatusDetails = () => {
    if (failedCount > 0) {
      return {
        label: 'Sync Errors',
        badgeBg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/50',
        gaugeColor: '#EF4444',
        accentText: 'text-rose-600 dark:text-rose-400'
      };
    }
    if (pendingCount > 0) {
      return {
        label: 'Sync Pending',
        badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/50',
        gaugeColor: '#F59E0B',
        accentText: 'text-amber-600 dark:text-amber-400'
      };
    }
    if (!isOnline) {
      return {
        label: 'Offline Ready',
        badgeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/50',
        gaugeColor: '#3B82F6',
        accentText: 'text-blue-600 dark:text-blue-400'
      };
    }
    return {
      label: 'Optimal',
      badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50',
      gaugeColor: '#10B981',
      accentText: 'text-emerald-600 dark:text-emerald-400'
    };
  };

  const statusDetails = getStatusDetails();

  // Recharts Gauge / Pie Data
  // We build a half-donut gauge (startAngle=180, endAngle=0)
  const chartData = totalQueue === 0 
    ? [
        { name: 'Healthy', value: 100, color: statusDetails.gaugeColor },
      ]
    : [
        { name: 'Synced', value: Math.max(syncedCount, 0), color: '#10B981' },
        { name: 'Pending', value: Math.max(pendingCount, 0), color: '#F59E0B' },
        { name: 'Failed', value: Math.max(failedCount, 0), color: '#EF4444' },
      ].filter(d => d.value > 0);

  // Fallback if all values are 0 in queue
  const finalChartData = chartData.length > 0 ? chartData : [{ name: 'Synced', value: 1, color: '#10B981' }];

  return (
    <div 
      id="connectivity-health-widget"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs hover:shadow-sm transition-all duration-300 flex flex-col justify-between"
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-xl ${isOnline ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600' : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600'}`}>
            {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4 animate-pulse" />}
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-1.5">
              Connectivity Health
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${statusDetails.badgeBg}`}>
                {statusDetails.label}
              </span>
            </h4>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
              {isOnline ? 'Cloud Synced & Live' : 'Operating in Local Cache Mode'}
            </p>
          </div>
        </div>

        <button
          onClick={onOpenSyncDrawer}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          title="Open Sync Queue Inspector"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {/* Center Layout: Gauge Chart & Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center my-1">
        {/* Recharts Semi-Donut Gauge Chart */}
        <div className="sm:col-span-5 relative flex flex-col items-center justify-center h-28 sm:h-32">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <Pie
                data={finalChartData}
                cx="50%"
                cy="80%"
                startAngle={180}
                endAngle={0}
                innerRadius={45}
                outerRadius={65}
                paddingAngle={finalChartData.length > 1 ? 3 : 0}
                dataKey="value"
                stroke="none"
              >
                {finalChartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(val: number) => [`${val} items`, 'Count']}
                contentStyle={{ 
                  backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                  borderColor: 'rgba(51, 65, 85, 0.5)',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                  color: '#F8FAFC'
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Centered Overlay inside Half-Gauge */}
          <div className="absolute bottom-2 text-center pointer-events-none flex flex-col items-center">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${statusDetails.accentText}`}>
              {healthPercentage}%
            </span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider -mt-1">
              Sync Rating
            </span>
          </div>
        </div>

        {/* Right Info & Status Breakdown */}
        <div className="sm:col-span-7 flex flex-col justify-center space-y-2.5 pl-0 sm:pl-2">
          {/* Status Breakdown Chips */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-slate-50 dark:bg-slate-850/60 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 font-semibold mb-0.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                <span>Synced</span>
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono">
                {syncedCount}
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-850/60 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 font-semibold mb-0.5">
                <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                <span>Pending</span>
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono">
                {pendingCount}
              </span>
            </div>

            <div className="bg-slate-50 dark:bg-slate-850/60 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-500 font-semibold mb-0.5">
                <XCircle className="h-3 w-3 text-rose-500 shrink-0" />
                <span>Failed</span>
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100 font-mono">
                {failedCount}
              </span>
            </div>
          </div>

          {/* Descriptive Status Message */}
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium leading-tight">
            {pendingCount === 0 && failedCount === 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                All local entries fully synchronized to Firebase cloud database.
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {pendingCount + failedCount} item(s) pending background synchronization.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Footer Actions */}
      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
        <button
          onClick={onOpenSyncDrawer}
          className="text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold flex items-center gap-1 transition cursor-pointer"
        >
          <span>Inspect Sync Queue ({totalQueue})</span>
        </button>

        <button
          onClick={onRetryAllSyncs}
          disabled={pendingCount === 0 && failedCount === 0}
          className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition text-[10.5px] cursor-pointer ${
            pendingCount === 0 && failedCount === 0
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
          }`}
        >
          <RefreshCw className={`h-3 w-3 ${pendingCount > 0 ? 'animate-spin' : ''}`} />
          <span>Sync Now</span>
        </button>
      </div>
    </div>
  );
};

export default ConnectivityHealthWidget;
