import React, { useState, useMemo } from 'react';
import { 
  Factory, 
  Warehouse, 
  Flame, 
  Sparkles, 
  Box, 
  Truck, 
  ShoppingCart, 
  Layers, 
  Clock, 
  CheckCircle2, 
  ChevronRight,
  QrCode,
  AlertTriangle,
  Plus
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile, Department } from '../../types';
import MobileCard from '../shared/MobileCard';
import MobileDepartmentQueueScreen from './MobileDepartmentQueueScreen';
import MobileJobCardDetailScreen from './MobileJobCardDetailScreen';
import MobileJobCardCreateScreen from './MobileJobCardCreateScreen';

interface MobileOperationsHubProps {
  currentUser?: UserProfile | null;
  jobCards?: JobCard[];
  movements?: MaterialMovement[];
  onAcceptMovement?: (movementId: string, remarks?: string) => Promise<void> | any;
  onSelectJobCard?: (jobCardNo: string) => void;
  onQuickTransfer?: (jobCard: JobCard) => void;
  onOpenScanner?: () => void;
  onCreateJobCard?: (jobData: any, initialMovementOverride?: any) => Promise<void> | void;
  onSubmitTransfer?: (movements: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
  }[]) => Promise<void> | void;
  isOnline?: boolean;
}

const ALL_MANUFACTURING_STATIONS: { dept: Department; label: string; icon: any; color: string }[] = [
  { dept: 'Purchase', label: 'Purchase Inward', icon: ShoppingCart, color: 'text-teal-600 bg-teal-500/10' },
  { dept: 'Raw Material Store', label: 'Raw Material Store', icon: Warehouse, color: 'text-blue-600 bg-blue-500/10' },
  { dept: 'Production', label: 'Production (Heading/Forging)', icon: Factory, color: 'text-cyan-600 bg-cyan-500/10' },
  { dept: 'Heat Treatment', label: 'Heat Treatment Furnace', icon: Flame, color: 'text-rose-600 bg-rose-500/10' },
  { dept: 'Plating', label: 'Plating & Surface Coating', icon: Sparkles, color: 'text-pink-600 bg-pink-500/10' },
  { dept: 'Packing', label: 'Packing & Carton Box', icon: Box, color: 'text-violet-600 bg-violet-500/10' },
  { dept: 'Store', label: 'Finished Goods Store', icon: Warehouse, color: 'text-emerald-600 bg-emerald-500/10' },
  { dept: 'Dispatch', label: 'Customer Dispatch Cargo', icon: Truck, color: 'text-amber-600 bg-amber-500/10' }
];

export const MobileOperationsHub: React.FC<MobileOperationsHubProps> = ({
  currentUser,
  jobCards = [],
  movements = [],
  onAcceptMovement = () => {},
  onSelectJobCard,
  onQuickTransfer,
  onOpenScanner,
  onCreateJobCard,
  onSubmitTransfer,
  isOnline = true
}) => {
  const [selectedStation, setSelectedStation] = useState<Department | null>(null);
  const [activeJobCardNo, setActiveJobCardNo] = useState<string | null>(null);
  const [isCreatingJobCard, setIsCreatingJobCard] = useState(false);

  // Filter accessible stations based on RBAC rules
  const permittedStations = useMemo(() => {
    if (!currentUser) return ALL_MANUFACTURING_STATIONS;
    const isSuper = currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.department === 'Admin';
    if (isSuper) {
      return ALL_MANUFACTURING_STATIONS;
    }

    const allowedDepts = new Set<string>();
    if (currentUser.department) {
      allowedDepts.add(String(currentUser.department).toLowerCase());
    }
    if (Array.isArray(currentUser.allowedDepartments)) {
      currentUser.allowedDepartments.forEach(d => {
        if (d) allowedDepts.add(String(d).toLowerCase());
      });
    }
    if (Array.isArray(currentUser.accessList)) {
      currentUser.accessList.forEach(d => {
        if (d) allowedDepts.add(String(d).toLowerCase());
      });
    }

    return ALL_MANUFACTURING_STATIONS.filter(s => allowedDepts.has(s.dept.toLowerCase()));
  }, [currentUser]);

  // Selected Job Card Object
  const selectedJobCard = useMemo(() => {
    if (!activeJobCardNo || !Array.isArray(jobCards)) return null;
    const target = activeJobCardNo.toLowerCase();
    return jobCards.find(j => j && String(j.jobCardNo || '').toLowerCase() === target) || null;
  }, [activeJobCardNo, jobCards]);

  // 1. If viewing Job Card Detail Screen
  if (selectedJobCard && currentUser) {
    return (
      <MobileJobCardDetailScreen
        jobCard={selectedJobCard}
        movements={movements}
        currentUser={currentUser}
        onBack={() => setActiveJobCardNo(null)}
        onAcceptMovement={onAcceptMovement}
        onSubmitTransfer={onSubmitTransfer}
      />
    );
  }

  // 2. If viewing Job Card Creation Wizard
  if (isCreatingJobCard && onCreateJobCard && currentUser) {
    return (
      <MobileJobCardCreateScreen
        currentUser={currentUser}
        onBack={() => setIsCreatingJobCard(false)}
        onCreateJobCard={async (jobData, override) => {
          await onCreateJobCard(jobData, override);
          setIsCreatingJobCard(false);
        }}
      />
    );
  }

  // 3. If a station is selected, render the dedicated queue screen
  const activeStation = selectedStation || (permittedStations.length === 1 ? permittedStations[0].dept : null);

  if (activeStation && currentUser) {
    return (
      <MobileDepartmentQueueScreen
        department={activeStation}
        currentUser={currentUser}
        jobCards={jobCards}
        movements={movements}
        onBack={() => setSelectedStation(null)}
        onAcceptMovement={onAcceptMovement}
        onSelectJobCard={(jobNo) => {
          if (onSelectJobCard) onSelectJobCard(jobNo);
          setActiveJobCardNo(jobNo);
        }}
        onQuickTransfer={onQuickTransfer}
        onOpenScanner={onOpenScanner}
        isOnline={isOnline}
      />
    );
  }

  // 4. Operations Overview Grid
  return (
    <div className="space-y-4 pb-8 select-none">
      {/* Header Banner */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">
            Manufacturing Operations
          </h2>
          <p className="text-[11px] text-slate-500 font-mono">
            Select a station to manage Ingress & Active WIP
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {onCreateJobCard && (
            <button
              onClick={() => setIsCreatingJobCard(true)}
              className="p-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 shadow-xs text-xs font-bold transition cursor-pointer"
              title="Create New Job Card"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Job</span>
            </button>
          )}

          {onOpenScanner && (
            <button
              onClick={onOpenScanner}
              className="p-2.5 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white flex items-center gap-1.5 shadow-xs text-xs font-bold transition cursor-pointer"
            >
              <QrCode className="h-4 w-4" />
              <span className="hidden sm:inline">Scan QR</span>
            </button>
          )}
        </div>
      </div>

      {/* Authorized Stations Grid */}
      <div className="grid grid-cols-1 gap-3">
        {permittedStations.map((station) => {
          const Icon = station.icon;
          const deptLower = station.dept.toLowerCase();

          // Ingress pending count
          const pendingCount = (Array.isArray(movements) ? movements : []).filter(
            m => m && String(m.toDepartment || '').toLowerCase() === deptLower && !m.accepted && m.issueStatus !== 'Rejected'
          ).length;

          // Active WIP count & mass
          const stationJobs = (Array.isArray(jobCards) ? jobCards : []).filter(
            j => j && String(j.currentDepartment || '').toLowerCase() === deptLower && j.status !== 'Completed' && j.currentDepartment !== 'Completed'
          );
          const totalWipMass = stationJobs.reduce((sum, j) => sum + (Number(j.orderQty) || 0), 0);

          return (
            <div
              key={station.dept}
              onClick={() => setSelectedStation(station.dept)}
              className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs hover:border-blue-400 dark:hover:border-blue-700 transition cursor-pointer active:scale-[0.99] space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-2xl ${station.color}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
                      {station.label}
                    </h3>
                    <p className="text-[10.5px] text-slate-500 font-mono">
                      {stationJobs.length} Active Batches ({totalWipMass.toLocaleString()} KG)
                    </p>
                  </div>
                </div>

                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>

              {/* Station Queue Status Summary */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] font-mono">
                <div className="flex items-center gap-1.5">
                  <Clock className={`h-3.5 w-3.5 ${pendingCount > 0 ? 'text-amber-500' : 'text-slate-400'}`} />
                  <span className={pendingCount > 0 ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-500'}>
                    {pendingCount} Pending Ingress
                  </span>
                </div>

                <span className="text-[#3B82F6] font-bold flex items-center gap-1">
                  <span>Open Queue</span>
                  <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MobileOperationsHub;
