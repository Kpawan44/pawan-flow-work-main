import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Truck, 
  Activity, 
  ShieldCheck, 
  FileSpreadsheet, 
  Users, 
  LogOut, 
  X, 
  Layers,
  ChevronRight,
  Info
} from 'lucide-react';
import { UserProfile, SyncQueueItem, CompanyConfig } from '../../types';
import MobileTopBar from './MobileTopBar';
import MobileBottomNav from './MobileBottomNav';

interface MobileAppShellProps {
  children: React.ReactNode;
  currentUser: UserProfile;
  availableUsers: UserProfile[];
  onSwitchUser: (userId: string) => void;
  onLogout: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  isOnline: boolean;
  syncQueue: SyncQueueItem[];
  unreadCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenScanner: () => void;
  onOpenNotifications: () => void;
  onOpenSyncDrawer: () => void;
  companyConfig?: CompanyConfig | null;
}

export const MobileAppShell: React.FC<MobileAppShellProps> = ({
  children,
  currentUser,
  availableUsers,
  onSwitchUser,
  onLogout,
  activeTab,
  onSelectTab,
  isOnline,
  syncQueue,
  unreadCount,
  theme,
  onToggleTheme,
  onOpenSearch,
  onOpenScanner,
  onOpenNotifications,
  onOpenSyncDrawer,
  companyConfig
}) => {
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);
  const [showUserSwitchModal, setShowUserSwitchModal] = useState(false);

  const isAdminOrSuperAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
  const isSystemAdmin = isAdminOrSuperAdmin || currentUser.department === 'Admin';

  const handleTabClick = (tab: string) => {
    onSelectTab(tab);
    setShowMoreDrawer(false);
  };

  return (
    <div className="flex flex-col min-h-screen min-h-[100dvh] w-full bg-[#F8FAFC] dark:bg-[#0B1120] text-slate-900 dark:text-slate-100 font-sans selection:bg-blue-500 selection:text-white">
      {/* 1. Mobile Persistent Top Bar */}
      <MobileTopBar
        currentUser={currentUser}
        isOnline={isOnline}
        syncQueue={syncQueue}
        unreadCount={unreadCount}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenSearch={onOpenSearch}
        onOpenScanner={onOpenScanner}
        onOpenNotifications={onOpenNotifications}
        onOpenSyncDrawer={onOpenSyncDrawer}
        onOpenUserMenu={() => setShowUserSwitchModal(true)}
      />

      {/* 2. Main Scrollable Content Container (Padded so bottom nav never overlaps) */}
      <main className="flex-1 w-full max-w-full overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] px-3 pt-2">
        {children}
      </main>

      {/* 3. Mobile Fixed Bottom Navigation Bar */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={handleTabClick}
        onOpenScanner={onOpenScanner}
        onOpenMoreMenu={() => setShowMoreDrawer(true)}
        currentUser={currentUser}
      />

      {/* 4. More Features Action Drawer (Bottom Sheet) */}
      <AnimatePresence>
        {showMoreDrawer && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end select-none print:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMoreDrawer(false)}
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs"
            />

            {/* Bottom Sheet Modal */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="relative w-full max-h-[85vh] bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto pb-[max(env(safe-area-inset-bottom,0px),1.5rem)]"
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
              </div>

              {/* Drawer Header */}
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                    Factory Hub & More
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Station: {currentUser.department} • Operator: {currentUser.name}
                  </p>
                </div>
                <button
                  onClick={() => setShowMoreDrawer(false)}
                  className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Navigation Options List */}
              <div className="p-4 space-y-2">
                {/* Process Outsourcing */}
                <button
                  onClick={() => handleTabClick('outsource')}
                  className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    activeTab === 'outsource'
                      ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-850/60 border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="text-xs font-bold">Process Outsourcing</h4>
                      <p className="text-[10px] text-slate-500">External Heat Treat, Plating & Jobbing Orders</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>

                {/* Real-time Tracking & Interactive Timeline */}
                <button
                  onClick={() => handleTabClick('timeline-live')}
                  className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    activeTab === 'timeline-live'
                      ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-850/60 border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="text-xs font-bold">Live Tracking & Timeline</h4>
                      <p className="text-[10px] text-slate-500">Trace active batches in the 7-node flow</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>

                {/* Reports & Analytics (If not in primary nav or for quick access) */}
                <button
                  onClick={() => handleTabClick('reports')}
                  className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    activeTab === 'reports'
                      ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-[#3B82F6]'
                      : 'bg-slate-50 dark:bg-slate-850/60 border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="text-xs font-bold">Reports & Excel Export</h4>
                      <p className="text-[10px] text-slate-500">Material consumption & throughput summaries</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>

                {/* Administrator Console (RBAC Protected) */}
                {isAdminOrSuperAdmin && (
                  <button
                    onClick={() => handleTabClick('admin-users')}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      activeTab === 'admin-users'
                        ? 'bg-purple-50 dark:bg-purple-950/50 border-purple-200 dark:border-purple-800 text-purple-600'
                        : 'bg-purple-50/40 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-900/40 text-purple-900 dark:text-purple-300 hover:bg-purple-100/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-bold">Admin Console</h4>
                          <span className="text-[9px] bg-purple-600 text-white font-extrabold px-1.5 py-0.2 rounded-full">ADMIN</span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">User roster, PIN resets, audit trails</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                )}

                {/* Switch User Station */}
                <button
                  onClick={() => {
                    setShowMoreDrawer(false);
                    setShowUserSwitchModal(true);
                  }}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Users className="h-5 w-5" />
                    </div>
                    <div className="text-left">
                      <h4 className="text-xs font-bold">Switch Operator / Station</h4>
                      <p className="text-[10px] text-slate-500">Current: {currentUser.name}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              </div>

              {/* Version Footer */}
              <div className="px-5 pt-2 text-center">
                <span className="text-[10px] font-mono text-slate-400">
                  PMW Tracker Mobile v1.0.53 • Build 53
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. User Switcher Modal */}
      <AnimatePresence>
        {showUserSwitchModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUserSwitchModal(false)}
              className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Switch Active Station</h3>
                  <p className="text-[11px] text-slate-500">Select another operator or station</p>
                </div>
                <button
                  onClick={() => setShowUserSwitchModal(false)}
                  className="p-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-3 space-y-2">
                {availableUsers
                  .filter(u => u.active !== false && u.status !== 'deleted')
                  .map(u => {
                    const isSelected = u.userId === currentUser.userId;
                    return (
                      <button
                        key={u.userId}
                        onClick={() => {
                          onSwitchUser(u.userId);
                          setShowUserSwitchModal(false);
                        }}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700 text-[#3B82F6]'
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">{u.name}</h4>
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">{u.department} ({u.role})</span>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-extrabold bg-[#3B82F6] text-white px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>

              <button
                onClick={() => {
                  setShowUserSwitchModal(false);
                  onLogout();
                }}
                className="w-full mt-2 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-bold text-xs border border-rose-200 dark:border-rose-900/40 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Log In as Different User</span>
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MobileAppShell;
