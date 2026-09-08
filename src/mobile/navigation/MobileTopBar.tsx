import React from 'react';
import { 
  Search, 
  QrCode, 
  Bell, 
  Sun, 
  Moon, 
  WifiOff, 
  ChevronDown
} from 'lucide-react';
import { UserProfile, SyncQueueItem } from '../../types';
import AppLogo from '../../components/AppLogo';

interface MobileTopBarProps {
  currentUser: UserProfile;
  isOnline: boolean;
  syncQueue: SyncQueueItem[];
  unreadCount: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenScanner: () => void;
  onOpenNotifications: () => void;
  onOpenSyncDrawer: () => void;
  onOpenUserMenu?: () => void;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  currentUser,
  isOnline,
  syncQueue,
  unreadCount,
  theme,
  onToggleTheme,
  onOpenSearch,
  onOpenScanner,
  onOpenNotifications,
  onOpenSyncDrawer,
  onOpenUserMenu
}) => {
  const pendingSyncCount = syncQueue.filter(
    item => item.status === 'pending' || item.status === 'failed'
  ).length;

  const getDeptColor = (dept: string) => {
    switch (dept) {
      case 'Admin': return 'bg-purple-600 text-white';
      case 'Purchase': return 'bg-teal-600 text-white';
      case 'Raw Material Store': return 'bg-blue-600 text-white';
      case 'Dispatch': return 'bg-amber-600 text-white';
      case 'Production': return 'bg-cyan-600 text-white';
      case 'Heat Treatment': return 'bg-rose-600 text-white';
      case 'Plating': return 'bg-pink-600 text-white';
      case 'Packing': return 'bg-violet-600 text-white';
      case 'Store': return 'bg-emerald-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  return (
    <header className="sticky top-0 left-0 right-0 z-30 bg-slate-900/98 text-white border-b border-slate-800 backdrop-blur-md px-3 pt-[max(env(safe-area-inset-top,0px),0.5rem)] pb-2.5 flex flex-col gap-2 select-none print:hidden shadow-md">
      {/* Top row: Brand & Status & Actions */}
      <div className="flex items-center justify-between gap-2">
        {/* Brand & Station Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <AppLogo size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xs tracking-tight text-white uppercase truncate">
                PMW TRACKER
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 ${getDeptColor(currentUser.department)}`}>
                {currentUser.department === 'Raw Material Store' ? 'RM STORE' : currentUser.department.toUpperCase()}
              </span>
            </div>
            
            {/* User & Online pill */}
            <div className="flex items-center gap-2 mt-0.5">
              <button 
                onClick={onOpenUserMenu}
                className="text-[10.5px] text-slate-300 font-medium truncate hover:text-white flex items-center gap-1 cursor-pointer"
                title="Switch User / Station"
              >
                <span className="truncate max-w-[110px]">{currentUser.name}</span>
                {onOpenUserMenu && <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />}
              </button>

              <span className="text-slate-600 text-[10px]">•</span>

              {/* Persistent Connectivity Indicator */}
              <button 
                onClick={onOpenSyncDrawer}
                className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                  isOnline 
                    ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40' 
                    : 'text-amber-300 bg-amber-950/50 border border-amber-800/50 animate-pulse'
                }`}
                title="Network and Sync Status"
              >
                {isOnline ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>ONLINE</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-2.5 w-2.5 text-amber-300" />
                    <span>OFFLINE</span>
                  </>
                )}

                {pendingSyncCount > 0 && (
                  <span className="ml-0.5 px-1 py-0.2 bg-amber-500 text-slate-950 font-extrabold rounded-full text-[9px]">
                    {pendingSyncCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls: Search, Scan, Alerts, Theme */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Universal Search Trigger */}
          <button
            onClick={onOpenSearch}
            className="p-2 min-h-[42px] min-w-[42px] rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer border border-slate-700/60 active:scale-95"
            title="Global Search"
            aria-label="Search Job Cards and Materials"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* Quick Hardware Scanner Launch */}
          <button
            onClick={onOpenScanner}
            className="p-2 min-h-[42px] min-w-[42px] rounded-xl bg-[#3B82F6] hover:bg-blue-600 text-white transition flex items-center justify-center cursor-pointer shadow-xs active:scale-95 border border-blue-400/30"
            title="Scan QR / Barcode"
            aria-label="Scan Barcode"
          >
            <QrCode className="h-4 w-4" />
          </button>

          {/* Notification Center */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 min-h-[42px] min-w-[42px] rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer border border-slate-700/60 active:scale-95"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900 animate-pulse" />
            )}
          </button>

          {/* Theme Switcher */}
          <button
            onClick={onToggleTheme}
            className="p-2 min-h-[42px] min-w-[42px] rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center justify-center cursor-pointer border border-slate-700/60 active:scale-95"
            title={theme === 'dark' ? 'Daylight Mode' : 'Night Mode'}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-300" />}
          </button>
        </div>
      </div>
    </header>
  );
};

export default MobileTopBar;
