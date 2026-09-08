import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  ShieldCheck, 
  ShieldAlert, 
  UserPlus, 
  Search, 
  Filter, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Trash2, 
  Edit, 
  X, 
  User, 
  FileText, 
  Layers, 
  Lock, 
  Activity,
  ChevronRight,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Settings,
  Database,
  Download,
  RotateCcw,
  Building2,
  FileSpreadsheet,
  ExternalLink,
  MessageSquare,
  Send,
  Truck,
  Package,
  Boxes,
  Check,
  Flame,
  Clock,
  Sparkles
} from 'lucide-react';
import { UserProfile, AuditLog, Department, JobCard, MaterialMovement, CompanyConfig } from '../../types';
import { DBService } from '../../lib/firebase';
import { 
  isAutoBackupEnabled, 
  setAutoBackupEnabled, 
  getStoredBackups, 
  createDatabaseBackup, 
  deleteDatabaseBackup, 
  downloadBackupAsJsonFile,
  DatabaseBackup 
} from '../../lib/backup';
import MobileCard from '../shared/MobileCard';
import ConfirmationBottomSheet from '../shared/ConfirmationBottomSheet';

interface MobileAdminConsoleScreenProps {
  users?: UserProfile[];
  auditLogs?: AuditLog[];
  currentUser?: UserProfile | null;
  onSaveUser: (user: UserProfile) => Promise<void> | void;
  onDeleteUser: (userId: string, userName: string) => Promise<void> | void;
  onLogAction: (action: string, details: string) => void;
  isOnline: boolean;
  jobCards?: JobCard[];
  movements?: MaterialMovement[];
  companyConfig?: CompanyConfig | null;
  onRefreshCompany?: () => void;
  onRefreshJobs?: () => void;
  isSheetsActive?: boolean;
  sheetsDetails?: { name: string; url: string; spreadsheetId: string };
  onOpenSheetsModal?: () => void;
  onDisconnectSheets?: () => void;
  onOpenSheetsInspector?: () => void;
  onUpdateMovement?: (movementId: string, quantity: number, remarks: string) => void | Promise<void>;
  onDeleteMovement?: (movementId: string) => void | Promise<void>;
}

export type AdminMobileTab = 'users' | 'create' | 'settings' | 'backups' | 'audit' | 'movements';

const ALL_MANUFACTURING_DEPARTMENTS: (Department | 'Admin')[] = [
  'Dispatch',
  'Purchase',
  'Raw Material Store',
  'Production',
  'Heat Treatment',
  'Plating',
  'Packing',
  'Store',
  'Admin'
];

export const MobileAdminConsoleScreen: React.FC<MobileAdminConsoleScreenProps> = ({
  users = [],
  auditLogs = [],
  currentUser,
  onSaveUser,
  onDeleteUser,
  onLogAction,
  isOnline,
  jobCards = [],
  movements = [],
  companyConfig = null,
  onRefreshCompany,
  onRefreshJobs,
  isSheetsActive = false,
  sheetsDetails,
  onOpenSheetsModal,
  onDisconnectSheets,
  onOpenSheetsInspector,
  onUpdateMovement,
  onDeleteMovement
}) => {
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isAdminOrSuper = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  const [activeTab, setActiveTab] = useState<AdminMobileTab>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');

  // Selected User Detail Sheet
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Edit User Sheet State
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<'staff' | 'admin' | 'super_admin'>('staff');
  const [editDept, setEditDept] = useState<Department | 'Admin'>('Production');
  const [editAllowedDepts, setEditAllowedDepts] = useState<(Department | 'Admin')[]>([]);
  const [editIsDeptHead, setEditIsDeptHead] = useState(false);
  const [editCanOutsource, setEditCanOutsource] = useState(false);

  // PIN Reset State
  const [resetPinUserId, setResetPinUserId] = useState<string | null>(null);
  const [newPinVal, setNewPinVal] = useState('');
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);

  // Create User Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserDept, setNewUserDept] = useState<Department | 'Admin'>('Production');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'admin' | 'super_admin'>('staff');
  const [newUserAllowedDepts, setNewUserAllowedDepts] = useState<(Department | 'Admin')[]>([]);
  const [newUserIsDeptHead, setNewUserIsDeptHead] = useState(false);
  const [newUserCanOutsource, setNewUserCanOutsource] = useState(false);

  // Backups State
  const [autoBackupActive, setAutoBackupActive] = useState<boolean>(isAutoBackupEnabled());
  const [storedBackups, setStoredBackups] = useState<DatabaseBackup[]>(getStoredBackups());

  // Company Profile & Settings State
  const [companyName, setCompanyName] = useState(companyConfig?.companyName || 'Precision Metal Works');
  const [companyDetails, setCompanyDetails] = useState(companyConfig?.details || 'Specialists in high-tensile fasteners, engine components, and industrial finishes.');
  const [companyPhone, setCompanyPhone] = useState(companyConfig?.phone || '+91 98765 43210');
  const [companyAddress, setCompanyAddress] = useState(companyConfig?.address || 'Shed No. 12, Phase II, Industrial Area, Pune, MH, India');
  const [companyGstIn, setCompanyGstIn] = useState(companyConfig?.gstIn || '27AAAAA1111A1Z1');
  const [requireRawMaterial, setRequireRawMaterial] = useState<boolean>(companyConfig?.requireRawMaterialForProduction !== false);
  const [customerItemFilter, setCustomerItemFilter] = useState<boolean>(companyConfig?.customerItemFilterEnabled !== false);
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(companyConfig?.whatsappEnabled !== false);
  const [whatsappPhone, setWhatsappPhone] = useState(companyConfig?.whatsappPhoneNumber || '');
  const [whatsappApiUrl, setWhatsappApiUrl] = useState(companyConfig?.whatsappApiUrl || '');
  const [whatsappAutoShare, setWhatsappAutoShare] = useState<boolean>(companyConfig?.whatsappAutoOpenShare !== false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Movement Edit State
  const [editingMovement, setEditingMovement] = useState<MaterialMovement | null>(null);
  const [editMovementQty, setEditMovementQty] = useState<number>(0);
  const [editMovementRemarks, setEditMovementRemarks] = useState<string>('');

  // Factory Reset Danger Modal State
  const [showFactoryResetModal, setShowFactoryResetModal] = useState<boolean>(false);
  const [resetConfirmationText, setResetConfirmationText] = useState<string>('');
  const [resetAdminPin, setResetAdminPin] = useState<string>('');
  const [resetIsLoading, setResetIsLoading] = useState<boolean>(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string>('');

  // Confirmation & Loading States
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync company config state
  useEffect(() => {
    if (companyConfig) {
      setCompanyName(companyConfig.companyName || 'Precision Metal Works');
      setCompanyDetails(companyConfig.details || '');
      setCompanyPhone(companyConfig.phone || '');
      setCompanyAddress(companyConfig.address || '');
      setCompanyGstIn(companyConfig.gstIn || '');
      setRequireRawMaterial(companyConfig.requireRawMaterialForProduction !== false);
      setCustomerItemFilter(companyConfig.customerItemFilterEnabled !== false);
      setWhatsappEnabled(companyConfig.whatsappEnabled !== false);
      setWhatsappPhone(companyConfig.whatsappPhoneNumber || '');
      setWhatsappApiUrl(companyConfig.whatsappApiUrl || '');
      setWhatsappAutoShare(companyConfig.whatsappAutoOpenShare !== false);
    }
  }, [companyConfig]);

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return (Array.isArray(users) ? users : []).filter(u => {
      if (!u) return false;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery = !q || 
        String(u.name || '').toLowerCase().includes(q) || 
        String(u.userId || '').toLowerCase().includes(q) || 
        String(u.department || '').toLowerCase().includes(q) ||
        String(u.role || '').toLowerCase().includes(q);

      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesDept = deptFilter === 'ALL' || String(u.department || '').toLowerCase() === deptFilter.toLowerCase();
      const matchesStatus = statusFilter === 'ALL' || 
        (statusFilter === 'active' ? u.active !== false : u.active === false);

      return matchesQuery && matchesRole && matchesDept && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, deptFilter, statusFilter]);

  // Filtered Audit Logs
  const filteredLogs = useMemo(() => {
    return (Array.isArray(auditLogs) ? auditLogs : []).filter(l => {
      if (!l) return false;
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        String(l.userName || '').toLowerCase().includes(q) ||
        String(l.userId || '').toLowerCase().includes(q) ||
        String(l.action || '').toLowerCase().includes(q) ||
        String(l.details || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, searchQuery]);

  // Executive User Counts
  const activeCount = (Array.isArray(users) ? users : []).filter(u => u && u.active !== false).length;
  const inactiveCount = (Array.isArray(users) ? users : []).filter(u => u && u.active === false).length;
  const adminCount = (Array.isArray(users) ? users : []).filter(u => u && (u.role === 'admin' || u.role === 'super_admin')).length;

  // Handle Create User
  const handleExecuteCreateUser = async () => {
    if (!newUserName.trim()) {
      setErrorMessage("Please enter the user's Full Name.");
      return;
    }
    if (newUserPin && (!/^\d{4}$/.test(newUserPin.trim()))) {
      setErrorMessage("Security PIN must be exactly 4 numeric digits (e.g. 1234).");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const pin = newUserPin.trim() || '1234';
      const newId = `u-${Math.floor(Math.random() * 9000) + 1000}`;
      const newProfile: UserProfile = {
        userId: newId,
        name: newUserName.trim(),
        email: `${newUserName.trim().toLowerCase().replace(/\s+/g, '')}@factory.com`,
        department: newUserDept,
        allowedDepartments: newUserAllowedDepts,
        accessList: newUserAllowedDepts,
        role: newUserRole,
        isDepartmentHead: newUserIsDeptHead,
        canOutsource: newUserCanOutsource,
        active: true,
        createdAt: new Date().toISOString(),
        pin
      } as any;

      await onSaveUser(newProfile);
      try {
        await DBService.setUserPin(newId, pin);
      } catch (err) {
        console.warn("Could not set PIN via API:", err);
      }

      onLogAction('CREATE_USER', `Created user '${newProfile.name}' (${newProfile.userId}) for ${newProfile.department} [${newUserRole}]`);
      showToast(`✅ User "${newProfile.name}" created successfully!`);

      // Reset Form
      setNewUserName('');
      setNewUserPin('');
      setNewUserIsDeptHead(false);
      setNewUserCanOutsource(false);
      setNewUserAllowedDepts([]);
      setActiveTab('users');
    } catch (err: any) {
      console.error("Failed to create user", err);
      setErrorMessage(err?.message || "Failed to create user. Please retry.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Open Edit User Sheet
  const handleOpenEditUser = (user: UserProfile) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditRole((user.role as any) || 'staff');
    setEditDept(user.department as any);
    setEditAllowedDepts((user.allowedDepartments as any) || []);
    setEditIsDeptHead(!!user.isDepartmentHead);
    setEditCanOutsource(!!user.canOutsource);
    setSelectedUser(null);
  };

  // Save Edited User
  const handleExecuteSaveEdit = async () => {
    if (!editingUser) return;
    if (!editName.trim()) {
      setErrorMessage("Full Name cannot be empty.");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const updated: UserProfile = {
        ...editingUser,
        name: editName.trim(),
        role: editRole,
        department: editDept,
        allowedDepartments: editAllowedDepts,
        accessList: editAllowedDepts,
        isDepartmentHead: editIsDeptHead,
        canOutsource: editCanOutsource
      };

      await onSaveUser(updated);
      onLogAction('EDIT_USER', `Updated profile for '${updated.name}' (${updated.userId}) - Dept: ${updated.department}, Role: ${updated.role}`);
      showToast(`✅ User "${updated.name}" updated!`);
      setEditingUser(null);
    } catch (err: any) {
      console.error("Failed to update user", err);
      setErrorMessage(err?.message || "Failed to update user profile.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Toggle Active Status
  const handleToggleActive = async (user: UserProfile) => {
    const newStatus = user.active === false;
    try {
      const updated = { ...user, active: newStatus };
      await onSaveUser(updated);
      onLogAction('USER_STATUS_CHANGE', `Set active=${newStatus} for '${user.name}' (${user.userId})`);
      showToast(`User "${user.name}" is now ${newStatus ? 'Active' : 'Deactivated'}`);
      if (selectedUser?.userId === user.userId) {
        setSelectedUser(updated);
      }
    } catch (err: any) {
      showToast("Failed to change user status.");
    }
  };

  // Reset PIN
  const handleExecutePinReset = async () => {
    if (!resetPinUserId) return;
    if (!newPinVal || !/^\d{4}$/.test(newPinVal.trim())) {
      setPinFeedback("PIN must be exactly 4 numeric digits.");
      return;
    }

    setIsProcessing(true);
    setPinFeedback(null);

    try {
      await DBService.setUserPin(resetPinUserId, newPinVal.trim());
      const u = users.find(x => x.userId === resetPinUserId);
      if (u) {
        await onSaveUser({ ...u, pin: newPinVal.trim() } as any);
      }
      onLogAction('RESET_PIN', `Reset Security PIN for user ID ${resetPinUserId}`);
      showToast("✅ Security PIN reset successfully!");
      setResetPinUserId(null);
      setNewPinVal('');
    } catch (err: any) {
      console.error("PIN reset failed", err);
      setPinFeedback(err?.message || "Failed to reset PIN. Please check connection.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete User Confirmation
  const handleDeleteUserClick = (user: UserProfile) => {
    setConfirmAction({
      title: `Delete User "${user.name}"?`,
      description: `Are you sure you want to permanently delete user account ${user.name} (${user.userId})? This will immediately revoke their access and credentials. This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await onDeleteUser(user.userId, user.name);
          onLogAction('DELETE_USER', `Permanently deleted user '${user.name}' (${user.userId})`);
          showToast(`🗑️ User "${user.name}" deleted.`);
          setSelectedUser(null);
        } catch (err: any) {
          showToast("Failed to delete user profile.");
        }
      }
    });
  };

  // Save Plant Configuration (Super Admin Authority)
  const handleSaveCompanyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      showToast("Unauthorized: Super Admin authority required.");
      return;
    }
    setIsSavingSettings(true);
    try {
      await DBService.saveCompanyConfig({
        companyName,
        details: companyDetails,
        phone: companyPhone,
        address: companyAddress,
        gstIn: companyGstIn,
        requireRawMaterialForProduction: requireRawMaterial,
        customerItemFilterEnabled: customerItemFilter,
        whatsappEnabled,
        whatsappPhoneNumber: whatsappPhone,
        whatsappApiUrl,
        whatsappAutoOpenShare: whatsappAutoShare
      }, currentUser?.userId || '', currentUser?.name || 'Super Admin');

      onLogAction('UPDATE_COMPANY_CONFIG', `Updated plant settings & company profile: ${companyName}`);
      showToast("✅ Plant settings & company profile saved!");
      if (onRefreshCompany) onRefreshCompany();
    } catch (err: any) {
      console.error("Failed to update company config", err);
      showToast("❌ Failed to save plant settings.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Auto-backup toggle
  const handleToggleAutoBackup = (enabled: boolean) => {
    setAutoBackupEnabled(enabled);
    setAutoBackupActive(enabled);
    showToast(enabled ? "Daily auto-backup enabled" : "Daily auto-backup disabled");
    onLogAction('TOGGLE_AUTO_BACKUP', `Daily automated database backup ${enabled ? 'enabled' : 'disabled'}.`);
  };

  // Manual Backup Creation
  const handleManualBackup = async () => {
    try {
      showToast("Creating manual database backup...");
      const backup = await createDatabaseBackup('manual');
      setStoredBackups(getStoredBackups());
      showToast(`✅ Database snapshot created: ${backup.filename}`);
      onLogAction('CREATE_MANUAL_BACKUP', `Created manual backup snapshot: ${backup.filename}`);
    } catch (err: any) {
      console.error(err);
      showToast("❌ Failed to create database snapshot.");
    }
  };

  // Delete Backup
  const handleDeleteBackup = (id: string, filename: string) => {
    deleteDatabaseBackup(id);
    setStoredBackups(getStoredBackups());
    showToast(`Deleted backup: ${filename}`);
    onLogAction('DELETE_BACKUP', `Deleted backup file: ${filename}`);
  };

  // Restore Database Backup
  const handleRestoreBackup = async (backup: DatabaseBackup) => {
    if (!isOnline) {
      showToast("Internet connection required for database restore.");
      return;
    }
    setConfirmAction({
      title: "Restore Database Snapshot?",
      description: `Restoring database to snapshot '${backup.filename}' will OVERWRITE all live collections with snapshot state from ${new Date(backup.timestamp).toLocaleString()}. This action is irreversible.`,
      onConfirm: async () => {
        try {
          showToast("Restoring database...");
          await DBService.restoreDatabaseDump(backup.data, currentUser?.userId || '', currentUser?.name || 'Authorized Super Admin');
          showToast("✅ Database successfully restored!");
          if (onRefreshJobs) onRefreshJobs();
          if (onRefreshCompany) onRefreshCompany();
          onLogAction('RESTORE_DATABASE', `Restored database to snapshot ${backup.filename}`);
        } catch (err: any) {
          showToast("❌ Failed to restore database snapshot.");
        }
      }
    });
  };

  // Save Movement Edit
  const handleSaveMovementEdit = async () => {
    if (!editingMovement || !onUpdateMovement) return;
    try {
      await onUpdateMovement(editingMovement.movementId, editMovementQty, editMovementRemarks);
      onLogAction('ADMIN_EDIT_MOVEMENT', `Edited movement ${editingMovement.movementId} Qty: ${editMovementQty} KG`);
      showToast("✅ Movement record updated!");
      setEditingMovement(null);
    } catch (err: any) {
      showToast("❌ Failed to update movement.");
    }
  };

  // Delete Movement
  const handleDeleteMovementClick = (mov: MaterialMovement) => {
    if (!onDeleteMovement) return;
    setConfirmAction({
      title: `Delete Movement ${mov.movementId}?`,
      description: `Are you sure you want to permanently delete movement ${mov.movementId} (${mov.quantity} KG from ${mov.fromDepartment} to ${mov.toDepartment})?`,
      onConfirm: async () => {
        try {
          await onDeleteMovement(mov.movementId);
          onLogAction('ADMIN_DELETE_MOVEMENT', `Deleted movement ${mov.movementId}`);
          showToast(`🗑️ Movement ${mov.movementId} deleted.`);
        } catch (err: any) {
          showToast("❌ Failed to delete movement.");
        }
      }
    });
  };

  // If user is operator, deny access
  if (currentUser?.role === 'operator' || (!isAdminOrSuper && currentUser?.department !== 'Admin')) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-600 rounded-3xl inline-block">
          <Lock className="h-8 w-8 mx-auto" />
        </div>
        <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Admin Console Restricted</h3>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          You do not have administrative privileges to access this area. Please contact your system administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 select-none px-1">
      {/* Top Header Card */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-900/60">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">
                {isSuperAdmin ? 'Super Admin Console' : 'Plant Admin Portal'}
              </h2>
              <span className="text-[10.5px] font-mono text-slate-400 block">
                {currentUser?.name} • <strong className="text-indigo-600">{currentUser?.role?.toUpperCase()}</strong>
              </span>
            </div>
          </div>

          <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border ${
            isOnline 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' 
              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
          }`}>
            {isOnline ? '🟢 Live System' : '🟠 Offline'}
          </span>
        </div>

        {/* Executive Stats Summary */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-center font-mono text-xs">
          <div className="p-2 rounded-2xl bg-slate-50 dark:bg-slate-850">
            <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Users</span>
            <span className="font-extrabold text-slate-900 dark:text-white">{users.length}</span>
          </div>
          <div className="p-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40">
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block uppercase font-bold">Active</span>
            <span className="font-extrabold text-emerald-700 dark:text-emerald-300">{activeCount}</span>
          </div>
          <div className="p-2 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40">
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 block uppercase font-bold">Admins</span>
            <span className="font-extrabold text-indigo-700 dark:text-indigo-300">{adminCount}</span>
          </div>
        </div>
      </div>

      {/* Toast Message Notification */}
      {toastMessage && (
        <div className="p-3 bg-slate-900 text-white text-xs font-mono font-bold rounded-2xl flex items-center justify-between">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Google Sheets Sync Integration Strip */}
      {isSheetsActive && sheetsDetails?.url && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-3xl border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <div>
              <span className="font-bold text-emerald-900 dark:text-emerald-200 block">Google Sheets Sync Active</span>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate max-w-[180px] block">{sheetsDetails.name || "Live Cloud Logbook"}</span>
            </div>
          </div>
          <a
            href={sheetsDetails.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-xl bg-emerald-600 text-white font-bold text-[11px] flex items-center gap-1"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open</span>
          </a>
        </div>
      )}

      {/* Main Tab Navigation Buttons */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {[
          { id: 'users', label: 'Users Roster' },
          { id: 'create', label: '+ New User' },
          ...(isSuperAdmin ? [{ id: 'settings', label: 'Plant Settings' }] : []),
          ...(isSuperAdmin ? [{ id: 'backups', label: 'Snapshots' }] : []),
          { id: 'movements', label: 'Movements Admin' },
          { id: 'audit', label: 'Audit Logs' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as AdminMobileTab)}
            className={`px-3.5 py-2 rounded-2xl text-xs font-extrabold tracking-tight transition shrink-0 cursor-pointer border ${
              activeTab === tab.id
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200/80 dark:border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ======================================================== */}
      {/* TAB 1: USERS ROSTER & MANAGEMENT */}
      {/* ======================================================== */}
      {activeTab === 'users' && (
        <div className="space-y-3">
          {/* Search & Filters */}
          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 space-y-3 shadow-xs">
            <div className="relative">
              <Search className="absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users by Name, ID, Department..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden"
              >
                <option value="ALL">All Roles</option>
                <option value="staff">Staff Operators</option>
                <option value="admin">Admins</option>
                <option value="super_admin">Super Admins</option>
              </select>

              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden"
              >
                <option value="ALL">All Departments</option>
                {ALL_MANUFACTURING_DEPARTMENTS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* User Cards List */}
          <div className="space-y-2">
            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs font-mono bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                No user profiles match query.
              </div>
            ) : (
              filteredUsers.map(user => (
                <div
                  key={user.userId}
                  className={`p-4 bg-white dark:bg-slate-900 rounded-3xl border transition shadow-xs space-y-2.5 ${
                    user.active === false
                      ? 'border-slate-200/60 dark:border-slate-800/60 opacity-60'
                      : 'border-slate-200/90 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-xs text-slate-900 dark:text-white">
                          {user.name}
                        </span>
                        {user.isDepartmentHead && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                            Dept Head
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {user.userId} • {user.department}
                      </span>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                      user.role === 'super_admin'
                        ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'
                        : user.role === 'admin'
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}>
                      {user.role}
                    </span>
                  </div>

                  {/* Actions Strip */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`p-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition ${
                          user.active !== false
                            ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40'
                            : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                        }`}
                        title="Toggle Active Status"
                      >
                        {user.active !== false ? <ToggleRight className="h-4 w-4 text-emerald-600" /> : <ToggleLeft className="h-4 w-4" />}
                        <span className="text-[10px]">{user.active !== false ? 'Active' : 'Off-duty'}</span>
                      </button>

                      <button
                        onClick={() => {
                          setResetPinUserId(user.userId);
                          setNewPinVal('');
                          setPinFeedback(null);
                        }}
                        className="p-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center gap-1"
                        title="Reset 4-digit PIN"
                      >
                        <Key className="h-3.5 w-3.5" />
                        <span>PIN</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEditUser(user)}
                        className="p-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#3B82F6] text-[10px] font-bold flex items-center gap-1"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>

                      {isSuperAdmin && user.userId !== currentUser?.userId && (
                        <button
                          onClick={() => handleDeleteUserClick(user)}
                          className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-[10px] font-bold flex items-center gap-1"
                          title="Delete User Account"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: CREATE NEW USER */}
      {/* ======================================================== */}
      {activeTab === 'create' && (
        <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
              <UserPlus className="h-4 w-4 text-[#3B82F6]" />
              <span>Onboard New Personnel</span>
            </h3>
            <span className="text-[10px] text-slate-400 font-mono">RBAC Provisioning</span>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 text-xs font-mono font-bold">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Full Employee Name *</label>
              <input
                type="text"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                placeholder="e.g. Ramesh Patil"
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-white font-bold focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Primary Station</label>
                <select
                  value={newUserDept}
                  onChange={(e) => setNewUserDept(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden"
                >
                  {ALL_MANUFACTURING_DEPARTMENTS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Access Role</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden"
                >
                  <option value="staff">Staff Operator</option>
                  <option value="admin">Department Admin</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">4-Digit Security PIN</label>
              <input
                type="password"
                maxLength={4}
                value={newUserPin}
                onChange={(e) => setNewUserPin(e.target.value)}
                placeholder="1234 (default)"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-white font-mono font-bold tracking-[0.3em] focus:outline-hidden"
              />
            </div>

            {/* Allowed Departments Multi-Select */}
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                Authorized Secondary Stations (allowedDepartments)
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700">
                {ALL_MANUFACTURING_DEPARTMENTS.map(dept => {
                  const isChecked = newUserAllowedDepts.includes(dept);
                  return (
                    <label key={dept} className="flex items-center gap-2 text-[11px] font-mono cursor-pointer p-1">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewUserAllowedDepts([...newUserAllowedDepts, dept]);
                          } else {
                            setNewUserAllowedDepts(newUserAllowedDepts.filter(d => d !== dept));
                          }
                        }}
                        className="rounded text-indigo-600"
                      />
                      <span>{dept}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Designations */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={newUserIsDeptHead}
                  onChange={(e) => setNewUserIsDeptHead(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Designated Department Head</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={newUserCanOutsource}
                  onChange={(e) => setNewUserCanOutsource(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span>Can Authorize External Jobwork / Outsourcing</span>
              </label>
            </div>

            <button
              onClick={handleExecuteCreateUser}
              disabled={isProcessing}
              className="w-full py-3 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{isProcessing ? 'Onboarding User...' : 'Complete User Onboarding'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: PLANT SETTINGS (Super Admin Authority) */}
      {/* ======================================================== */}
      {activeTab === 'settings' && isSuperAdmin && (
        <form onSubmit={handleSaveCompanyConfig} className="space-y-4">
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
              <Building2 className="h-4 w-4 text-[#3B82F6]" />
              <span>Registered Factory Profile</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Company Name *</label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Scope / Operations Description</label>
                <textarea
                  rows={2}
                  value={companyDetails}
                  onChange={(e) => setCompanyDetails(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-white focus:outline-hidden resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Corporate Phone</label>
                  <input
                    type="text"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">GSTIN Tax ID</label>
                  <input
                    type="text"
                    value={companyGstIn}
                    onChange={(e) => setCompanyGstIn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono uppercase text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Physical Works Address</label>
                <input
                  type="text"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs text-slate-900 dark:text-white focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Operational Policy Toggles */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
              <Settings className="h-4 w-4 text-[#3B82F6]" />
              <span>Plant Operational Constraints</span>
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white block">🪵 Compulsory Raw Material for Production</span>
                  <span className="text-[10px] text-slate-500">Require coil issue from store before machining</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRequireRawMaterial(!requireRawMaterial)}
                  className={`p-1 rounded-xl ${requireRawMaterial ? 'text-emerald-600' : 'text-slate-400'}`}
                >
                  {requireRawMaterial ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                <div>
                  <span className="text-xs font-bold text-slate-900 dark:text-white block">🔍 Customer Specific Part Filtering</span>
                  <span className="text-[10px] text-slate-500">Scope item selectors to selected customer party</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerItemFilter(!customerItemFilter)}
                  className={`p-1 rounded-xl ${customerItemFilter ? 'text-emerald-600' : 'text-slate-400'}`}
                >
                  {customerItemFilter ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
                </button>
              </div>
            </div>
          </div>

          {/* WhatsApp Group Notification Settings */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-emerald-600" />
                <span>WhatsApp Movement Alerts</span>
              </h3>
              <button
                type="button"
                onClick={() => setWhatsappEnabled(!whatsappEnabled)}
                className={`p-1 rounded-xl ${whatsappEnabled ? 'text-emerald-600' : 'text-slate-400'}`}
              >
                {whatsappEnabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
              </button>
            </div>

            {whatsappEnabled && (
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">WhatsApp Group Phone / Target Link</label>
                  <input
                    type="text"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="+91 98765 43210 or Group Link"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Webhook API Gateway URL (Optional)</label>
                  <input
                    type="url"
                    value={whatsappApiUrl}
                    onChange={(e) => setWhatsappApiUrl(e.target.value)}
                    placeholder="https://api.whatsapp-gateway.com/send"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingSettings}
            className="w-full py-3 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            <span>{isSavingSettings ? 'Publishing Plant Configuration...' : 'Save & Publish Plant Configuration'}</span>
          </button>
        </form>
      )}

      {/* ======================================================== */}
      {/* TAB 4: AUTOMATED BACKUPS & DANGER ZONE */}
      {/* ======================================================== */}
      {activeTab === 'backups' && isSuperAdmin && (
        <div className="space-y-4">
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                <Database className="h-4 w-4 text-[#3B82F6]" />
                <span>Automated Database Backups</span>
              </h3>
              <button
                onClick={() => handleToggleAutoBackup(!autoBackupActive)}
                className={`p-1 rounded-xl ${autoBackupActive ? 'text-indigo-600' : 'text-slate-400'}`}
              >
                {autoBackupActive ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
              </button>
            </div>

            <p className="text-[11px] text-slate-500 leading-normal">
              Automated daily backup snapshots capture all collections (users, movements, job cards, company settings) directly to secure storage.
            </p>

            <button
              onClick={handleManualBackup}
              className="w-full py-2.5 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition"
            >
              <Download className="h-4 w-4" />
              <span>Create Immediate Manual Snapshot</span>
            </button>
          </div>

          {/* Stored Snapshots List */}
          <div className="space-y-2">
            <h4 className="text-[10.5px] uppercase font-bold text-slate-400 px-1">
              Local Snapshot Archive ({storedBackups.length})
            </h4>

            {storedBackups.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs font-mono bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                No backup snapshots recorded yet.
              </div>
            ) : (
              storedBackups.map(b => (
                <div key={b.id} className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2 text-xs font-mono">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-extrabold text-slate-900 dark:text-white block">{b.filename}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(b.timestamp).toLocaleString()} • {(b.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      {b.type}
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => downloadBackupAsJsonFile(b)}
                      className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Download className="h-3 w-3" />
                      <span>Download JSON</span>
                    </button>
                    <button
                      onClick={() => handleRestoreBackup(b)}
                      className="p-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Restore</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBackup(b.id, b.filename)}
                      className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* DANGER ZONE: FACTORY RESET (Super Admin Authority) */}
          <div className="p-4 bg-rose-50/60 dark:bg-rose-950/20 rounded-3xl border border-rose-200 dark:border-rose-900/40 space-y-3">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider">Administrative Danger Zone</h3>
            </div>
            <p className="text-[11px] text-rose-800 dark:text-rose-300 leading-normal">
              Perform global factory reset. Permanently erases all operational data (job cards, material movements, and non-admin records). Your Super Admin account will be preserved.
            </p>
            <button
              onClick={() => {
                if (!isOnline) {
                  showToast("Internet connection required for factory reset.");
                  return;
                }
                setShowFactoryResetModal(true);
                setResetConfirmationText('');
                setResetAdminPin('');
                setResetErrorMessage('');
              }}
              className="w-full py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Factory Reset Database</span>
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 5: MOVEMENTS ADMIN */}
      {/* ======================================================== */}
      {activeTab === 'movements' && (
        <div className="space-y-3">
          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs">
            <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Material Movements Ledger</span>
            <p className="text-[11px] text-slate-500">Administratively adjust quantities or delete faulty movement transitions.</p>
          </div>

          <div className="space-y-2">
            {(Array.isArray(movements) ? movements : []).slice(0, 40).map(m => (
              <div key={m.movementId} className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2 text-xs font-mono">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-extrabold text-indigo-600 block">{m.jobCardNo}</span>
                    <span className="text-[10px] text-slate-400">{m.movementId} • {m.fromDepartment} &rarr; {m.toDepartment}</span>
                  </div>
                  <span className="font-extrabold text-slate-900 dark:text-white">{m.quantity} KG</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[10.5px]">
                  <span className={m.accepted ? 'text-emerald-600 font-bold' : 'text-amber-600'}>
                    {m.accepted ? 'Accepted' : 'In Transit'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {onUpdateMovement && (
                      <button
                        onClick={() => {
                          setEditingMovement(m);
                          setEditMovementQty(m.quantity);
                          setEditMovementRemarks(m.remarks || '');
                        }}
                        className="p-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#3B82F6] font-bold text-[10px]"
                      >
                        Edit
                      </button>
                    )}
                    {onDeleteMovement && (
                      <button
                        onClick={() => handleDeleteMovementClick(m)}
                        className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 font-bold text-[10px]"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 6: ENTERPRISE AUDIT LOGS */}
      {/* ======================================================== */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2">
            <div className="relative">
              <Search className="absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search audit trail by user, action, details..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden"
              />
            </div>
          </div>

          <div className="space-y-2">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs font-mono bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
                No audit events recorded yet.
              </div>
            ) : (
              filteredLogs.slice(0, 50).map(l => (
                <div
                  key={l.logId || `${l.timestamp}-${l.action}`}
                  className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 text-xs font-mono"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#3B82F6]">{l.action}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal">
                    {l.details}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400">
                    <span>By: <strong className="text-slate-800 dark:text-slate-200">{l.userName || l.userId}</strong></span>
                    <span>{new Date(l.timestamp).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: EDIT USER PROFILE SHEET */}
      {/* ======================================================== */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingUser(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                  Edit User: {editingUser.name}
                </h3>
                <button onClick={() => setEditingUser(null)} className="p-1 rounded-xl text-slate-400">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 text-xs font-mono font-bold">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Full Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Primary Station</label>
                    <select
                      value={editDept}
                      onChange={(e) => setEditDept(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                    >
                      {ALL_MANUFACTURING_DEPARTMENTS.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Role</label>
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                    >
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                      {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">
                    Authorized Secondary Stations (allowedDepartments)
                  </label>
                  <div className="grid grid-cols-2 gap-1 p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                    {ALL_MANUFACTURING_DEPARTMENTS.map(dept => {
                      const isChecked = editAllowedDepts.includes(dept);
                      return (
                        <label key={dept} className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer p-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditAllowedDepts([...editAllowedDepts, dept]);
                              } else {
                                setEditAllowedDepts(editAllowedDepts.filter(d => d !== dept));
                              }
                            }}
                            className="rounded text-indigo-600"
                          />
                          <span>{dept}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={editIsDeptHead}
                      onChange={(e) => setEditIsDeptHead(e.target.checked)}
                      className="rounded text-purple-600"
                    />
                    <span>Designated Department Head</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={editCanOutsource}
                      onChange={(e) => setEditCanOutsource(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    <span>Can Authorize External Jobwork / Outsourcing</span>
                  </label>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditingUser(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecuteSaveEdit}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
                  >
                    {isProcessing ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL 2: RESET PIN MODAL */}
      {/* ======================================================== */}
      <AnimatePresence>
        {resetPinUserId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setResetPinUserId(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Key className="h-4 w-4 text-amber-500" />
                  <span>Reset Security PIN</span>
                </h3>
                <button onClick={() => setResetPinUserId(null)} className="p-1 rounded-xl text-slate-400">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {pinFeedback && (
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 text-xs font-mono font-bold">
                  {pinFeedback}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">New 4-Digit Numeric PIN</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={newPinVal}
                    onChange={(e) => setNewPinVal(e.target.value)}
                    placeholder="••••"
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold tracking-[0.4em] text-slate-900 dark:text-white text-center focus:outline-hidden"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setResetPinUserId(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecutePinReset}
                    disabled={isProcessing || newPinVal.length !== 4}
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs disabled:opacity-50"
                  >
                    {isProcessing ? 'Updating...' : 'Set PIN'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ======================================================== */}
      {/* MODAL 3: FACTORY RESET DANGER MODAL (Super Admin) */}
      {/* ======================================================== */}
      <AnimatePresence>
        {showFactoryResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFactoryResetModal(false)}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 border border-rose-200 dark:border-rose-900 shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center gap-2.5 text-rose-600 dark:text-rose-400 pb-2 border-b border-rose-100 dark:border-rose-900/40">
                <AlertTriangle className="h-6 w-6 shrink-0" />
                <div>
                  <h3 className="text-xs font-extrabold uppercase">Permanent Factory Reset</h3>
                  <span className="text-[9px] font-mono font-bold text-rose-500 uppercase tracking-wider">Irreversible Destruction</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-[11px] text-rose-900 dark:text-rose-200 space-y-1.5">
                <p className="font-bold">This will permanently delete:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[10px] text-rose-700 dark:text-rose-300">
                  <li>All job cards & manufacturing batches</li>
                  <li>All material movements & store records</li>
                  <li>All outsource orders, items, and notifications</li>
                  <li>Staff user accounts and audit logs</li>
                </ul>
                <div className="pt-1.5 border-t border-rose-200 dark:border-rose-900/40 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  ⭐ SUPER ADMIN PRESERVED: Your existing Super Admin account and PIN credentials will survive this reset.
                </div>
              </div>

              {resetErrorMessage && (
                <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 text-xs font-mono font-bold">
                  {resetErrorMessage}
                </div>
              )}

              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Type <strong className="text-rose-600 font-mono">FACTORY RESET</strong> to confirm:
                  </label>
                  <input
                    type="text"
                    placeholder="FACTORY RESET"
                    value={resetConfirmationText}
                    onChange={(e) => setResetConfirmationText(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Enter Super Admin 4-Digit PIN:
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    placeholder="••••"
                    value={resetAdminPin}
                    onChange={(e) => setResetAdminPin(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono font-bold tracking-[0.3em] text-slate-900 dark:text-white focus:outline-hidden"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowFactoryResetModal(false)}
                    disabled={resetIsLoading}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={resetConfirmationText !== 'FACTORY RESET' || resetAdminPin.length !== 4 || resetIsLoading}
                    onClick={async () => {
                      setResetIsLoading(true);
                      setResetErrorMessage('');
                      try {
                        await DBService.factoryReset(resetAdminPin);
                        showToast("Factory reset completed. Super Admin account preserved.");
                        setShowFactoryResetModal(false);
                      } catch (err: any) {
                        setResetErrorMessage(err?.message || "Factory reset failed");
                      } finally {
                        setResetIsLoading(false);
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs disabled:opacity-40"
                  >
                    {resetIsLoading ? 'Erasing...' : 'RESET DATA'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Bottom Sheet */}
      <ConfirmationBottomSheet
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.title || 'Confirm Action'}
        description={confirmAction?.description || 'Are you sure you want to proceed?'}
        confirmLabel="Confirm & Execute"
        isDangerous={true}
        onConfirm={async () => {
          if (confirmAction?.onConfirm) {
            await confirmAction.onConfirm();
          }
          setConfirmAction(null);
        }}
      />
    </div>
  );
};

export default MobileAdminConsoleScreen;
