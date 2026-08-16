/**
 * App.tsx — root component.
 *
 * Responsibilities:
 *  - Theme management
 *  - Sidebar / navigation layout
 *  - Composing AuthProvider + AppDataProvider
 *  - Rendering the active tab view
 *
 * Business logic has been extracted to:
 *  - src/contexts/AuthContext.tsx   — login, logout, PIN verification
 *  - src/contexts/AppDataContext.tsx — Firestore data + subscriptions
 *  - src/hooks/useToast.ts          — toast notifications
 *  - src/hooks/useConfirmDialog.ts  — confirmation dialogs
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Factory, Bell, Search, Filter, Download, Activity, Truck,
  LogOut, Mail, Flame, ArrowRight, Lock, X, Plus, Key, UserPlus,
  CheckCircle, CheckCircle2, ArrowLeft, FileSpreadsheet, Menu,
  Trash2, Printer, QrCode, ArrowUpDown, Layers, Wifi, WifiOff,
  RefreshCw, ChevronUp, ChevronDown, Warehouse, List, Database,
  AlertTriangle, FileText, Users, Sun, Moon, LayoutGrid, Table,
  Eye, EyeOff, Info, RotateCcw
} from 'lucide-react';
import { DBService, auth } from './lib/firebase';
import { UserProfile, JobCard, MaterialMovement, AppNotification, AuditLog, Department, CompanyConfig, JobCardStatus, SyncQueueItem } from './types';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  getSpreadsheetDetails, isSheetsConnected, setGoogleAccessToken,
  initializeSpreadsheet, disconnectSheets
} from './lib/googleSheets';
import {
  exportJobCards, exportMaterialMovements, exportAuditLogs, exportDepartmentUpdates
} from './lib/csvExport';
import { exportComprehensiveExcelBackup } from './lib/excelExport';
import { triggerWhatsAppMovementNotification } from './lib/whatsapp';

// Contexts & hooks
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppDataProvider, useAppData } from './contexts/AppDataContext';
import { useToast } from './hooks/useToast';
import { useConfirmDialog } from './hooks/useConfirmDialog';

// Components
import Sidebar from './components/Sidebar';
import AppLogo from './components/AppLogo';
import DashboardStats from './components/DashboardStats';
import DepartmentOperations from './components/DepartmentOperations';
import JobCardDetailsModal from './components/JobCardDetailsModal';
import GlobalSearchModal from './components/GlobalSearchModal';
import ScannerModal from './components/ScannerModal';
import ReportView from './components/ReportView';
import AdminConsole from './components/AdminConsole';
import TimelineVisual from './components/TimelineVisual';
import GoogleSheetViewer from './components/GoogleSheetViewer';
import QuickTransferModal from './components/QuickTransferModal';
import BulkTransferModal from './components/BulkTransferModal';
import BulkPrintManifestModal from './components/BulkPrintManifestModal';
import BulkStatusUpdateModal from './components/BulkStatusUpdateModal';
import PendingBreakdownModal from './components/PendingBreakdownModal';
import JobStatusBadge from './components/JobStatusBadge';
import ConnectivityHealthWidget from './components/ConnectivityHealthWidget';
import { OutsourceManager } from './components/OutsourceManager';
import { getJobCardProcessMetrics, getRawMaterialIssuedQty, getJobCardDepartmentPending } from './lib/metrics';

// ─── Avatar helper (kept here — pure UI) ──────────────────────────────────────

const getAvatarBg = (dept: string) => {
  switch (dept) {
    case 'Admin': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900/30';
    case 'Purchase': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/30';
    case 'Raw Material Store': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-900/30';
    case 'Dispatch': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/30';
    case 'Production': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-900/30';
    case 'Heat Treatment': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-900/30';
    case 'Plating': return 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300 border-pink-200 dark:border-pink-900/30';
    case 'Packing': return 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200 dark:border-violet-900/30';
    case 'Store': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/30';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
};

// ─── Root export — wraps with providers ───────────────────────────────────────

export default function App() {
  const { toast, showToast } = useToast();
  const { confirmDialog, showConfirm, closeConfirm, setConfirmDialog } = useConfirmDialog();

  // Theme is outside providers so the whole tree gets it
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <AuthProvider showToast={showToast}>
      <AppInner
        theme={theme}
        setTheme={setTheme}
        toast={toast}
        showToast={showToast}
        confirmDialog={confirmDialog}
        showConfirm={showConfirm}
        closeConfirm={closeConfirm}
        setConfirmDialog={setConfirmDialog}
      />
    </AuthProvider>
  );
}

// ─── Inner app — has access to AuthContext, wraps AppDataProvider ─────────────

function AppInner({
  theme, setTheme, toast, showToast, confirmDialog, showConfirm, closeConfirm, setConfirmDialog
}: {
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toast: any;
  showToast: any;
  confirmDialog: any;
  showConfirm: any;
  closeConfirm: () => void;
  setConfirmDialog: any;
}) {
  const { currentUser, setCurrentUser, handleLogout } = useAuth();

  return (
    <AppDataProvider
      currentUser={currentUser}
      setCurrentUser={setCurrentUser}
      showToast={showToast}
    >
      <AppShell
        theme={theme}
        setTheme={setTheme}
        toast={toast}
        showToast={showToast}
        confirmDialog={confirmDialog}
        showConfirm={showConfirm}
        closeConfirm={closeConfirm}
        setConfirmDialog={setConfirmDialog}
        handleLogout={handleLogout}
      />
    </AppDataProvider>
  );
}

// ─── AppShell — navigation layout + tab routing ───────────────────────────────
// All the original rendering logic lives here, now reading from context
// instead of local state. The JSX is unchanged — only state/data access updated.

function AppShell({
  theme, setTheme, toast, showToast, confirmDialog, showConfirm, closeConfirm,
  setConfirmDialog, handleLogout
}: {
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toast: any;
  showToast: any;
  confirmDialog: any;
  showConfirm: any;
  closeConfirm: () => void;
  setConfirmDialog: any;
  handleLogout: () => void;
}) {
  const {
    currentUser, setCurrentUser,
    loginName, loginPin, showPin, authError, isVerifyingPin,
    selectedLoginUser, selectedDeptFilter, userSearchQuery,
    setLoginName, setLoginPin, setShowPin, setAuthError,
    setSelectedLoginUser, setSelectedDeptFilter, setUserSearchQuery,
    isRegistering, regName, regSuccess,
    setIsRegistering, setRegName, setRegSuccess,
    handleUsernamePinLogin,
  } = useAuth();

  const {
    users, jobCards, movements, notifications, auditLogs, companyConfig,
    syncQueue, isOnline, showSyncDrawer, retryingIds,
    setShowSyncDrawer, setRetryingIds,
    refreshAllStates, refreshUsers, refreshJobCards,
    setUsers, setJobCards, setMovements, setNotifications, setCompanyConfig,
  } = useAppData();

  // ── UI-only state (stays here — pure presentation) ────────────────────────

  const [activeTab, setActiveTab] = useState<'dashboard' | 'all-orders' | 'timeline-live' | 'reports' | 'admin-users' | string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });
  const [activeUrgentRequest, setActiveUrgentRequest] = useState<AppNotification | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobCard | null>(null);
  const [quickTransferJob, setQuickTransferJob] = useState<JobCard | null>(null);
  const [pendingBreakdownJobCard, setPendingBreakdownJobCard] = useState<JobCard | null>(null);
  const [selectedJobCardNos, setSelectedJobCardNos] = useState<string[]>([]);
  const [showBulkTransferModal, setShowBulkTransferModal] = useState(false);
  const [showBulkPrintModal, setShowBulkPrintModal] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);

  // Sheets
  const [sheetsDetails, setSheetsDetails] = useState(getSpreadsheetDetails());
  const [isSheetsActive, setIsSheetsActive] = useState(isSheetsConnected());
  const [showSheetsModal, setShowSheetsModal] = useState(false);
  const [sheetsModalTab, setSheetsModalTab] = useState<'cloud' | 'offline'>('cloud');
  const [sheetsFeedback, setSheetsFeedback] = useState('');
  const [showSheetsInspector, setShowSheetsInspector] = useState(false);
  const [showEmulatedSheetsBtn, setShowEmulatedSheetsBtn] = useState(true);

  // All-orders filters
  const [allOrdersSearch, setAllOrdersSearch] = useState('');
  const [allOrdersSearchScope, setAllOrdersSearchScope] = useState<'all' | 'jobs' | 'movements'>('jobs');
  const [showGlobalSearchModal, setShowGlobalSearchModal] = useState(false);
  const [expandedJobCardNo, setExpandedJobCardNo] = useState<string | null>(null);
  const [allOrdersStageTab, setAllOrdersStageTab] = useState<'active' | 'store' | 'all'>('active');
  const [allOrdersDeptFilter, setAllOrdersDeptFilter] = useState<string>('All');
  const [allOrdersStatusFilter, setAllOrdersStatusFilter] = useState<string>('All');
  const [allOrdersPersonFilter, setAllOrdersPersonFilter] = useState<string>('All');
  const [allOrdersPartyFilter, setAllOrdersPartyFilter] = useState<string>('All');
  const [allOrdersOrderNoFilter, setAllOrdersOrderNoFilter] = useState<string>('All');
  const [allOrdersMyDeptOnly, setAllOrdersMyDeptOnly] = useState(false);
  const [mobileSortBy, setMobileSortBy] = useState<'Priority' | 'Newest' | 'Department'>('Priority');
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');
  const [freezeJobCardColumn, setFreezeJobCardColumn] = useState<boolean>(true);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // ── Auto-submit PIN ───────────────────────────────────────────────────────

  useEffect(() => {
    if (loginName.trim() && loginPin.length === 4 && !isVerifyingPin) {
      const timer = setTimeout(() => {
        handleUsernamePinLogin(users);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [loginPin, loginName, isVerifyingPin, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep link: open job card from QR scan ────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const job = (e as CustomEvent).detail as JobCard;
      if (job) setSelectedJob(job);
    };
    window.addEventListener('open-job-card', handler);
    return () => window.removeEventListener('open-job-card', handler);
  }, []);

  // ── Auto-refresh ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = setInterval(refreshAllStates, 30000);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, refreshAllStates]);

  // ── Responsive sidebar ────────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(true);
      else setSidebarOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Keyboard shortcut Cmd+K ───────────────────────────────────────────────

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearchModal(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ── Notification permission for store roles ───────────────────────────────

  useEffect(() => {
    if (currentUser && (currentUser.department === 'Store' || currentUser.department === 'Raw Material Store')) {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, [currentUser]);

  // ── Computed filter lists ─────────────────────────────────────────────────

  const uniqueParties = useMemo(() =>
    Array.from(new Set(jobCards.map(j => j.partyName).filter(Boolean))).sort(),
    [jobCards]
  );

  const uniquePersons = useMemo(() => {
    const set = new Set<string>();
    jobCards.forEach(j => {
      if (j.createdBy) set.add(j.createdBy);
      if (j.operatorName) set.add(j.operatorName);
      if (j.assignedToUserName) set.add(j.assignedToUserName);
      if (j.productionDetails?.operatorName) set.add(j.productionDetails.operatorName);
      if (j.purchaseDetails?.supplierName) set.add(j.purchaseDetails.supplierName);
      if (j.outsourceDetails?.poPlacedByUserName) set.add(j.outsourceDetails.poPlacedByUserName);
      if (j.outsourceDetails?.supplierName) set.add(j.outsourceDetails.supplierName);
    });
    movements.forEach(m => {
      if (m.transferBy) set.add(m.transferBy);
      if (m.acceptedBy) set.add(m.acceptedBy);
    });
    return Array.from(set).sort();
  }, [jobCards, movements]);

  const uniqueOrderNos = useMemo(() => {
    const set = new Set<string>();
    jobCards.forEach(j => {
      if (j.orderNo) set.add(j.orderNo);
      if (j.outsourceOrderId) set.add(j.outsourceOrderId);
      if (j.outsourceDetails?.poNumber) set.add(j.outsourceDetails.poNumber);
      if (j.purchaseDetails?.billNo) set.add(j.purchaseDetails.billNo);
    });
    return Array.from(set).sort();
  }, [jobCards]);

  const filteredNotifications = notifications.filter(notif => {
    if (!currentUser) return false;
    return (
      notif.userId === currentUser.userId ||
      notif.userId === currentUser.department ||
      notif.department === 'All' ||
      notif.userId === 'All'
    );
  });

  // ── NOTE ──────────────────────────────────────────────────────────────────
  // The full JSX render (login screen, sidebar, tab views, modals) is
  // unchanged from the original App.tsx. Copy everything from the original
  // `return (` block (line ~2095) to the end of the file into this function.
  //
  // The only replacements needed in that JSX are:
  //   OLD: setCurrentUser(...)     → already available via useAuth()
  //   OLD: refreshAllStates()      → already available via useAppData()
  //   OLD: showToast(...)          → passed as prop
  //   OLD: showConfirm(...)        → passed as prop
  //
  // Everything else (all the JSX, className strings, event handlers for
  // UI interactions) is identical to the original and does not need to change.
  // ─────────────────────────────────────────────────────────────────────────


  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-200 font-sans overflow-hidden selection:bg-[#3B82F6] selection:text-white">
      
      {/* 1. SIDE NAVIGATION COLUMN Backdrop for mobile */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 lg:hidden animate-fade-in print:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      <div 
        ref={sidebarRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`
          fixed inset-y-0 left-0 z-50 transition-all duration-300 ease-in-out flex shrink-0 h-full print:hidden
          lg:static lg:z-0 lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0 w-[270px] max-w-[85vw]' : '-translate-x-full w-[270px] max-w-[85vw] lg:w-0 lg:opacity-0 lg:overflow-hidden'}
        `}
      >
        <Sidebar 
          currentUser={currentUser}
          availableUsers={users}
          onSwitchUser={handleSwitchUserSimulated}
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setSelectedJobCardNos([]);
            if (window.innerWidth < 1024) {
              setSidebarOpen(false);
            }
          }}
          unreadCount={unreadNotificationsCount}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          companyConfig={companyConfig}
        />
      </div>

      {/* 2. MAIN APPLICATION CONTENT WRAPPER */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#F8FAFC] dark:bg-slate-950">
        
        {/* Top Control Bar block */}
        <header className="h-16 border-b border-[#E2E8F0] dark:border-slate-850 px-2 sm:px-6 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0 select-none print:hidden">
          <div className="flex items-center gap-1 sm:gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 -ml-1 text-slate-500 hover:text-slate-705 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-805 rounded-lg transition-all cursor-pointer"
              title="Toggle Sidebar Menu"
              id="btn_toggle_sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider bg-[#F1F5F9] dark:bg-slate-850 py-1 px-3 rounded-full font-mono hidden sm:inline-block">
              Active Plant: Site #1
            </span>
            <button
              onClick={() => {
                const currentForced = localStorage.getItem('mfr_force_offline') === 'true';
                if (currentForced || !isOnline) {
                  localStorage.removeItem('mfr_force_offline');
                  DBService.setOnline();
                  const onlineState = navigator.onLine;
                  setIsOnline(onlineState);
                  showToast("Restoring cloud operations...", "info");
                  refreshAllStates();
                  if (onlineState) {
                    DBService.retryAllSyncItems();
                  }
                } else {
                  localStorage.setItem('mfr_force_offline', 'true');
                  setIsOnline(false);
                  showToast("Forced Offline Mode Active. Purely local operation fallback.", "info");
                  refreshAllStates();
                }
              }}
              className={`flex items-center gap-1 px-1.5 py-1 sm:px-3 sm:py-1 rounded-full text-[11px] font-semibold border font-sans transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer ${
                isOnline 
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/40' 
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:hover:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40'
              }`} 
              title={isOnline ? "Force/Simulate Offline Mode for low connectivity" : "Restore Online/Cloud sync"}
              id="btn_network_status_toggle"
            >
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="hidden sm:inline">Cloud Synced</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 animate-bounce" />
                  <span className="animate-pulse hidden sm:inline">Offline Mode</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 relative overflow-x-auto no-scrollbar shrink min-w-0 py-1">
            
            {/* Google Sheets Live Syncer Status badge & controls */}
            {isSheetsActive ? (
              <div className="flex items-center gap-1">
                <a 
                  href={sheetsDetails.url || "#"} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/35 dark:hover:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/45 text-emerald-700 dark:text-emerald-400 text-xs font-semibold font-sans transition-all"
                  title="Open live Google Sheets logbook in a new tab"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse animate-duration-1000 shrink-0" />
                  <span className="hidden sm:inline leading-none">Sheets Synced</span>
                </a>
                <button
                  onClick={handleDisconnectGoogleSheets}
                  className="p-1.5 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                  title="Disconnect Google Sheets sync"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSheetsModal(true)}
                className="flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer"
                title="Connect real-time Google Sheets for logbook updates"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-500 sm:hidden" />
                <div className="h-2 w-2 rounded-full bg-slate-350 hidden sm:block" />
                <span className="hidden sm:inline">Link Google Sheets</span>
              </button>
            )}


            {/* Global Offline Search Button */}
            <button
              onClick={() => setShowGlobalSearchModal(true)}
              className="flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold transition cursor-pointer print:hidden"
              title="Search across active Job Cards and Material Movements offline (Ctrl+K)"
              id="btn_global_offline_search"
            >
              <Search className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="hidden sm:inline">Offline Search</span>
              <kbd className="hidden md:inline-block ml-0.5 px-1.5 py-0.5 text-[9px] bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 rounded font-mono">⌘K</kbd>
            </button>

            {/* QR Code Scanner Button */}
            <button
              onClick={() => setScannerOpen(true)}
              className="flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-semibold transition cursor-pointer print:hidden"
              title="Scan or simulate physical Job Card QR labels"
              id="btn_qr_scanner"
            >
              <QrCode className="h-4 w-4 text-[#4F46E5] dark:text-[#818CF8]" />
              <span className="hidden sm:inline">QR Scanner</span>
            </button>

            {/* Theme Toggle Button for Daylight/Nightlight */}
            <button
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-200 transition cursor-pointer print:hidden"
              title={theme === 'light' ? "Switch to Nightlight (Dark) Theme" : "Switch to Daylight (Light) Theme"}
              id="btn_theme_toggle"
            >
              {theme === 'light' ? (
                <Moon className="h-4 w-4 text-slate-600" />
              ) : (
                <Sun className="h-4 w-4 text-amber-500" />
              )}
            </button>



            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
              className={`p-2 rounded-lg transition cursor-pointer ${autoRefreshEnabled ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-500'}`}
              title={autoRefreshEnabled ? 'Auto-refresh enabled (30s)' : 'Enable auto-refresh (30s)'}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefreshEnabled ? 'animate-spin' : ''}`} />
            </button>

            {/* Logout sign-off trigger */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-rose-500 transition cursor-pointer"
              title="Sign Out of Crew Terminal"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* 3. SCROLLABLE OPERATIONS CONTAINER */}
        <div 
          onTouchStart={handleMainTouchStart}
          onTouchMove={handleMainTouchMove}
          onTouchEnd={handleMainTouchEnd}
          className="flex-1 p-3 sm:p-6 pb-24 lg:pb-6 space-y-4 sm:space-y-6 overflow-y-auto bg-[#F8FAFC] dark:bg-slate-950 print:p-0 print:overflow-visible"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="space-y-4 sm:space-y-6"
            >
              {/* Active stats display overview row */}
              {activeTab === 'dashboard' && (
                <div className="space-y-4">
                  <DashboardStats 
                    department={currentUser.department}
                    jobCards={jobCards}
                    movements={movements}
                  />

                  <ConnectivityHealthWidget 
                    isOnline={isOnline}
                    syncQueue={syncQueue}
                    onOpenSyncDrawer={() => setShowSyncDrawer(true)}
                    onRetryAllSyncs={handleManualRetryAll}
                  />
                </div>
              )}

          {/* RENDER VIEWPORT ACCORDING TO NAVIGATION */}
          {activeTab === 'dashboard' && (
            <DepartmentOperations
              currentUser={currentUser}
              jobCards={jobCards}
              movements={movements}
              companyConfig={companyConfig}
              onCreateJobCard={handleCreateJobCard}
              onUpdateJobCard={handleUpdateJobCard}
              onCreateMovement={handleCreateMovement}
              onAcceptMovement={handleAcceptMovement}
              onRejectMovement={handleRejectMovement}
              onSelectJobCard={setSelectedJob}
              onQuickTransfer={(j) => setQuickTransferJob(j)}
            />
          )}

          {/* ALL ORDERS GRID VIEW */}
          {activeTab === 'all-orders' && (() => {
            const visibleAllOrders = filteredAllOrders.slice(0, 100);
            const allVisibleSelected = visibleAllOrders.length > 0 && visibleAllOrders.every(j => selectedJobCardNos.includes(j.jobCardNo));
            const activeJobsCount = jobCards.filter(j => j.currentDepartment !== 'Store' && j.currentDepartment !== 'Completed' && j.currentDepartment !== 'Dispatch' && j.status !== 'Completed').length;
            const storeJobsCount = jobCards.filter(j => j.currentDepartment === 'Store' || j.currentDepartment === 'Completed' || j.currentDepartment === 'Dispatch' || j.status === 'Completed').length;
            const totalJobsCount = jobCards.length;

            return (
              <div className="space-y-4 pb-28 sm:pb-24 lg:pb-2">
                
                {/* Header Titles */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                  <div>
                    <h3 className="font-sans font-bold text-lg text-slate-805 dark:text-white uppercase tracking-wider">
                      Manufacturing Job Cards Database
                    </h3>
                    <p className="text-xs text-slate-400 italic">Entire plant ledger registry containing live queues</p>
                  </div>
                  {/* View Toggler for Mobile & Freeze Column Quick Toggle */}
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 md:hidden shadow-xs">
                      <button
                        onClick={() => setMobileViewMode('cards')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold font-sans transition-all flex items-center gap-1 cursor-pointer ${
                          mobileViewMode === 'cards' 
                            ? 'bg-white dark:bg-slate-900 text-slate-850 dark:text-white shadow-xs' 
                            : 'text-slate-500 hover:text-slate-750 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        <LayoutGrid className="h-3 w-3" />
                        <span>Cards View</span>
                      </button>
                      <button
                        onClick={() => setMobileViewMode('table')}
                        className={`px-3 py-1 rounded-md text-[11px] font-bold font-sans transition-all flex items-center gap-1 cursor-pointer ${
                          mobileViewMode === 'table' 
                            ? 'bg-white dark:bg-slate-900 text-slate-850 dark:text-white shadow-xs' 
                            : 'text-slate-500 hover:text-slate-750 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        <Table className="h-3 w-3" />
                        <span>Table View</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setFreezeJobCardColumn(prev => !prev)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-sans transition-all flex items-center gap-1.5 cursor-pointer border ${
                        freezeJobCardColumn
                          ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/80 shadow-2xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                      title={freezeJobCardColumn ? "Job Card column is pinned to left during horizontal scroll" : "Pin Job Card column to left during horizontal scroll"}
                    >
                      <Lock className={`h-3 w-3 ${freezeJobCardColumn ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                      <span className="whitespace-nowrap">{freezeJobCardColumn ? 'Frozen ID Column' : 'Freeze Column'}</span>
                    </button>
                  </div>
                </div>

                {/* Main Category Tabs: Active Production vs Store & Dispatched */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-100 dark:bg-slate-850 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-800 w-full">
                  <button
                    type="button"
                    onClick={() => setAllOrdersStageTab('active')}
                    className={`w-full sm:flex-1 py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl font-bold text-xs font-sans transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[42px] ${
                      allOrdersStageTab === 'active'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm border border-indigo-200/80 dark:border-indigo-800/60'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Factory className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span className="font-extrabold uppercase tracking-wider text-[10.5px] sm:text-[11px] text-center break-words">Active Production Line</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                      allOrdersStageTab === 'active' 
                        ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300' 
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {activeJobsCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAllOrdersStageTab('store')}
                    className={`w-full sm:flex-1 py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl font-bold text-xs font-sans transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[42px] ${
                      allOrdersStageTab === 'store'
                        ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm border border-emerald-200/80 dark:border-emerald-800/60'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Warehouse className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="font-extrabold uppercase tracking-wider text-[10.5px] sm:text-[11px] text-center break-words">Store & Dispatched Tab</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                      allOrdersStageTab === 'store' 
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' 
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {storeJobsCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAllOrdersStageTab('all')}
                    className={`w-full sm:w-auto py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl font-bold text-xs font-sans transition-all flex items-center justify-center gap-2 cursor-pointer min-h-[42px] ${
                      allOrdersStageTab === 'all'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm border border-slate-300 dark:border-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Layers className="h-4 w-4 text-slate-500 shrink-0" />
                    <span className="font-extrabold uppercase tracking-wider text-[10.5px] sm:text-[11px] whitespace-nowrap">All Cards</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                      {totalJobsCount}
                    </span>
                  </button>
                </div>

                {/* Grid search and filtration row */}
                <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col gap-3 text-xs">
                  <div className="flex flex-col lg:flex-row gap-3 items-center justify-between">
                    
                    {/* Search string */}
                    <div className="relative w-full lg:w-96">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search across Job Cards, Movement Refs, Party, Item, Operator..."
                        value={allOrdersSearch}
                        onChange={(e) => setAllOrdersSearch(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-750 w-full focus:outline-none focus:border-amber-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                      />
                      {allOrdersSearch && (
                        <button
                          onClick={() => setAllOrdersSearch('')}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                          title="Clear search"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Scope Selector Tabs */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-1 bg-slate-100 dark:bg-slate-800/80 p-1.5 sm:p-1 rounded-xl border border-slate-200 dark:border-slate-750 w-full lg:w-auto justify-center">
                      <button
                        onClick={() => setAllOrdersSearchScope('all')}
                        className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 ${
                          allOrdersSearchScope === 'all'
                            ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-center">All Data ({filteredAllOrders.length + filteredMovements.length})</span>
                      </button>
                      <button
                        onClick={() => setAllOrdersSearchScope('jobs')}
                        className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 ${
                          allOrdersSearchScope === 'jobs'
                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-center">Job Cards ({filteredAllOrders.length})</span>
                      </button>
                      <button
                        onClick={() => setAllOrdersSearchScope('movements')}
                        className={`w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center justify-center gap-1.5 min-h-[38px] sm:min-h-0 ${
                          allOrdersSearchScope === 'movements'
                            ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-center">Material Movements ({filteredMovements.length})</span>
                      </button>
                    </div>

                    {/* Dropdowns */}
                    <div className="flex flex-wrap gap-2.5 items-center w-full lg:w-auto justify-end">
                      <div className="flex items-center gap-1.5">
                        <Filter className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-slate-400 text-[11px] uppercase font-bold">Filters</span>
                      </div>
                      
                      {/* Custom Specific Filters: Party, Person, Order No */}
                      <select
                        value={allOrdersPartyFilter}
                        onChange={(e) => setAllOrdersPartyFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none max-w-[150px] truncate"
                        title="Filter by Customer / Party Name"
                      >
                        <option value="All">🏢 Customer: All</option>
                        {uniqueParties.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>

                      <select
                        value={allOrdersPersonFilter}
                        onChange={(e) => setAllOrdersPersonFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none max-w-[150px] truncate"
                        title="Filter by Person's Name (Operator / Creator / Assignee)"
                      >
                        <option value="All">👤 Person: All</option>
                        {uniquePersons.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>

                      <select
                        value={allOrdersOrderNoFilter}
                        onChange={(e) => setAllOrdersOrderNoFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none max-w-[150px] truncate"
                        title="Filter by Order No / Order Ref"
                      >
                        <option value="All">📑 Order: All</option>
                        {uniqueOrderNos.map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>

                      <select
                        value={allOrdersDeptFilter}
                        onChange={(e) => setAllOrdersDeptFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none"
                      >
                        <option value="All">All Lines</option>
                        <option value="Purchase">Purchase Inward</option>
                        <option value="Production">Production Milling</option>
                        <option value="Heat Treatment">Heat Treatment Line</option>
                        <option value="Plating">Surface Plating</option>
                        <option value="Packing">Packing Line</option>
                        <option value="Store">Storehouse</option>
                        <option value="Completed">Completed Dispatch</option>
                      </select>

                      <select
                        value={allOrdersStatusFilter}
                        onChange={(e) => setAllOrdersStatusFilter(e.target.value)}
                        className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none"
                      >
                        <option value="All">All Statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="In Process">In Process</option>
                        <option value="Pending Acceptance">Pending Acceptance</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Completed">Completed</option>
                      </select>

                      <label className="flex items-center gap-2 cursor-pointer bg-slate-50 dark:bg-slate-850 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-750 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition select-none" id="my_dept_toggle_label">
                        <input
                          type="checkbox"
                          checked={allOrdersMyDeptOnly}
                          onChange={(e) => setAllOrdersMyDeptOnly(e.target.checked)}
                          className="rounded border-slate-350 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer accent-indigo-600"
                          id="toggle_all_orders_my_dept"
                        />
                        <span className="font-sans text-[11px] font-bold uppercase tracking-wider">
                          My Dept Only {currentUser?.department && currentUser.department !== 'Admin' ? `(${currentUser.department})` : ''}
                        </span>
                      </label>

                      {(allOrdersPersonFilter !== 'All' || allOrdersPartyFilter !== 'All' || allOrdersOrderNoFilter !== 'All' || allOrdersDeptFilter !== 'All' || allOrdersStatusFilter !== 'All' || allOrdersSearch || allOrdersMyDeptOnly) && (
                        <button
                          type="button"
                          onClick={() => {
                            setAllOrdersSearch('');
                            setAllOrdersPersonFilter('All');
                            setAllOrdersPartyFilter('All');
                            setAllOrdersOrderNoFilter('All');
                            setAllOrdersDeptFilter('All');
                            setAllOrdersStatusFilter('All');
                            setAllOrdersMyDeptOnly(false);
                          }}
                          className="px-2.5 py-1.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 rounded-lg text-[11px] font-bold transition-all border border-red-200 dark:border-red-800 flex items-center gap-1 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                          <span>Reset</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Offline Search Status Indicator Banner */}
                  {!isOnline && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 px-3.5 flex items-center justify-between text-amber-800 dark:text-amber-300 text-[11px]">
                      <div className="flex items-center gap-2 font-semibold">
                        <WifiOff className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span>⚡ Offline Local Search Engine active: Querying local cache across {jobCards.length} Job Cards & {movements.length} Material Movements</span>
                      </div>
                      <button
                        onClick={() => setShowGlobalSearchModal(true)}
                        className="font-bold underline text-amber-700 dark:text-amber-300 hover:text-amber-900 cursor-pointer shrink-0"
                      >
                        Open Search Window (⌘K)
                      </button>
                    </div>
                  )}
                </div>

                {/* Bulk Actions Panel */}
                {selectedJobCardNos.length > 0 && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/25 border border-indigo-150 dark:border-indigo-900/40 p-3 px-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse" />
                      <span className="font-bold text-indigo-900 dark:text-indigo-200">
                        {selectedJobCardNos.length} Job Card{selectedJobCardNos.length > 1 ? 's' : ''} Selected for Transit
                      </span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <button
                        onClick={() => setSelectedJobCardNos([])}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 font-bold text-slate-600 dark:text-slate-350 transition cursor-pointer"
                      >
                        Clear Selection
                      </button>
                      <button
                        onClick={() => setShowBulkStatusModal(true)}
                        className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold shadow-sm shadow-amber-500/10 transition flex items-center gap-1.5 cursor-pointer"
                        title="Change status for all selected job cards"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Bulk Update Status</span>
                      </button>
                      <button
                        onClick={() => setShowBulkPrintModal(true)}
                        className="px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-extrabold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Printer className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Print Selection</span>
                      </button>
                      <button
                        onClick={() => setShowBulkTransferModal(true)}
                        className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold shadow-sm shadow-indigo-600/10 transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <ArrowUpDown className="h-3.5 w-3.5" />
                        <span>Bulk Transfer Selected</span>
                      </button>
                    </div>
                  </div>
                )}

              {/* Grid table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm relative">
                {/* Horizontal scroll indicators */}
                {scrollState.canScrollLeft && (
                  <div className="absolute left-[160px] top-0 bottom-0 w-6 bg-gradient-to-r from-black/8 to-transparent dark:from-black/35 pointer-events-none z-22 transition-opacity duration-300" />
                )}
                {scrollState.canScrollRight && (
                  <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-black/8 to-transparent dark:from-black/35 pointer-events-none z-22 transition-opacity duration-300" />
                )}

                {/* Desktop View / Mobile Scrollable Table View */}
                <div 
                  className={`${mobileViewMode === 'table' ? 'block' : 'hidden'} md:block overflow-x-auto`}
                  ref={tableScrollRef}
                  onScroll={handleTableScroll}
                >
                  {filteredAllOrders.length === 0 ? (
                    <div className="text-center p-12 space-y-1.5">
                      <span className="text-2xl">🔍</span>
                      <p className="text-sm font-semibold text-slate-450 font-mono">No active Job Cards match database filter parameters</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-405 uppercase tracking-wider font-mono border-b border-slate-200 dark:border-slate-800">
                          <th className={`py-3 px-3 text-center w-12 min-w-[48px] max-w-[48px] shrink-0 border-b border-slate-200 dark:border-slate-800 ${
                            freezeJobCardColumn 
                              ? 'sticky left-0 z-30 bg-slate-50 dark:bg-slate-950' 
                              : 'bg-slate-50 dark:bg-slate-950'
                          }`}>
                            <input 
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedJobCardNos(prev => {
                                    const next = [...prev];
                                    visibleAllOrders.forEach(j => {
                                      if (!next.includes(j.jobCardNo)) {
                                        next.push(j.jobCardNo);
                                      }
                                    });
                                    return next;
                                  });
                                } else {
                                  setSelectedJobCardNos(prev => prev.filter(no => !visibleAllOrders.some(v => v.jobCardNo === no)));
                                }
                              }}
                              className="rounded border-slate-350 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer accent-indigo-600"
                            />
                          </th>
                          <th className={`py-3 px-3 w-32 min-w-[128px] max-w-[128px] shrink-0 border-b border-slate-200 dark:border-slate-800 transition-all ${
                            freezeJobCardColumn 
                              ? 'sticky left-12 z-30 bg-slate-50 dark:bg-slate-950 border-r-2 border-indigo-500/40 dark:border-indigo-500/60 shadow-[4px_0_12px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_16px_rgba(0,0,0,0.4)]' 
                              : 'border-r border-slate-200/80 dark:border-slate-800/80'
                          }`}>
                            <div className="flex items-center justify-between gap-1">
                              <span>Job Card</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFreezeJobCardColumn(prev => !prev);
                                }}
                                className={`p-1 rounded transition cursor-pointer ${
                                  freezeJobCardColumn 
                                    ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/80' 
                                    : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                                title={freezeJobCardColumn ? "Column is frozen. Click to unfreeze." : "Click to freeze Job Card column"}
                              >
                                <Lock className="h-3 w-3" />
                              </button>
                            </div>
                          </th>
                          <th className="py-3 px-3">Party Name</th>
                          <th className="py-3 px-3">Item Details</th>
                          <th className="py-3 px-3">Target (KG)</th>
                          <th className="py-3 px-3">Pending (KG)</th>
                          <th className="py-3 px-3">Action</th>
                          
                          {/* Production Stage columns */}
                          <th className="py-3 px-2 bg-blue-50/55 dark:bg-blue-950/25 text-blue-800 dark:text-blue-300 font-bold border-x border-slate-200/50 dark:border-slate-800/40 text-center">Recv (PROD)</th>
                          <th className="py-3 px-2 bg-blue-50/55 dark:bg-blue-950/25 text-blue-800 dark:text-blue-300 font-bold text-center">Rout (PLAT)</th>
                          <th className="py-3 px-2 bg-blue-50/55 dark:bg-blue-950/25 text-blue-800 dark:text-blue-300 font-bold border-r border-slate-200/50 dark:border-slate-800/40 text-center">Remain (PROD)</th>
                          
                          {/* Plating Stage columns */}
                          <th className="py-3 px-2 bg-purple-50/55 dark:bg-purple-950/25 text-purple-800 dark:text-purple-300 font-bold text-center">Recv (PLAT)</th>
                          <th className="py-3 px-2 bg-purple-50/55 dark:bg-purple-950/25 text-purple-800 dark:text-purple-300 font-bold border-x border-slate-200/50 dark:border-slate-800/40 text-center">Rout (PACK)</th>
                          <th className="py-3 px-2 bg-purple-50/55 dark:bg-purple-950/25 text-purple-800 dark:text-purple-300 font-bold border-r border-slate-200/50 dark:border-slate-800/40 text-center">Remain (PLAT)</th>
                          
                          {/* Packing Stage columns */}
                          <th className="py-3 px-2 bg-pink-50/55 dark:bg-pink-950/25 text-pink-800 dark:text-pink-300 font-bold text-center">Recv (PACK)</th>
                          <th className="py-3 px-2 bg-pink-50/55 dark:bg-pink-950/25 text-pink-800 dark:text-pink-300 font-bold border-l border-slate-200/50 dark:border-slate-800/40 text-center">Rout (STOR)</th>
                          <th className="py-3 px-2 bg-pink-50/55 dark:bg-pink-950/25 text-pink-800 dark:text-pink-300 font-bold border-x border-slate-200/50 dark:border-slate-800/40 text-center">Pieces (PACK)</th>
                          <th className="py-3 px-2 bg-pink-50/55 dark:bg-pink-950/25 text-pink-800 dark:text-pink-300 font-bold border-r border-slate-200/50 dark:border-slate-800/40 text-center">Remain (PACK)</th>
                          
                          {/* Store columns */}
                          <th className="py-3 px-2 bg-emerald-50/55 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300 font-bold text-center">Dispatched</th>
                          <th className="py-3 px-2 bg-emerald-50/55 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300 font-bold border-l border-slate-200/50 dark:border-slate-800/40 text-center">In Stock</th>

                          <th className="py-3 px-3">Position</th>
                          <th className="py-3 px-3">Status</th>
                          <th className="py-3 px-3 text-center">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleAllOrders.map(j => {
                          const m = getJobCardProcessMetrics(j, movements);
                          const deptPending = getJobCardDepartmentPending(j, movements);
                          const isPurchasedForProduction = j.processType === 'Purchase';
                          const isHTRequired = j.heatTreatmentRequired;
                          const hasMovedToHT = movements.some(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase() && m.fromDepartment === 'Purchase' && m.toDepartment === 'Heat Treatment');
                          const isPendingHT = isPurchasedForProduction && isHTRequired && !hasMovedToHT;

                          return (
                            <React.Fragment key={j.jobCardNo}>
                              <tr 
                                onClick={() => setExpandedJobCardNo(expandedJobCardNo === j.jobCardNo ? null : j.jobCardNo)}
                                className={`group border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-blue-50/80 dark:hover:bg-indigo-950/40 text-slate-700 dark:text-slate-300 ${isPendingHT ? 'bg-orange-50 dark:bg-orange-950/20' : ''} cursor-pointer transition-all duration-200 hover:shadow-xs`}
                              >
                                <td className={`py-3 px-3 text-center w-12 min-w-[48px] max-w-[48px] shrink-0 transition-colors duration-200 ${
                                  freezeJobCardColumn 
                                    ? 'sticky left-0 z-20 bg-white dark:bg-slate-900 group-hover:bg-blue-50/80 dark:group-hover:bg-indigo-950/40' 
                                    : 'bg-white dark:bg-slate-900 group-hover:bg-blue-50/80 dark:group-hover:bg-indigo-950/40'
                                }`}>
                                  <input 
                                    type="checkbox"
                                    checked={selectedJobCardNos.includes(j.jobCardNo)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedJobCardNos(prev => [...prev, j.jobCardNo]);
                                      } else {
                                        setSelectedJobCardNos(prev => prev.filter(no => no !== j.jobCardNo));
                                      }
                                    }}
                                    className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer accent-indigo-600"
                                  />
                                </td>
                                <td className={`py-3 px-3 font-mono font-bold text-indigo-500 whitespace-nowrap w-32 min-w-[128px] max-w-[128px] shrink-0 transition-colors duration-200 ${
                                  freezeJobCardColumn 
                                    ? 'sticky left-12 z-20 bg-white dark:bg-slate-900 group-hover:bg-blue-50/80 dark:group-hover:bg-indigo-950/40 border-r-2 border-indigo-500/40 dark:border-indigo-500/60 shadow-[4px_0_12px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_16px_rgba(0,0,0,0.4)]' 
                                    : 'border-r border-slate-200 dark:border-slate-800/80 group-hover:bg-blue-50/80 dark:group-hover:bg-indigo-950/40'
                                }`}>
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-mono font-bold">{j.jobCardNo}</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedJobCardNo(expandedJobCardNo === j.jobCardNo ? null : j.jobCardNo);
                                      }}
                                      className={`p-1 rounded transition cursor-pointer ${
                                        expandedJobCardNo === j.jobCardNo 
                                          ? 'bg-indigo-600 text-white' 
                                          : 'text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/60'
                                      }`}
                                      title={expandedJobCardNo === j.jobCardNo ? "Hide job card details" : "Show job card details"}
                                    >
                                      {expandedJobCardNo === j.jobCardNo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </button>
                                  </div>
                                  {isPendingHT && (
                                    <span className="mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                                      PENDING HT
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-3 font-semibold text-slate-850 dark:text-slate-100 whitespace-nowrap leading-tight">{j.partyName}</td>
                                <td className="py-2 px-3">
                                  <span className="block font-medium truncate max-w-[120px] text-slate-800 dark:text-slate-200" title={j.itemName}>{j.itemName}</span>
                                  <span className="text-[9px] font-mono text-slate-400">{j.itemCode}</span>
                                </td>
                                <td className="py-3 px-3 font-mono font-bold">{j.orderQty.toLocaleString()}</td>
                                <td className="py-2 px-3">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingBreakdownJobCard(j);
                                    }}
                                    className="inline-flex items-center gap-1 font-mono font-extrabold text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 px-2.5 py-1 rounded-lg border border-amber-200/80 dark:border-amber-800/50 transition cursor-pointer"
                                    title="Click to view department breakdown of pending quantity (Excluding Store)"
                                  >
                                    <span>{deptPending.totalPending.toLocaleString()} KG</span>
                                    <Info className="h-3 w-3 text-amber-500 shrink-0" />
                                  </button>
                                </td>
                                <td className="py-3 px-3">
                                  {deptPending.totalPending > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleCreateSubJob(j); }}
                                      className="px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded text-[9px] font-bold uppercase hover:bg-amber-200 cursor-pointer"
                                    >
                                      Create Sub-Job
                                    </button>
                                  )}
                                </td>
                                
                                {/* Production values */}
                                <td className="py-3 px-2 bg-blue-50/10 dark:bg-blue-950/10 font-mono font-bold text-blue-700 dark:text-blue-400 border-x border-slate-200/30 text-center">{m.qtyReceivedFromProd.toLocaleString()}</td>
                                <td className="py-2 px-2 bg-blue-50/10 dark:bg-blue-950/10 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <input 
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      title="Edit Routed to Plating Quantity"
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-0.5 text-center font-mono font-medium text-blue-600 dark:text-blue-350 hover:border-slate-300 dark:hover:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
                                      value={j.customRoutedToPlating !== undefined && j.customRoutedToPlating !== null ? j.customRoutedToPlating : m.qtyRoutedToPlating}
                                      onChange={async (e) => {
                                        const clean = e.target.value.replace(/\D/g, '');
                                        const val = clean === '' ? null : Number(clean);
                                      try {
                                        await DBService.updateJobCard(j.jobCardNo, { 
                                          customRoutedToPlating: val !== null ? val : undefined 
                                        }, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                                        refreshAllStates();
                                      } catch (err) {
                                        console.error("Failed to update custom Routed Plating value", err);
                                      }
                                    }}
                                  />
                                  <span className="text-[9px] text-slate-400 font-sans">KG</span>
                                </div>
                              </td>
                              <td className="py-3 px-2 bg-blue-50/10 dark:bg-blue-950/10 font-mono text-blue-500 dark:text-blue-300 text-center border-r border-slate-200/30">{m.qtyRemainingAtProd.toLocaleString()}</td>
                              
                              {/* Plating values */}
                              <td className="py-3 px-2 bg-purple-50/10 dark:bg-purple-950/10 font-mono font-semibold text-purple-700 dark:text-purple-400 text-center">{m.qtyReceivedAtPlating.toLocaleString()}</td>
                              <td className="py-3 px-2 bg-purple-50/10 dark:bg-purple-950/10 font-mono text-purple-600 dark:text-purple-350 text-center border-x border-slate-200/30">{m.qtyRoutedToPacking.toLocaleString()}</td>
                              <td className="py-3 px-2 bg-purple-50/10 dark:bg-purple-950/10 font-mono text-purple-500 dark:text-purple-300 text-center border-r border-slate-200/30">{m.qtyRemainingAtPlating.toLocaleString()}</td>
                              
                              {/* Packing values */}
                              <td className="py-3 px-2 bg-pink-50/10 dark:bg-pink-950/10 font-mono font-semibold text-pink-700 dark:text-pink-400 text-center">{m.qtyReceivedAtPacking.toLocaleString()}</td>
                              <td className="py-3 px-2 bg-pink-50/10 dark:bg-pink-950/10 font-mono text-pink-650 dark:text-pink-350 text-center border-l border-slate-200/30">{m.qtyRoutedToStore.toLocaleString()}</td>
                              <td className="py-3 px-2 bg-pink-50/10 dark:bg-pink-950/10 font-mono text-pink-600 dark:text-pink-400 text-center border-x border-slate-200/30 text-[11px]" title={`${j.packingDetails?.pcsPerBagOrBox || 0} pcs per box`}>
                                {j.packingDetails?.totalPcs ? (
                                  <div className="flex flex-col line-tight">
                                    <span className="font-bold">{j.packingDetails.totalPcs.toLocaleString()} pcs</span>
                                    <span className="text-[9px] text-slate-400 font-sans">({j.packingDetails.pcsPerBagOrBox}/box)</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic font-sans text-[10px]">N/A</span>
                                )}
                              </td>
                              <td className="py-3 px-2 bg-pink-50/10 dark:bg-pink-950/10 font-mono text-pink-500 dark:text-pink-300 text-center border-r border-slate-200/30">{m.qtyRemainingAtPacking.toLocaleString()}</td>
                              
                              {/* Store values */}
                              <td className="py-3 px-2 bg-emerald-50/10 dark:bg-emerald-950/10 font-mono text-emerald-700 dark:text-emerald-400 text-center">{m.qtyDispatched.toLocaleString()}</td>
                              <td className="py-3 px-2 bg-emerald-50/10 dark:bg-emerald-950/10 font-mono font-bold text-emerald-600 dark:text-emerald-300 text-center border-l border-slate-200/30">{m.qtyRemainingInStock.toLocaleString()}</td>

                              <td className="py-3 px-3 font-medium text-slate-500 whitespace-nowrap">{j.currentDepartment}</td>
                              <td className="py-3 px-3 whitespace-nowrap">
                                <JobStatusBadge status={j.status} size="sm" />
                              </td>
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => setSelectedJob(j)}
                                    className="text-[10.5px] font-bold text-amber-500 hover:bg-amber-500/10 px-2.5 py-1.5 rounded transition"
                                  >
                                    Details
                                  </button>
                                  <button
                                    onClick={() => setQuickTransferJob(j)}
                                    className="text-[10.5px] font-bold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-400/15 px-2 py-1.5 rounded transition flex items-center gap-1 disabled:opacity-30 disabled:hover:bg-transparent"
                                    title="Quick Material Transfer Transit"
                                    disabled={j.currentDepartment === 'Completed'}
                                  >
                                    <ArrowUpDown className="h-3 w-3" />
                                    <span>Transfer</span>
                                  </button>
                                  {(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.department === 'Admin') && (
                                    <button
                                      onClick={() => {
                                        showConfirm(
                                          "Delete Job Card",
                                          `Are you sure you want to permanently delete Job Card ${j.jobCardNo}? This action is completely irreversible, and all related material transitions and notifications will be deleted!`,
                                          async () => {
                                            try {
                                              await DBService.deleteJobCard(j.jobCardNo, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                                              showToast(`Job Card ${j.jobCardNo} has been deleted successfully.`, "success");
                                              refreshAllStates();
                                            } catch (err: any) {
                                              console.error("Failed to delete job card", err);
                                              showToast(`Failed to delete Job Card: ${err instanceof Error ? err.message : String(err)}`, "error");
                                            }
                                          }
                                        );
                                      }}
                                      className="p-1 px-1.5 rounded text-red-500 hover:bg-red-500/10 transition"
                                      title="Admin: Delete Selected Job Card"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                              <AnimatePresence>
                                {expandedJobCardNo === j.jobCardNo && (
                                  <motion.tr
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="bg-indigo-50/40 dark:bg-slate-950/80 border-b-2 border-indigo-500/30"
                                  >
                                    <td colSpan={22} className="p-4">
                                      <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-indigo-200/80 dark:border-indigo-900/60 shadow-md space-y-3 text-xs">
                                        {/* Header Bar */}
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-150 dark:border-slate-800 pb-2.5">
                                          <div className="flex items-center gap-2">
                                            <span className="px-2.5 py-1 bg-indigo-600 text-white font-mono font-extrabold rounded-lg text-xs shadow-xs">
                                              {j.jobCardNo}
                                            </span>
                                            <JobStatusBadge status={j.status} size="sm" />
                                            {j.materialType && (
                                              <span className="px-2 py-0.5 rounded font-bold uppercase text-[10px] bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                                {j.materialType}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                                            <span>Created: <strong>{new Date(j.createdAt).toLocaleDateString()}</strong></span>
                                            <span>•</span>
                                            <span>Department: <strong className="text-indigo-600 dark:text-indigo-400">{j.currentDepartment}</strong></span>
                                          </div>
                                        </div>

                                        {/* Details Grid */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                          <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="block text-[10px] font-bold uppercase text-slate-400">Customer Party</span>
                                            <span className="font-extrabold text-slate-900 dark:text-white text-xs block truncate mt-0.5">{j.partyName}</span>
                                          </div>

                                          <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="block text-[10px] font-bold uppercase text-slate-400">Item Name & Code</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block truncate mt-0.5">{j.itemName}</span>
                                            <span className="text-[10px] font-mono text-slate-400 block">{j.itemCode || 'N/A'}</span>
                                          </div>

                                          <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="block text-[10px] font-bold uppercase text-slate-400">Target Order Qty</span>
                                            <span className="font-extrabold font-mono text-indigo-600 dark:text-indigo-400 text-xs block mt-0.5">{j.orderQty.toLocaleString()} KG</span>
                                            <span className="text-[10px] text-slate-400 block">{j.processType || 'Manufacturing'}</span>
                                          </div>

                                          <div className="bg-slate-50 dark:bg-slate-850 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                                            <span className="block text-[10px] font-bold uppercase text-slate-400">Heat Treatment & Packing</span>
                                            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block mt-0.5">
                                              HT: {j.heatTreatmentRequired ? '🔥 Required' : 'Not Required'}
                                            </span>
                                            {j.packingDetails?.pcsPerBagOrBox ? (
                                              <span className="text-[10px] text-pink-600 dark:text-pink-400 block font-mono">
                                                Packing: {j.packingDetails.pcsPerBagOrBox} pcs/box ({j.packingDetails.totalPcs?.toLocaleString()} total)
                                              </span>
                                            ) : (
                                              <span className="text-[10px] text-slate-400 block">Standard Bag/Box</span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Job Card Material Movement Logs */}
                                        <div className="pt-3 border-t border-slate-150 dark:border-slate-800 space-y-2">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                              <ArrowUpDown className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                              <span className="font-extrabold text-[11px] uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                                Material Movement Logs ({movements.filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase()).length})
                                              </span>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-mono">
                                              Job Card #{j.jobCardNo} History
                                            </span>
                                          </div>

                                          {movements.filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase()).length === 0 ? (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg text-slate-400 text-[11px] italic text-center border border-slate-100 dark:border-slate-800">
                                              No material movements logged yet for this job card.
                                            </div>
                                          ) : (
                                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                              <table className="w-full text-left text-[11px]">
                                                <thead className="bg-slate-100 dark:bg-slate-850 font-mono text-[10px] uppercase text-slate-500">
                                                  <tr>
                                                    <th className="py-2 px-2.5">Ref ID</th>
                                                    <th className="py-2 px-2.5">Route</th>
                                                    <th className="py-2 px-2.5 text-right">Qty</th>
                                                    <th className="py-2 px-2.5">Transferred By</th>
                                                    <th className="py-2 px-2.5 text-center">Status</th>
                                                    <th className="py-2 px-2.5 text-right">Date & Time</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-150 dark:divide-slate-800 font-sans">
                                                  {movements
                                                    .filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase())
                                                    .map(m => (
                                                      <tr key={m.movementId} className="hover:bg-slate-50 dark:hover:bg-slate-850/50">
                                                        <td className="py-1.5 px-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">{m.movementId}</td>
                                                        <td className="py-1.5 px-2.5 font-semibold text-slate-700 dark:text-slate-300">
                                                          <span className="flex items-center gap-1">
                                                            {m.fromDepartment} <ArrowRight className="h-3 w-3 text-slate-400 inline" /> <span className="text-emerald-600 dark:text-emerald-400">{m.toDepartment}</span>
                                                          </span>
                                                        </td>
                                                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                                                          {m.quantity.toLocaleString()} {m.requestedUnit || j.unit || 'KG'}
                                                        </td>
                                                        <td className="py-1.5 px-2.5 text-slate-600 dark:text-slate-400">{m.transferBy}</td>
                                                        <td className="py-1.5 px-2.5 text-center">
                                                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                            m.accepted 
                                                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' 
                                                              : m.remarks?.toLowerCase().includes('reject')
                                                              ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                                              : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                                                          }`}>
                                                            {m.accepted ? 'Accepted' : (m.remarks?.toLowerCase().includes('reject') ? 'Rejected' : 'Pending')}
                                                          </span>
                                                        </td>
                                                        <td className="py-1.5 px-2.5 text-right font-mono text-[10px] text-slate-400 whitespace-nowrap">
                                                          {new Date(m.transferDate).toLocaleDateString()} {new Date(m.transferDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-150 dark:border-slate-800">
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedJob(j);
                                              }}
                                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1"
                                            >
                                              <FileText className="h-3.5 w-3.5" />
                                              <span>Full Modal View</span>
                                            </button>

                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setQuickTransferJob(j);
                                              }}
                                              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1 disabled:opacity-40"
                                              disabled={j.currentDepartment === 'Completed'}
                                            >
                                              <ArrowUpDown className="h-3.5 w-3.5 text-indigo-500" />
                                              <span>Material Transfer</span>
                                            </button>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedJobCardNo(null);
                                            }}
                                            className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg text-xs transition cursor-pointer flex items-center gap-1"
                                          >
                                            <ChevronUp className="h-3.5 w-3.5" />
                                            <span>Hide Details</span>
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </motion.tr>
                                )}
                              </AnimatePresence>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {filteredAllOrders.length > 100 && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-150 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[11px] flex flex-col sm:flex-row justify-between items-center gap-1.5 font-sans">
                      <span>
                        Showing first <strong>100</strong> active cards of <strong>{filteredAllOrders.length.toLocaleString()}</strong> matching items.
                      </span>
                      <span className="font-semibold text-indigo-500 font-mono text-[9px] uppercase tracking-wide bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-150 dark:border-indigo-900/40 animate-pulse">
                        Virtualized Rendering Active
                      </span>
                    </div>
                  )}
                </div>

                {/* Mobile View: Cards */}
                <div className={`${mobileViewMode === 'cards' ? 'block' : 'hidden'} md:hidden divide-y divide-slate-150 dark:divide-slate-800 bg-white dark:bg-slate-900 relative pb-20 lg:pb-0`}>
                  
                  {/* Sticky Sort Bar */}
                  <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-150 dark:border-slate-800 p-3 px-4 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wide">
                      <ArrowUpDown className="h-3.5 w-3.5 text-amber-500" />
                      <span>Sort By</span>
                    </div>
                    <select
                      value={mobileSortBy}
                      onChange={(e) => setMobileSortBy(e.target.value as any)}
                      className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="Priority">Priority</option>
                      <option value="Newest">Newest</option>
                      <option value="Department">Department</option>
                    </select>
                  </div>

                  {getSortedMobileOrders().length === 0 ? (
                    <div className="text-center p-8 space-y-1.5">
                      <span className="text-xl">🔍</span>
                      <p className="text-xs font-semibold text-slate-400 font-mono">No matching Job Cards found</p>
                    </div>
                  ) : (
                    getSortedMobileOrders().slice(0, 100).map(j => {
                      const m = getJobCardProcessMetrics(j, movements);
                      const deptPending = getJobCardDepartmentPending(j, movements);
                      
                      return (
                        <div key={j.jobCardNo} className="p-4 space-y-3">
                          {/* Card Header: Job Card No & Status */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 font-mono text-xs">
                              <input 
                                type="checkbox"
                                checked={selectedJobCardNos.includes(j.jobCardNo)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedJobCardNos(prev => [...prev, j.jobCardNo]);
                                  } else {
                                    setSelectedJobCardNos(prev => prev.filter(no => no !== j.jobCardNo));
                                  }
                                }}
                                className="rounded border-slate-350 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer accent-indigo-600 shrink-0"
                              />
                              <span className="font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded">
                                {j.jobCardNo}
                              </span>
                              <span className="text-[10px] text-slate-400 font-medium">
                                @ {j.currentDepartment}
                              </span>
                            </div>
                            <JobStatusBadge status={j.status} size="xs" />
                          </div>

                          {/* Party and Item Details */}
                          <div>
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">
                              {j.partyName}
                            </h4>
                            <p className="text-xs text-slate-600 dark:text-slate-350 mt-0.5">
                              {j.itemName} <span className="text-[10px] font-mono text-slate-400">({j.itemCode})</span>
                            </p>
                          </div>

                          {/* Quantities & Mini Stage Tracker */}
                          <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-100 dark:border-slate-850 text-[11px]">
                            <div>
                              <span className="block text-[9px] text-slate-400 uppercase font-bold">Target Weight</span>
                              <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{j.orderQty.toLocaleString()} KG</span>
                            </div>
                            <div 
                              onClick={() => setPendingBreakdownJobCard(j)}
                              className="cursor-pointer group"
                            >
                              <span className="block text-[9px] text-amber-600 dark:text-amber-400 uppercase font-bold flex items-center gap-1">
                                <span>Pending (Prod-Pack)</span>
                                <Info className="h-2.5 w-2.5" />
                              </span>
                              <span className="font-extrabold font-mono text-amber-700 dark:text-amber-300 group-hover:underline">
                                {deptPending.totalPending.toLocaleString()} KG
                              </span>
                            </div>
                          </div>

                          {/* Stages Progress Indicator */}
                          <div className="space-y-1.5 pt-1">
                            <span className="block text-[9px] text-slate-400 uppercase font-bold tracking-wider">Line Progress Ledger</span>
                            <div className="grid grid-cols-4 gap-1.5 text-center text-[9px] font-mono">
                              <div className="bg-blue-50/50 dark:bg-blue-950/20 p-1.5 rounded border border-blue-100/30">
                                <span className="block text-[8px] text-blue-800 dark:text-blue-300 font-bold uppercase">PROD</span>
                                <span className="block font-bold text-slate-700 dark:text-slate-300">{m.qtyRemainingAtProd.toLocaleString()}</span>
                              </div>
                              <div className="bg-purple-50/50 dark:bg-purple-950/20 p-1.5 rounded border border-purple-100/30">
                                <span className="block text-[8px] text-purple-800 dark:text-purple-300 font-bold uppercase">PLAT</span>
                                <span className="block font-bold text-slate-700 dark:text-slate-300">{m.qtyRemainingAtPlating.toLocaleString()}</span>
                              </div>
                              <div className="bg-pink-50/50 dark:bg-pink-950/20 p-1.5 rounded border border-pink-100/30">
                                <span className="block text-[8px] text-pink-800 dark:text-pink-300 font-bold uppercase">PACK</span>
                                <span className="block font-bold text-slate-700 dark:text-slate-300">{m.qtyRemainingAtPacking.toLocaleString()}</span>
                              </div>
                              <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-1.5 rounded border border-emerald-100/30">
                                <span className="block text-[8px] text-emerald-800 dark:text-emerald-300 font-bold uppercase">STOCK</span>
                                <span className="block font-bold text-slate-700 dark:text-slate-300">{m.qtyRemainingInStock.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          {/* Actions */}
                          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                            {deptPending.totalPending > 0 ? (
                              <button
                                onClick={() => handleCreateSubJob(j)}
                                className="flex-1 min-h-[44px] px-3 bg-amber-50 dark:bg-amber-950/40 text-amber-850 dark:text-amber-300 border border-amber-200/50 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-amber-100 transition flex items-center justify-center gap-1 cursor-pointer"
                              >
                                Sub-Job
                              </button>
                            ) : (
                              <div className="flex-1 min-h-[44px] bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border border-emerald-150/30 rounded-xl text-xs font-bold uppercase tracking-wide flex items-center justify-center">
                                Routed
                              </div>
                            )}

                            <button
                              onClick={() => setExpandedJobCardNo(expandedJobCardNo === j.jobCardNo ? null : j.jobCardNo)}
                              className={`flex-1 min-h-[44px] px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                                expandedJobCardNo === j.jobCardNo
                                  ? 'bg-indigo-600 text-white shadow-xs'
                                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100'
                              }`}
                            >
                              {expandedJobCardNo === j.jobCardNo ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              <span>{expandedJobCardNo === j.jobCardNo ? 'Hide' : 'Details'}</span>
                            </button>

                            <button
                              onClick={() => setQuickTransferJob(j)}
                              className="flex-1 min-h-[44px] px-3 bg-[#3B82F6] hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-30 disabled:hover:bg-[#3B82F6]"
                              disabled={j.currentDepartment === 'Completed'}
                            >
                              <ArrowUpDown className="h-3.5 w-3.5" />
                              <span>Transfer</span>
                            </button>

                            {(currentUser?.role === 'admin' || currentUser?.role === 'super_admin' || currentUser?.department === 'Admin') && (
                              <button
                                onClick={() => {
                                  showConfirm(
                                    "Delete Job Card",
                                    `Are you sure you want to permanently delete Job Card ${j.jobCardNo}? This action is completely irreversible, and all related material transitions and notifications will be deleted!`,
                                    async () => {
                                      try {
                                        await DBService.deleteJobCard(j.jobCardNo, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                                        showToast(`Job Card ${j.jobCardNo} has been deleted successfully.`, "success");
                                        refreshAllStates();
                                      } catch (err: any) {
                                        console.error("Failed to delete job card", err);
                                        showToast(`Failed to delete Job Card: ${err instanceof Error ? err.message : String(err)}`, "error");
                                      }
                                    }
                                  );
                                }}
                                className="min-h-[44px] w-12 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-450 rounded-xl border border-rose-200/40 flex items-center justify-center transition cursor-pointer"
                                title="Admin: Delete Selected Job Card"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          {/* Expandable Mobile Card Details */}
                          <AnimatePresence>
                            {expandedJobCardNo === j.jobCardNo && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="p-3.5 bg-indigo-50/70 dark:bg-slate-950/90 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 space-y-2.5 text-xs shadow-xs"
                              >
                                <div className="flex items-center justify-between border-b border-indigo-150 dark:border-indigo-900/40 pb-2">
                                  <div className="flex items-center gap-1.5 font-mono font-bold text-indigo-700 dark:text-indigo-300">
                                    <FileText className="h-3.5 w-3.5 text-indigo-500" />
                                    <span>{j.jobCardNo} Details</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-500">{new Date(j.createdAt).toLocaleDateString()}</span>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                  <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Material Spec</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{j.materialType || 'Standard Grade'}</span>
                                  </div>

                                  <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Heat Treatment</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{j.heatTreatmentRequired ? '🔥 Required' : 'Not Required'}</span>
                                  </div>

                                  <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Process Type</span>
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">{j.processType || 'Manufacturing'}</span>
                                  </div>

                                  <div className="bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-100 dark:border-slate-800">
                                    <span className="text-[9px] text-slate-400 font-bold uppercase block">Packing Specs</span>
                                    <span className="font-semibold text-pink-600 dark:text-pink-400 font-mono">
                                      {j.packingDetails?.pcsPerBagOrBox ? `${j.packingDetails.pcsPerBagOrBox} pcs/box` : 'Standard'}
                                    </span>
                                  </div>
                                </div>

                                {/* Movement Logs for Mobile Card */}
                                <div className="pt-2 border-t border-indigo-150 dark:border-indigo-900/40 space-y-2">
                                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 dark:text-slate-200">
                                    <div className="flex items-center gap-1">
                                      <ArrowUpDown className="h-3.5 w-3.5 text-emerald-500" />
                                      <span>Movement Logs ({movements.filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase()).length})</span>
                                    </div>
                                  </div>

                                  {movements.filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase()).length === 0 ? (
                                    <div className="p-2 bg-white/60 dark:bg-slate-900/60 rounded-xl text-slate-400 text-[10px] italic text-center">
                                      No movement history
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                      {movements
                                        .filter(m => m.jobCardNo.toLowerCase() === j.jobCardNo.toLowerCase())
                                        .map(m => (
                                          <div key={m.movementId} className="p-2 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-slate-100 dark:border-slate-800 text-[10px] space-y-1">
                                            <div className="flex items-center justify-between font-mono">
                                              <span className="font-bold text-emerald-600 dark:text-emerald-400">{m.movementId}</span>
                                              <span className="text-slate-400">{new Date(m.transferDate).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-medium">
                                              <span>{m.fromDepartment} &rarr; {m.toDepartment}</span>
                                              <span className="font-bold font-mono text-slate-900 dark:text-white">{m.quantity} {m.requestedUnit || j.unit || 'KG'}</span>
                                            </div>
                                          </div>
                                        ))}
                                    </div>
                                  )}
                                </div>

                                <div className="pt-2 border-t border-indigo-150 dark:border-indigo-900/40 flex items-center justify-between">
                                  <button
                                    type="button"
                                    onClick={() => setExpandedJobCardNo(null)}
                                    className="text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer flex items-center gap-1"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                    <span>Hide</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setSelectedJob(j)}
                                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 underline cursor-pointer flex items-center gap-1"
                                  >
                                    <span>Open Full Sheet &rarr;</span>
                                  </button>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })
                  )}
                  {getSortedMobileOrders().length > 100 && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-150 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[11px] flex flex-col sm:flex-row justify-between items-center gap-1.5 font-sans">
                      <span>
                        Showing first <strong>100</strong> active cards of <strong>{getSortedMobileOrders().length.toLocaleString()}</strong> matching items.
                      </span>
                      <span className="font-semibold text-indigo-500 font-mono text-[9px] uppercase tracking-wide bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-150 dark:border-indigo-900/40 animate-pulse">
                        Virtualized Rendering Active
                      </span>
                    </div>
                  )}
                </div>

                {/* MATERIAL MOVEMENTS SEARCH RESULTS LEDGER SECTION */}
                {allOrdersSearchScope === 'movements' && filteredMovements.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2">
                        <ArrowUpDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          Material Movements & Transfer Logs ({filteredMovements.length})
                        </h4>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Instant offline query on local transit records
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase tracking-wider font-mono border-b border-slate-200 dark:border-slate-800">
                            <th className="py-2.5 px-3">Ref ID</th>
                            <th className="py-2.5 px-3">Job Card</th>
                            <th className="py-2.5 px-3">Party & Item</th>
                            <th className="py-2.5 px-3">Transit Route</th>
                            <th className="py-2.5 px-3 text-right">Quantity</th>
                            <th className="py-2.5 px-3">Transfer By</th>
                            <th className="py-2.5 px-3 text-center">Status</th>
                            <th className="py-2.5 px-3 text-right">Date & Time</th>
                            <th className="py-2.5 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 dark:divide-slate-800 font-sans">
                          {filteredMovements.slice(0, 50).map(m => {
                            const parentJob = jobCards.find(j => j.jobCardNo.toLowerCase() === m.jobCardNo.toLowerCase());
                            const isRejected = m.remarks?.toLowerCase().includes('reject');

                            return (
                              <tr key={m.movementId} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition">
                                <td className="py-2.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">{m.movementId}</td>
                                <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">{m.jobCardNo}</td>
                                <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">
                                  {parentJob ? (
                                    <div>
                                      <div className="font-bold truncate max-w-[160px]">{parentJob.itemName}</div>
                                      <div className="text-[10px] text-slate-400 truncate max-w-[160px]">{parentJob.partyName}</div>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">N/A</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                                  <div className="flex items-center gap-1">
                                    <span>{m.fromDepartment}</span>
                                    <ArrowRight className="h-3 w-3 text-slate-400" />
                                    <span className="text-emerald-600 dark:text-emerald-400">{m.toDepartment}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono font-bold text-right text-slate-800 dark:text-slate-100">
                                  {m.quantity.toLocaleString()} {m.requestedUnit || parentJob?.unit || 'KGS'}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{m.transferBy}</td>
                                <td className="py-2.5 px-3 text-center">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                    m.accepted
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                                      : isRejected
                                      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                                      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                                  }`}>
                                    {m.accepted ? 'Accepted' : (isRejected ? 'Rejected' : 'Pending')}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right text-[10px] text-slate-400 whitespace-nowrap">
                                  {new Date(m.transferDate).toLocaleDateString()} {new Date(m.transferDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {parentJob ? (
                                    <button
                                      onClick={() => setSelectedJob(parentJob)}
                                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 hover:underline cursor-pointer"
                                    >
                                      View Job
                                    </button>
                                  ) : (
                                    <span className="text-slate-400 text-[10px]">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

            </div>
          );
          })()}

          {/* REAL TIME LOGS MOVEMENT LEDGER VIEW */}
          {activeTab === 'timeline-live' && (
            <div className="space-y-4">
              <div className="px-1">
                <h3 className="font-sans font-bold text-lg text-slate-850 dark:text-white uppercase tracking-wider">
                  Real-Time Chronological Transit Ledger
                </h3>
                <p className="text-xs text-slate-400 italic">Continuous live logging capturing exact component coordinates</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Movement list column */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
                  <h4 className="font-sans font-bold text-sm uppercase tracking-wider text-slate-500 border-b pb-2 mb-2">
                    Chronological Queue Transfers Ledger
                  </h4>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto">
                    {movements.map((mov, mIdx) => (
                      <div 
                        key={mov.movementId}
                        className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl space-y-2 text-xs hover:border-slate-350"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-mono font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded text-[10px]">
                            {mov.jobCardNo}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(mov.transferDate).toLocaleDateString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>

                        <p className="font-semibold text-slate-800 dark:text-slate-200">
                          {mov.fromDepartment} → {mov.toDepartment}
                        </p>

                        <div className="flex justify-between items-center font-mono text-[10px] text-slate-500 mt-1">
                          <span>Mass moved: <strong>{mov.quantity} KG</strong></span>
                          <span>Billed By: {mov.transferBy}</span>
                        </div>

                        {mov.accepted ? (
                          <div className="text-[9px] bg-emerald-500/10 text-emerald-600 font-bold p-1 rounded flex items-center gap-1 mt-1">
                            ✔️ Custody accepted by {mov.acceptedBy} on {new Date(mov.acceptedDate!).toLocaleDateString([], {hour:'2-digit', minute:'2-digit'})}
                          </div>
                        ) : (
                          <div className="text-[9px] bg-purple-500/10 text-purple-600 font-bold p-1 rounded flex items-center gap-1 mt-1">
                            ⌛ Transit verification pending at downstream
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Active live Trace visual selection of last card */}
                <div className="space-y-4">
                  <div className="p-4 bg-slate-900 border border-slate-800 text-white rounded-xl">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-1.5 col-span-2">
                      Interactive Live Trace Inspector
                    </h4>
                    <p className="text-[11px] text-slate-400 leading-normal">
                      Select any active manufacturing batch from the drop-down below to visualize their position in the 7-node chain.
                    </p>
                    
                    <div className="relative mt-3">
                      <select
                        onChange={(e) => handleSelectJobByNo(e.target.value)}
                        className="w-full bg-slate-800 text-white text-xs py-2 px-3 pr-8 rounded border border-slate-700 font-mono cursor-pointer"
                      >
                        <option value="">-- Select Active Job Card (Showing max 500) --</option>
                        {jobCards.slice(0, 500).map(c => (
                          <option key={c.jobCardNo} value={c.jobCardNo}>
                            [{c.jobCardNo}] - {c.itemName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {jobCards.length > 0 && (
                    <TimelineVisual 
                      jobCard={jobCards[0]} 
                      movements={movements.filter(m => m.jobCardNo.toLowerCase() === jobCards[0].jobCardNo.toLowerCase())} 
                    />
                  )}
                </div>

              </div>
            </div>
          )}

          {/* PROCESS OUTSOURCING VIEW */}
          {activeTab === 'outsource' && (
            <OutsourceManager
              currentUser={currentUser}
              users={users}
              jobCards={jobCards}
              onRefreshData={refreshAllStates}
              showToast={showToast}
            />
          )}

          {/* REPORTS EXPORT VIEW */}
          {activeTab === 'reports' && (
            <ReportView 
              jobCards={jobCards}
              movements={movements}
              onCreateMovement={handleCreateMovement}
              currentUser={currentUser}
            />
          )}

          {/* ADMINISTRATOR CONSOLE PORTAL */}
          {activeTab === 'admin-users' && (
            <AdminConsole 
              users={users}
              auditLogs={auditLogs}
              onSaveUser={handleSaveUserProfile}
              onLogAction={handleLogActionExternally}
              currentUser={currentUser}
              onDeleteUser={handleDeleteUserProfile}
              jobCards={jobCards}
              movements={movements}
              onRefreshJobs={refreshAllStates}
              companyConfig={companyConfig}
              onRefreshCompany={refreshAllStates}
              isSheetsActive={isSheetsActive}
              sheetsDetails={sheetsDetails}
              onOpenSheetsModal={() => setShowSheetsModal(true)}
              onDisconnectSheets={handleDisconnectGoogleSheets}
              onOpenSheetsInspector={() => setShowSheetsInspector(true)}
              onSetJobCards={setJobCards}
              onUpdateMovement={handleUpdateMovement}
              onDeleteMovement={handleDeleteMovement}
            />
          )}
            </motion.div>
          </AnimatePresence>

        </div>

        {/* PERSISTENT APP LEDGER FOOTER / STATUS BAR */}
        <footer className="bg-slate-900 border-t border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs text-slate-300 shrink-0 select-none print:hidden z-10">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-semibold text-slate-400">
              <Database className="h-3.5 w-3.5 text-[#3B82F6]" />
              <span>Mfg Ledger: v2.5</span>
            </span>
            <span className="h-3 w-[1px] bg-slate-700 hidden sm:inline" />
            <div className="hidden sm:flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
              <span className="text-slate-400 font-mono text-[11px]">
                {isOnline ? 'Cloud Synced' : 'Offline Mode Active'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Sync Queue Visual Indicator */}
            {syncQueue.length > 0 ? (
              <button
                onClick={() => setShowSyncDrawer(true)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all duration-200 cursor-pointer ${
                  syncQueue.some(item => item.status === 'failed')
                    ? 'bg-rose-950/45 hover:bg-rose-950/60 text-rose-350 border-rose-900/50'
                    : 'bg-amber-950/35 hover:bg-amber-950/50 text-amber-300 border-amber-900/50'
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${syncQueue.some(item => item.status === 'pending') ? 'animate-spin' : ''}`} />
                <span>
                  {syncQueue.filter(item => item.status === 'pending' || item.status === 'failed').length} Pending Syncs
                </span>
                <ChevronUp className="h-3 w-3 ml-0.5" />
              </button>
            ) : (
              <span className="text-slate-500 flex items-center gap-1 text-[11px] font-medium font-sans">
                ✓ Sync Queue Empty
              </span>
            )}

            {syncQueue.length > 0 && (
              <button
                onClick={handleManualRetryAll}
                className="px-2.5 py-1.5 rounded-lg bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25 border border-[#3B82F6]/30 text-[#3B82F6] hover:text-[#60A5FA] text-[10.5px] font-bold transition-all cursor-pointer"
              >
                Sync All
              </button>
            )}
          </div>
        </footer>

        {/* PERSISTENT ANCHORED MOBILE BOTTOM NAVIGATION BAR */}
        <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/90 dark:border-slate-800/90 flex items-center justify-around z-40 lg:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_25px_rgba(0,0,0,0.4)] select-none print:hidden px-3 pb-safe">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              setActiveTab('dashboard');
              setSelectedJobCardNos([]);
            }}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-2xl transition-all duration-200 cursor-pointer min-w-[54px] sm:min-w-[68px] ${
              activeTab === 'dashboard'
                ? 'text-[#3B82F6] font-bold'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
            }`}
          >
            {activeTab === 'dashboard' && (
              <motion.div
                layoutId="activeBottomTabPill"
                className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Factory className={`h-5 w-5 transition-transform duration-200 ${activeTab === 'dashboard' ? 'scale-110 text-[#3B82F6]' : ''}`} />
            <span className="text-[9.5px] sm:text-[10px] tracking-tight">Dashboard</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              setActiveTab('all-orders');
              setSelectedJobCardNos([]);
            }}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-2xl transition-all duration-200 cursor-pointer min-w-[54px] sm:min-w-[68px] ${
              activeTab === 'all-orders'
                ? 'text-[#3B82F6] font-bold'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
            }`}
          >
            {activeTab === 'all-orders' && (
              <motion.div
                layoutId="activeBottomTabPill"
                className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <FileText className={`h-5 w-5 transition-transform duration-200 ${activeTab === 'all-orders' ? 'scale-110 text-[#3B82F6]' : ''}`} />
            <span className="text-[9.5px] sm:text-[10px] tracking-tight">Orders</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              setActiveTab('outsource');
              setSelectedJobCardNos([]);
            }}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-2xl transition-all duration-200 cursor-pointer min-w-[56px] sm:min-w-[68px] ${
              activeTab === 'outsource'
                ? 'text-[#3B82F6] font-bold'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
            }`}
          >
            {activeTab === 'outsource' && (
              <motion.div
                layoutId="activeBottomTabPill"
                className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Truck className={`h-5 w-5 transition-transform duration-200 ${activeTab === 'outsource' ? 'scale-110 text-[#3B82F6]' : ''}`} />
            <span className="text-[9.5px] sm:text-[10px] tracking-tight">Outsource</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              setActiveTab('timeline-live');
              setSelectedJobCardNos([]);
            }}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-2xl transition-all duration-200 cursor-pointer min-w-[56px] sm:min-w-[68px] ${
              activeTab === 'timeline-live'
                ? 'text-[#3B82F6] font-bold'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium'
            }`}
          >
            {activeTab === 'timeline-live' && (
              <motion.div
                layoutId="activeBottomTabPill"
                className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/60 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl -z-10 shadow-xs"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Activity className={`h-5 w-5 transition-transform duration-200 ${activeTab === 'timeline-live' ? 'scale-110 text-[#3B82F6]' : ''}`} />
            <span className="text-[10px] tracking-tight">Timeline</span>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setSidebarOpen(true)}
            className="relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded-2xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 font-medium transition-all duration-200 cursor-pointer min-w-[54px] sm:min-w-[68px]"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[9.5px] sm:text-[10px] tracking-tight">Menu</span>
          </motion.button>
        </nav>
      </main>

      {/* ======================================================== */}
      {/* 3. MODALS AND DETAILS OVERLAY DRAWERS */}
      {/* ======================================================== */}
      
      {/* QR Code Scanner Modal */}
      <ScannerModal 
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        jobCards={jobCards}
        onSelectJobCard={handleSelectJobByNo}
      />
      
      {/* Global Offline Search Modal */}
      <GlobalSearchModal
        isOpen={showGlobalSearchModal}
        onClose={() => setShowGlobalSearchModal(false)}
        jobCards={jobCards}
        movements={movements}
        onSelectJobCard={(job) => setSelectedJob(job)}
        isOnline={isOnline}
      />

      {/* Job Card Detailed Drill overlay */}
      {selectedJob && (
        <JobCardDetailsModal 
          isOpen={!!selectedJob}
          onClose={() => setSelectedJob(null)}
          jobCard={selectedJob}
          movements={movements}
          currentUser={currentUser}
          companyConfig={companyConfig}
          onUploadAttachment={handleUploadAttachment}
          onDeleteAttachment={handleDeleteAttachment}
        />
      )}

      {/* Quick Material Transit Transfer Modal */}
      <QuickTransferModal
        isOpen={!!quickTransferJob}
        onClose={() => setQuickTransferJob(null)}
        jobCard={quickTransferJob}
        movements={movements}
        currentUser={currentUser}
        onSubmit={handleCreateMovement}
      />

      {/* Bulk Material Transit Transfer Modal */}
      <BulkTransferModal
        isOpen={showBulkTransferModal}
        onClose={() => setShowBulkTransferModal(false)}
        selectedJobCards={jobCards.filter(j => selectedJobCardNos.includes(j.jobCardNo))}
        movements={movements}
        currentUser={currentUser}
        onSubmit={handleBulkTransfer}
      />

      {/* Bulk Manifest Printing Modal */}
      <BulkPrintManifestModal
        isOpen={showBulkPrintModal}
        onClose={() => setShowBulkPrintModal(false)}
        selectedJobCards={jobCards.filter(j => selectedJobCardNos.includes(j.jobCardNo))}
        movements={movements}
        currentUser={currentUser}
      />

      {/* Bulk Status Update Modal */}
      <BulkStatusUpdateModal
        isOpen={showBulkStatusModal}
        onClose={() => setShowBulkStatusModal(false)}
        selectedJobNos={selectedJobCardNos}
        onConfirmUpdate={handleConfirmBulkStatusUpdate}
      />

      {/* Google Sheets Sync Setup Modal */}
      {showSheetsModal && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative font-sans">
            <button 
              onClick={() => { setShowSheetsModal(false); setSheetsFeedback(''); }}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition cursor-pointer"
              id="btn_close_sheets_modal"
            >
              <X className="h-5 w-5" />
            </button>
            
            <div className="flex items-center gap-3 border-b pb-4 mb-4">
              <div className="h-10 w-10 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <FileSpreadsheet className="h-6 w-6" id="header_sheets_icon" />
              </div>
              <div>
                <h3 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Spreadsheet Logs & Exporter</h3>
                <p className="text-[11px] text-slate-400 font-medium">Manage cloud syncer and offline Excel-ready spreadsheet files</p>
              </div>
            </div>

            {/* Tabs for Google Sheets vs Local Excel/CSV export */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 mb-5 font-sans text-xs">
              <button
                onClick={() => setSheetsModalTab('cloud')}
                className={`flex-1 pb-2.5 font-bold border-b-2 text-center transition cursor-pointer ${
                  sheetsModalTab === 'cloud'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-350'
                }`}
              >
                ☁️ Google Sheets (Cloud Sync)
              </button>
              <button
                onClick={() => setSheetsModalTab('offline')}
                className={`flex-1 pb-2.5 font-bold border-b-2 text-center transition cursor-pointer ${
                  sheetsModalTab === 'offline'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-350'
                }`}
              >
                📊 Excel Ledger Export (Offline)
              </button>
            </div>

            {sheetsModalTab === 'cloud' ? (
              <div className="space-y-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-sans">
                <p>
                  Link your Google Sheets account to sync all transactions, movements, and rejections dynamically:
                </p>
                
                <ul className="list-disc pl-5 space-y-2 text-slate-500 font-sans">
                  <li>Records new Customer Job Cards & Route Targets automatically.</li>
                  <li>Logs step-by-step Department records (Heat Treatment, Plating, Packing, Warehouse).</li>
                  <li>Calculates and logs Furnace, Coating, and Boxing rejections (KG weight metrics).</li>
                  <li>Inserts audit action timestamps and personnel sign-off names.</li>
                </ul>

                {sheetsFeedback && (
                  sheetsFeedback.includes('Error') || sheetsFeedback.includes('failed') || sheetsFeedback.includes('Failed') ? (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-lg text-xs border border-rose-200 dark:border-rose-900/40 font-sans space-y-1.5 shadow-xs">
                      <div className="flex items-center gap-2 font-bold">
                        <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
                        <span>Domain Authorization Issue</span>
                      </div>
                      <p className="whitespace-pre-line font-mono text-[10px] leading-relaxed">
                        {sheetsFeedback}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-[#3B82F6] dark:text-blue-400 rounded-lg text-xs font-semibold border border-blue-200 dark:border-blue-900/40 flex items-center gap-2 font-mono">
                      <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping shrink-0" />
                      <span>{sheetsFeedback}</span>
                    </div>
                  )
                )}

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    onClick={handleConnectGoogleSheets}
                    className="w-full bg-[#107C41] hover:bg-[#0B592E] text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 shadow-sm transition uppercase tracking-wider text-[11px] font-mono cursor-pointer border border-[#0B5927]"
                    id="btn_auth_sheets"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    <span>Link via Google Account</span>
                  </button>
                  {showEmulatedSheetsBtn && (
                    <button
                      onClick={handleConnectEmulatedSheets}
                      className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 shadow-sm transition uppercase tracking-wider text-[11px] font-mono cursor-pointer border border-slate-200 dark:border-slate-700 animate-pulse"
                      id="btn_emulate_sheets"
                    >
                      <Layers className="h-4 w-4 text-[#107C41]" />
                      <span>Use Sandbox Emulation Fallback</span>
                    </button>
                  )}
                  <p className="text-[9.5px] text-center text-slate-450 font-light pt-1">
                    Secure OAuth token integration. Google Sheets permission is sandbox restricted to spreadsheets created by this app.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-xs leading-relaxed font-sans">
                <p className="text-slate-600 dark:text-slate-400">
                  Generate and download standard offline Excel-ready spreadsheet files of any data collection instantly:
                </p>

                {/* Primary Multi-Sheet Excel Backup Button */}
                <button
                  onClick={() => exportComprehensiveExcelBackup(jobCards, movements, auditLogs)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold p-3.5 rounded-xl flex items-center justify-between gap-3 shadow-md transition cursor-pointer border border-emerald-500"
                >
                  <div className="flex items-center gap-2.5 text-left">
                    <FileSpreadsheet className="h-5 w-5 shrink-0" />
                    <div>
                      <span className="block font-bold text-sm">Download Complete Excel Backup (.xlsx)</span>
                      <span className="block text-[11px] font-normal text-emerald-100">
                        Generates a single workbook with a SEPARATE SHEET for every report (Job Cards, Movements, Production, HT, Plating, Packing, Warehouse Stock, RM Store, Dispatch, Rejection Analysis, etc.)
                      </span>
                    </div>
                  </div>
                  <Download className="h-4 w-4 shrink-0" />
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={() => exportJobCards(jobCards)}
                    className="flex flex-col items-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1 text-[11.5px]">
                      📑 Job Cards Ledger
                    </span>
                    <span className="text-[10px] text-slate-400">Download customer orders and line statuses.</span>
                  </button>

                  <button
                    onClick={() => exportDepartmentUpdates(jobCards)}
                    className="flex flex-col items-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1 text-[11.5px]">
                      ⚡ Process & Rejections
                    </span>
                    <span className="text-[10px] text-slate-400">Download logs of hardness, temperature, plating and packing.</span>
                  </button>

                  <button
                    onClick={() => exportMaterialMovements(movements)}
                    className="flex flex-col items-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1 text-[11.5px]">
                      🔄 Custody & Movements
                    </span>
                    <span className="text-[10px] text-slate-400">Download the complete material transfer trail logs.</span>
                  </button>

                  <button
                    onClick={() => exportAuditLogs(auditLogs)}
                    className="flex flex-col items-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left transition cursor-pointer"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1 text-[11.5px]">
                      🛡️ Actions & Audits
                    </span>
                    <span className="text-[10px] text-slate-400">Download staff logins and database update log trails.</span>
                  </button>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
                  <p className="text-[10px] text-slate-400">
                    No sign-in required. Downloads are processed entirely inside your local sandbox.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Google Sheets Live Data Inspector Overlay Modal */}
      {showSheetsInspector && (
        <GoogleSheetViewer
          onClose={() => setShowSheetsInspector(false)}
          spreadsheetName={sheetsDetails.name || undefined}
          spreadsheetUrl={sheetsDetails.url || undefined}
        />
      )}

      {/* Custom Confirmation Dialog Overlay */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              ⚠️ {confirmDialog.title}
            </h3>
            <p className="text-sm text-slate-605 dark:text-slate-300 mt-3 whitespace-pre-wrap leading-relaxed">
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                {confirmDialog.cancelText || 'Cancel'}
              </button>
              <button
                onClick={async () => {
                  const onConf = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await onConf();
                }}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition shadow-md hover:shadow-lg cursor-pointer"
              >
                {confirmDialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Sync Queue Details Drawer Modal */}
      {showSyncDrawer && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-end justify-center p-0 z-50 animate-fade-in print:hidden" onClick={() => setShowSyncDrawer(false)}>
          <div 
            className="bg-white dark:bg-slate-905 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl w-full max-w-4xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0 select-none">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 rounded-lg text-blue-600 dark:text-blue-400">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Offline Sync Queue Ledger
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Traceability transactions captured offline in your secure browser persistent cache.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {syncQueue.some(item => item.status === 'synced') && (
                  <button
                    onClick={() => {
                      DBService.clearSyncQueue();
                      showToast("Cleared synced transactions from queue.", "info");
                    }}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                  >
                    Clear Synced
                  </button>
                )}
                <button
                  onClick={handleManualRetryAll}
                  className="px-3.5 py-1.5 bg-[#3B82F6] hover:bg-[#2563EB] text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm hover:shadow-md"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Sync All</span>
                </button>
                <button
                  onClick={() => setShowSyncDrawer(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
              {syncQueue.length === 0 ? (
                <div className="text-center py-12">
                  <span className="text-4xl">✓</span>
                  <h4 className="text-slate-700 dark:text-slate-300 font-bold mt-2 text-sm">All Transactions Synced</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto">
                    There are no pending offline mutations. All your data is safely backed up to the live Cloud Firestore database.
                  </p>
                </div>
              ) : (
                [...syncQueue].reverse().map((item) => (
                  <div 
                    key={item.id}
                    className={`p-4 rounded-xl border flex flex-col gap-2.5 transition-all ${
                      item.status === 'synced'
                        ? 'bg-emerald-50/25 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-950/30'
                        : item.status === 'failed'
                        ? 'bg-rose-50/25 dark:bg-rose-950/10 border-rose-150 dark:border-rose-950/30'
                        : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-150 dark:border-slate-850'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Left: Metadata */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider uppercase ${
                            item.status === 'synced'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-450'
                              : item.status === 'failed'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-450'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-450'
                          }`}>
                            {item.action}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                            {new Date(item.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {item.description}
                        </p>
                      </div>

                      {/* Right: Actions and Status badge */}
                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                        <span className={`text-[10.5px] font-bold flex items-center gap-1 ${
                          item.status === 'synced'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : item.status === 'failed'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}>
                          {item.status === 'synced' ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span>Synced</span>
                            </>
                          ) : item.status === 'failed' ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                              <span>Sync Failed</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              <span>Offline Queued</span>
                            </>
                          )}
                        </span>

                        {item.status !== 'synced' && (
                          <button
                            onClick={() => handleManualRetryItem(item.id, item.action)}
                            disabled={retryingIds[item.id]}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white dark:text-slate-200 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            {retryingIds[item.id] ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Error trace box if failed */}
                    {item.status === 'failed' && item.error && (
                      <div className="p-2 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg text-[10.5px] text-rose-700 dark:text-rose-300 font-mono mt-0.5 leading-relaxed break-all">
                        <span className="font-bold">Error Exception:</span> {item.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Urgent Desktop Alarm Alerts */}
      {activeUrgentRequest && (
        <div className="fixed bottom-6 right-6 z-[998] max-w-sm w-full bg-rose-50 dark:bg-rose-950 border-2 border-rose-600 dark:border-rose-800 rounded-2xl shadow-2xl p-5 font-sans animate-bounce-short ring-4 ring-rose-500/20">
          <div className="flex items-start gap-3.5">
            <div className="h-10 w-10 bg-rose-200 dark:bg-rose-900 rounded-xl flex items-center justify-center text-rose-700 dark:text-rose-300 shrink-0 animate-pulse">
              <Flame className="h-5 w-5" />
            </div>
            <div className="flex-grow min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] bg-rose-600 text-white font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                  Urgent Demand
                </span>
                <span className="text-[10px] font-mono text-rose-500 dark:text-rose-400 font-semibold">
                  {new Date(activeUrgentRequest.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <h4 className="font-bold text-slate-900 dark:text-white text-xs mt-1.5 uppercase tracking-wide">
                {activeUrgentRequest.title}
              </h4>
              <p className="text-xs text-rose-900 dark:text-rose-200 font-semibold leading-relaxed mt-1">
                {activeUrgentRequest.message}
              </p>
              
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => {
                    setActiveUrgentRequest(null);
                  }}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs rounded-lg transition cursor-pointer text-center"
                  id="btn_dismiss_urgent_alert"
                >
                  Dismiss Warning
                </button>
                <button
                  onClick={() => {
                    setActiveUrgentRequest(null);
                    setActiveTab('reports');
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition cursor-pointer flex items-center gap-1 shrink-0"
                  id="btn_view_report_urgent_alert"
                >
                  <span>View Stock Audit</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Non-blocking Toast Alerts */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[999] max-w-md w-full px-4 print:hidden"
          >
            <div className={`
              flex items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl shadow-xl border text-sm font-medium backdrop-blur-md transition-all
              ${toast.type === 'success' 
                ? 'bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 shadow-emerald-500/10' 
                : toast.type === 'error'
                ? 'bg-rose-50/95 dark:bg-rose-950/90 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100 shadow-rose-500/10'
                : 'bg-indigo-50/95 dark:bg-indigo-950/90 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100 shadow-indigo-500/10'}
            `}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="shrink-0 text-base">
                  {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
                </div>
                <div className="grow text-xs leading-snug font-sans font-medium">
                  {toast.message}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {toast.action && (
                  <button
                    onClick={() => {
                      const act = toast.action;
                      setToast(null);
                      act?.onClick();
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white text-[11px] font-extrabold flex items-center gap-1.5 shadow-sm cursor-pointer transition active:scale-95 shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>{toast.action.label}</span>
                  </button>
                )}
                <button 
                  onClick={() => setToast(null)}
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pending Breakdown Modal */}
      {pendingBreakdownJobCard && (
        <PendingBreakdownModal
          jobCard={pendingBreakdownJobCard}
          movements={movements}
          onClose={() => setPendingBreakdownJobCard(null)}
        />
      )}

    </div>
  );
}
