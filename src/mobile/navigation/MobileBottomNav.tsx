import React from 'react';
import { motion } from 'motion/react';
import { 
  Factory, 
  FileText, 
  QrCode, 
  Layers, 
  Menu
} from 'lucide-react';
import { UserProfile } from '../../types';

export type MobileTab = 'dashboard' | 'all-orders' | 'scan' | 'reports' | 'more';

interface MobileBottomNavProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenScanner: () => void;
  onOpenMoreMenu: () => void;
  currentUser: UserProfile;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  onOpenScanner,
  onOpenMoreMenu,
  currentUser
}) => {
  const isAdminOrSuperAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
  const isSupervisor = currentUser.role === 'supervisor';
  // Check if user has permission to view reports
  const canViewReports = isAdminOrSuperAdmin || isSupervisor || currentUser.department === 'Admin' || currentUser.department === 'Dispatch';

  const isHomeActive = activeTab === 'dashboard';
  const isOrdersActive = activeTab === 'all-orders';
  const isReportsActive = activeTab === 'reports';
  const isMoreActive = activeTab === 'outsource' || activeTab === 'timeline-live' || activeTab === 'admin-users' || activeTab === 'more';

  return (
    <nav 
      aria-label="Mobile Navigation Bar"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 flex items-center justify-around select-none print:hidden px-2 pt-1 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_25px_rgba(0,0,0,0.5)]"
    >
      {/* 1. Home / Station Queue */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => onSelectTab('dashboard')}
        className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-2xl transition-all cursor-pointer min-w-[56px] min-h-[48px] ${
          isHomeActive 
            ? 'text-[#3B82F6] font-bold' 
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
        }`}
        aria-label="Home Station Queue"
      >
        {isHomeActive && (
          <motion.div
            layoutId="activeBottomPill"
            className="absolute inset-0 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
          />
        )}
        <Factory className={`h-5 w-5 transition-transform duration-150 ${isHomeActive ? 'scale-110 text-[#3B82F6]' : ''}`} />
        <span className="text-[10px] tracking-tight">Home</span>
      </motion.button>

      {/* 2. Operations / Orders */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => onSelectTab('all-orders')}
        className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-2xl transition-all cursor-pointer min-w-[56px] min-h-[48px] ${
          isOrdersActive 
            ? 'text-[#3B82F6] font-bold' 
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
        }`}
        aria-label="Manufacturing Orders"
      >
        {isOrdersActive && (
          <motion.div
            layoutId="activeBottomPill"
            className="absolute inset-0 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
          />
        )}
        <FileText className={`h-5 w-5 transition-transform duration-150 ${isOrdersActive ? 'scale-110 text-[#3B82F6]' : ''}`} />
        <span className="text-[10px] tracking-tight">Job Cards</span>
      </motion.button>

      {/* 3. Center Scanner Button (Prominent Action Target) */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={onOpenScanner}
        className="relative -top-2 flex flex-col items-center justify-center gap-0.5 p-2 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white shadow-lg shadow-blue-500/30 border-2 border-white dark:border-slate-900 cursor-pointer min-w-[52px] min-h-[52px] active:scale-95 transition-transform"
        aria-label="Open Hardware Barcode Scanner"
      >
        <QrCode className="h-6 w-6 stroke-[2.2]" />
        <span className="text-[9px] font-extrabold uppercase tracking-wider text-blue-100">Scan</span>
      </motion.button>

      {/* 4. Reports & Analytics */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => onSelectTab('reports')}
        className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-2xl transition-all cursor-pointer min-w-[56px] min-h-[48px] ${
          isReportsActive 
            ? 'text-[#3B82F6] font-bold' 
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
        }`}
        aria-label="Reports and Analytics"
      >
        {isReportsActive && (
          <motion.div
            layoutId="activeBottomPill"
            className="absolute inset-0 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
          />
        )}
        <Layers className={`h-5 w-5 transition-transform duration-150 ${isReportsActive ? 'scale-110 text-[#3B82F6]' : ''}`} />
        <span className="text-[10px] tracking-tight">Reports</span>
      </motion.button>

      {/* 5. More / Station Hub */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={onOpenMoreMenu}
        className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-2xl transition-all cursor-pointer min-w-[56px] min-h-[48px] ${
          isMoreActive 
            ? 'text-[#3B82F6] font-bold' 
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
        }`}
        aria-label="More Features and Settings"
      >
        {isMoreActive && (
          <motion.div
            layoutId="activeBottomPill"
            className="absolute inset-0 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
          />
        )}
        <Menu className={`h-5 w-5 transition-transform duration-150 ${isMoreActive ? 'scale-110 text-[#3B82F6]' : ''}`} />
        <span className="text-[10px] tracking-tight">More</span>
      </motion.button>
    </nav>
  );
};

export default MobileBottomNav;
