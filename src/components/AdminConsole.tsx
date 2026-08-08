import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Settings, 
  FileText, 
  Trash2, 
  UserPlus, 
  ShieldAlert, 
  ShieldCheck, 
  ToggleLeft, 
  Activity, 
  Check, 
  CheckCircle2,
  X,
  Sliders,
  Search,
  Warehouse,
  Database,
  Package,
  Building2,
  FileSpreadsheet,
  ExternalLink,
  Layers,
  RefreshCw,
  RotateCcw,
  TrendingUp,
  Edit,
  Download,
  Wrench,
  BellOff,
  MessageSquare,
  Send,
  Share2
} from 'lucide-react';
import { UserProfile, AuditLog, Department, JobCard, MaterialMovement, CompanyConfig, JobCardStatus } from '../types';
import { getJobCardProcessMetrics } from '../lib/metrics';
import { DBService } from '../lib/firebase';
import { formatMovementWhatsAppMessage, getWhatsAppShareUrl, triggerWhatsAppMovementNotification } from '../lib/whatsapp';
import JobStatusBadge from './JobStatusBadge';
import BulkStatusUpdateModal from './BulkStatusUpdateModal';
import { 
  isAutoBackupEnabled, 
  setAutoBackupEnabled, 
  getStoredBackups, 
  createDatabaseBackup, 
  deleteDatabaseBackup, 
  downloadBackupAsJsonFile,
  DatabaseBackup 
} from '../lib/backup';
import { exportComprehensiveExcelBackup } from '../lib/excelExport';

interface AdminConsoleProps {
  users: UserProfile[];
  auditLogs: AuditLog[];
  onSaveUser: (user: UserProfile) => void;
  onLogAction: (action: string, details: string) => void;
  currentUser: UserProfile | null;
  onDeleteUser: (userId: string, userName: string) => void;
  jobCards?: JobCard[];
  movements?: MaterialMovement[];
  onRefreshJobs?: () => void;
  companyConfig?: CompanyConfig | null;
  onRefreshCompany?: () => void;
  isSheetsActive?: boolean;
  sheetsDetails?: { name: string; url: string; spreadsheetId: string };
  onOpenSheetsModal?: () => void;
  onDisconnectSheets?: () => void;
  onOpenSheetsInspector?: () => void;
  onSetJobCards?: (cards: JobCard[]) => void;
  onUpdateMovement?: (movementId: string, quantity: number, remarks: string) => void | Promise<void>;
  onDeleteMovement?: (movementId: string) => void | Promise<void>;
}

export default function AdminConsole({ 
  users, 
  auditLogs, 
  onSaveUser, 
  onLogAction, 
  currentUser, 
  onDeleteUser,
  jobCards = [],
  movements = [],
  onRefreshJobs,
  companyConfig = null,
  onRefreshCompany,
  isSheetsActive = false,
  sheetsDetails,
  onOpenSheetsModal,
  onDisconnectSheets,
  onOpenSheetsInspector,
  onSetJobCards,
  onUpdateMovement,
  onDeleteMovement
}: AdminConsoleProps) {
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'settings' | 'audit' | 'jobs' | 'movements' | 'stock' | 'company' | 'all'>('users');
  const [searchTerm, setSearchTerm] = useState('');
  
  // --- HIGH-SCALE LOAD TESTING AND SIMULATION ---
  const [isGenerating100k, setIsGenerating100k] = useState(false);
  const [originalCards, setOriginalCards] = useState<JobCard[]>([]);

  const handleGenerate100kSimulated = () => {
    setIsGenerating100k(true);
    if (originalCards.length === 0) {
      setOriginalCards(jobCards);
    }
    
    setTimeout(() => {
      const startTime = performance.now();
      const mockCards: JobCard[] = [];
      const parties = ["Global Heavy Industries", "Ace Aerospace Ltd.", "Apex Motors Corporation", "Standard Fasteners Corp", "Metro Infrastructure", "Titan Forgings"];
      const items = ["Hardened M12 Hex Bolt (Class 10.9)", "Anchor Shaft Pin 45mm", "Precision Plated Spacer Sleeve", "Heavy-Duty Structural Flange", "Heat Treated Gear Hub", "Plated Cotter Key"];
      const depts: Department[] = ['Purchase', 'Dispatch', 'Production', 'Heat Treatment', 'Plating', 'Packing', 'Store'];
      const statuses: JobCardStatus[] = ['Pending', 'In Process', 'Completed', 'Rejected', 'Pending Acceptance'];

      for (let i = 1; i <= 100000; i++) {
        const pIdx = i % parties.length;
        const iIdx = i % items.length;
        const dIdx = i % depts.length;
        const sIdx = i % statuses.length;
        
        mockCards.push({
          jobCardNo: `JC-SIM-${100000 + i}`,
          orderNo: `ORD-SIM-${500000 + i}`,
          partyName: parties[pIdx],
          itemName: items[iIdx],
          itemCode: `MFR-LOAD-${1000 + (i % 999)}`,
          orderQty: 250 + (i % 1000),
          currentQty: 250 + (i % 1000),
          balanceQty: (i % 4 === 0) ? 0 : 50 + (i % 200),
          currentDepartment: depts[dIdx],
          status: statuses[sIdx],
          heatTreatmentRequired: (i % 3 === 0) ? false : (i % 2 === 0),
          processType: (i % 3 === 0) ? 'Purchase' : 'Manufacturing',
          createdBy: "Automated Benchmark Engine",
          createdAt: new Date(Date.now() - (i * 60 * 1000)).toISOString(),
          completed: i % 4 === 0
        });
      }

      const duration = (performance.now() - startTime).toFixed(1);
      if (onSetJobCards) {
        onSetJobCards(mockCards);
      }
      setIsGenerating100k(false);
      showToast(`Successfully injected 100,000 simulated Job Cards in-memory in ${duration}ms!`, "success");
      onLogAction('BENCHMARK_SIMULATE_100K', `Generated and injected 100,000 high-scale virtual job card entries in ${duration}ms.`);
    }, 50);
  };

  const handleResetToOriginal = () => {
    if (originalCards.length > 0 && onSetJobCards) {
      onSetJobCards(originalCards);
      showToast("Successfully restored original database records.", "info");
    } else if (onRefreshJobs) {
      onRefreshJobs();
    }
  };

  // Create New User Forms State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserDept, setNewUserDept] = useState<Department | 'Admin'>('Production');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'admin' | 'super_admin'>('staff');
  const [newUserCanOutsource, setNewUserCanOutsource] = useState<boolean>(false);
  const [pinError, setPinError] = useState('');

  // Synchronize onboarding presets depending on creator's level
  useEffect(() => {
    if (showAddForm && currentUser) {
      if (currentUser.role === 'admin') {
        setNewUserRole('staff');
        setNewUserDept(currentUser.department);
      } else if (currentUser.role === 'super_admin') {
        setNewUserRole('admin');
        setNewUserDept('Production');
      }
    }
  }, [showAddForm, currentUser]);

  // Delete User State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>('');

  // Editing user PIN states
  const [editingUserIdPin, setEditingUserIdPin] = useState<string | null>(null);
  const [editUserPinVal, setEditUserPinVal] = useState<string>('');

  // Editing movement states
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null);
  const [editMovementQty, setEditMovementQty] = useState<number>(0);
  const [editMovementRemarks, setEditMovementRemarks] = useState<string>('');

  // Bulk selection states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedJobNos, setSelectedJobNos] = useState<string[]>([]);
  const [selectedAuditLogIds, setSelectedAuditLogIds] = useState<string[]>([]);
  const [selectedMovementIds, setSelectedMovementIds] = useState<string[]>([]);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);

  // --- NON-BLOCKING LOCAL TOASTS & CONFIRMATIONS ---
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
    cancelText?: string;
    requireText?: string;
  } | null>(null);
  const [verificationInput, setVerificationInput] = useState('');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(prev => prev?.message === message ? null : prev);
    }, 4500);
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void | Promise<void>, confirmText = 'Confirm', cancelText = 'Cancel', requireText?: string) => {
    setVerificationInput('');
    setConfirmDialog({ title, message, onConfirm, confirmText, cancelText, requireText });
  };

  const isManager = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';

  // --- AUTO-BACKUP STATE AND HANDLERS ---
  const [autoBackupActive, setAutoBackupActive] = useState<boolean>(isAutoBackupEnabled());
  const [storedBackups, setStoredBackups] = useState<DatabaseBackup[]>(getStoredBackups());

  const handleToggleAutoBackup = (enabled: boolean) => {
    setAutoBackupEnabled(enabled);
    setAutoBackupActive(enabled);
    showToast(enabled ? "Daily auto-backup enabled" : "Daily auto-backup disabled", "info");
    onLogAction('TOGGLE_AUTO_BACKUP', `Daily automated database backup ${enabled ? 'enabled' : 'disabled'}.`);
  };

  const handleManualBackup = async () => {
    try {
      showToast("Creating manual database backup in progress...", "info");
      const backup = await createDatabaseBackup('manual');
      setStoredBackups(getStoredBackups());
      showToast(`Database backup created successfully: ${backup.filename}`, "success");
      onLogAction('CREATE_MANUAL_BACKUP', `Manually triggered all-collections backup. Filename: ${backup.filename}. Saved in user's browser storage.`);
    } catch (err: any) {
      console.error(err);
      showToast(`Failed to create manual backup: ${err.message || String(err)}`, "error");
    }
  };

  const handleDeleteBackup = (id: string, filename: string) => {
    deleteDatabaseBackup(id);
    setStoredBackups(getStoredBackups());
    showToast(`Deleted backup: ${filename}`, "info");
    onLogAction('DELETE_BACKUP', `Deleted backup file from browser storage: ${filename}`);
  };

  const handleRestoreBackup = async (backup: DatabaseBackup) => {
    try {
      showToast("Restoring database from backup...", "info");
      await DBService.restoreDatabaseDump(backup.data, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
      showToast("Database successfully restored! Reloading system cache...", "success");
      if (onRefreshJobs) onRefreshJobs();
      if (onRefreshCompany) onRefreshCompany();
      onLogAction('RESTORE_DATABASE', `Restored database collections to backup snapshot dated ${backup.timestamp}`);
    } catch (err: any) {
      console.error(err);
      showToast(`Failed to restore database backup: ${err.message || String(err)}`, "error");
    }
  };

  const handleDownloadFile = (backup: DatabaseBackup) => {
    downloadBackupAsJsonFile(backup);
    showToast(`Downloaded: ${backup.filename}`, "success");
    onLogAction('DOWNLOAD_BACKUP_FILE', `Downloaded backup file: ${backup.filename}`);
  };

  const [mountError, setMountError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const initComponent = async () => {
    setIsInitializing(true);
    setMountError(null);
    try {
      // Validate initial inputs to ensure safe operations and catch component mount failures early
      if (!users) {
        throw new Error("Critical System Error: Operator profiles array is undefined or uninitialized.");
      }
      if (!auditLogs) {
        throw new Error("Critical System Error: Audit logs collection is undefined or uninitialized.");
      }

      // Re-trigger the parent data fetching or state initialization callbacks
      if (onRefreshJobs) {
        await onRefreshJobs();
      }
      if (onRefreshCompany) {
        await onRefreshCompany();
      }
    } catch (err: any) {
      console.error("AdminConsole data fetching/initialization failed during mount:", err);
      setMountError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    initComponent();
  }, []);

  const handleRetry = async () => {
    await initComponent();
  };

  // Clear selection if tab changes
  useEffect(() => {
    setSelectedUserIds([]);
    setSelectedJobNos([]);
    setSelectedAuditLogIds([]);
  }, [activeSubTab]);

  // Bulk actions handlers for users
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select all filtered users except current logged in user
      const ids = filteredUsers
        .filter(u => u.userId !== currentUser?.userId)
        .map(u => u.userId);
      setSelectedUserIds(ids);
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleSelectUser = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedUserIds(prev => [...prev, userId]);
    } else {
      setSelectedUserIds(prev => prev.filter(id => id !== userId));
    }
  };

  // Bulk action handlers for Job Cards
  const handleSelectAllJobs = (checked: boolean) => {
    if (checked) {
      const nos = jobCards
        .filter(j => 
          j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
          j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .map(j => j.jobCardNo);
      setSelectedJobNos(nos);
    } else {
      setSelectedJobNos([]);
    }
  };

  const handleSelectJob = (jobCardNo: string, checked: boolean) => {
    if (checked) {
      setSelectedJobNos(prev => [...prev, jobCardNo]);
    } else {
      setSelectedJobNos(prev => prev.filter(no => no !== jobCardNo));
    }
  };

  const handleBulkDeleteJobs = async () => {
    if (!isManager) {
      showToast('Only administrators are authorized to perform bulk deletions.', 'error');
      return;
    }
    if (selectedJobNos.length === 0) {
      showToast('No job cards selected.', 'error');
      return;
    }

    showConfirm(
      "Bulk Delete Job Cards",
      `Are you sure you want to permanently delete the ${selectedJobNos.length} selected job cards? This action is completely irreversible, and all related material transitions and notifications will be deleted!`,
      async () => {
        try {
          for (const jobCardNo of selectedJobNos) {
            await DBService.deleteJobCard(jobCardNo, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
          }
          onLogAction('BULK_DELETE_JOBS', `Bulk deleted ${selectedJobNos.length} job cards: [${selectedJobNos.join(', ')}]`);
          setSelectedJobNos([]);
          if (onRefreshJobs) onRefreshJobs();
          showToast(`Successfully deleted ${selectedJobNos.length} job cards.`, 'success');
        } catch (err: any) {
          console.error("Bulk delete jobs failed", err);
          showToast(`Failed to complete bulk deletion of job cards: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    );
  };

  // Bulk status update handler
  const handleBulkJobStatusUpdate = async (targetStatus: JobCardStatus) => {
    if (selectedJobNos.length === 0) return;
    try {
      await DBService.bulkUpdateJobCardStatus(
        selectedJobNos,
        targetStatus,
        currentUser?.userId || 'u-1',
        currentUser?.name || 'Admin User'
      );
      showToast(`Successfully updated status for ${selectedJobNos.length} job cards to '${targetStatus}'.`, 'success');
      setSelectedJobNos([]);
      if (onRefreshJobs) onRefreshJobs();
    } catch (err: any) {
      console.error("Bulk status update failed", err);
      showToast(`Failed to update job card statuses: ${err.message || String(err)}`, 'error');
    }
  };

  // Bulk action handlers for Audit Logs
  const handleSelectAllLogs = (checked: boolean) => {
    if (checked) {
      const ids = filteredLogs.map(l => l.id);
      setSelectedAuditLogIds(ids);
    } else {
      setSelectedAuditLogIds([]);
    }
  };

  const handleSelectLog = (logId: string, checked: boolean) => {
    if (checked) {
      setSelectedAuditLogIds(prev => [...prev, logId]);
    } else {
      setSelectedAuditLogIds(prev => prev.filter(id => id !== logId));
    }
  };

  const handleBulkDeleteLogs = async () => {
    if (!isManager) {
      showToast('Only administrators are authorized to perform bulk deletions.', 'error');
      return;
    }
    if (selectedAuditLogIds.length === 0) {
      showToast('No audit logs selected.', 'error');
      return;
    }

    showConfirm(
      "Bulk Delete Audit Logs",
      `Are you sure you want to permanently delete the ${selectedAuditLogIds.length} selected audit logs?`,
      async () => {
        try {
          for (const logId of selectedAuditLogIds) {
            await DBService.deleteAuditLog(logId, currentUser?.userId || 'u-1');
          }
          onLogAction('BULK_DELETE_AUDIT_LOGS', `Bulk deleted ${selectedAuditLogIds.length} audit logs`);
          setSelectedAuditLogIds([]);
          if (onRefreshJobs) onRefreshJobs(); // forces refresh of audit logs state
          showToast(`Successfully deleted ${selectedAuditLogIds.length} audit logs.`, 'success');
        } catch (err: any) {
          console.error("Bulk delete logs failed", err);
          showToast(`Failed to complete bulk deletion of audit logs: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    );
  };

  const handleBulkDelete = async () => {
    if (!isManager) {
      showToast('Only administrators are authorized to perform bulk deletions.', 'error');
      return;
    }
    const eligibleIds = selectedUserIds.filter(id => id !== currentUser?.userId);
    if (eligibleIds.length === 0) {
      showToast('No eligible users selected for deletion.', 'error');
      return;
    }

    showConfirm(
      "Bulk Delete User Profiles",
      `Are you sure you want to permanently delete the ${eligibleIds.length} selected user profiles? This action cannot be undone.`,
      async () => {
        try {
          for (const userId of eligibleIds) {
            const u = users.find(user => user.userId === userId);
            if (u) {
              await onDeleteUser(userId, u.name);
            }
          }
          onLogAction('BULK_DELETE_USERS', `Bulk deleted ${eligibleIds.length} users: [${eligibleIds.join(', ')}]`);
          setSelectedUserIds([]);
          showToast(`Successfully deleted ${eligibleIds.length} users.`, 'success');
        } catch (err: any) {
          console.error("Bulk deletion failed", err);
          showToast(`Failed to complete bulk deletion: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    );
  };

  const handleBulkRoleUpdate = async (newRole: 'staff' | 'admin' | 'super_admin') => {
    if (currentUser?.role !== 'super_admin') {
      showToast('Only Super Admins are authorized to perform bulk role updates.', 'error');
      return;
    }
    if (selectedUserIds.length === 0) return;

    if (newRole === 'admin') {
      for (const userId of selectedUserIds) {
        const u = users.find(user => user.userId === userId);
        if (u && u.department !== 'Admin') {
          const otherDeptManager = (users || []).find(existing => existing.userId !== userId && existing.role === 'admin' && existing.department === u.department);
          if (otherDeptManager) {
            showToast(`Cannot upgrade '${u.name}' to manager. '${otherDeptManager.name}' is already registered as manager of ${u.department}.`, 'error');
            return;
          }
        }
      }
    }

    showConfirm(
      "Bulk Update User Roles",
      `Are you sure you want to update the role of the ${selectedUserIds.length} selected users to ${newRole === 'super_admin' ? 'Super Admin' : newRole === 'admin' ? 'Admin Overseer' : 'Staff Operator'}?`,
      async () => {
        try {
          let updatedCount = 0;
          for (const userId of selectedUserIds) {
            const u = users.find(user => user.userId === userId);
            if (u && u.role !== newRole) {
              const updated = { ...u, role: newRole };
              await onSaveUser(updated);
              updatedCount++;
            }
          }
          onLogAction('BULK_ROLE_UPDATE', `Bulk updated roles for ${updatedCount} users to ${newRole}`);
          setSelectedUserIds([]);
          showToast(`Successfully updated roles for ${updatedCount} users.`, 'success');
        } catch (err: any) {
          console.error("Bulk role update failed", err);
          showToast(`Failed to complete bulk role update: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      }
    );
  };

  const handleBulkStatusUpdate = async (active: boolean) => {
    if (!isManager) {
      showToast('Only administrators are authorized to perform bulk updates.', 'error');
      return;
    }
    if (selectedUserIds.length === 0) return;

    try {
      let updatedCount = 0;
      for (const userId of selectedUserIds) {
        const u = users.find(user => user.userId === userId);
        if (u) {
          // Managers can only change status of staff in their own department
          if (currentUser?.role === 'admin') {
            if (u.department !== currentUser.department || u.role !== 'staff') {
              continue;
            }
          }
          if (u.active !== active) {
            const updated = { ...u, active };
            await onSaveUser(updated);
            updatedCount++;
          }
        }
      }
      onLogAction('BULK_STATUS_UPDATE', `Bulk set active status to ${active} for ${updatedCount} users`);
      setSelectedUserIds([]);
      showToast(`Successfully set status to ${active ? 'Active on Floor' : 'Off-duty'} for ${updatedCount} users.`, 'success');
    } catch (err: any) {
      console.error("Bulk status update failed", err);
      showToast(`Failed to complete bulk status update: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    if (!isManager) {
      setPinError('Unauthorized: Only a Manager or Super Admin is authorized to onboard users.');
      return;
    }

    if (!newUserName) return;

    // Enforce business rules strictly in handler
    if (currentUser?.role === 'admin') {
      if (newUserRole !== 'staff') {
        const errorMsg = 'Unauthorized: Department heads can only onboard staff-level employees.';
        setPinError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
      if (newUserDept !== currentUser.department) {
        const errorMsg = `Unauthorized: As manager of ${currentUser.department}, you can only onboard personnel inside your own department.`;
        setPinError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
    }

    // Auto-generate a secure 4-digit PIN under the hood for backend compatibility
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();

    // Enforce at most one manager per department
    if (newUserRole === 'admin' && newUserDept !== 'Admin') {
      const otherDeptManager = (users || []).find(u => u.role === 'admin' && u.department === newUserDept);
      if (otherDeptManager) {
        const errorMsg = `Only one Department Head is permitted for ${newUserDept}. '${otherDeptManager.name}' is already registered as manager.`;
        setPinError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
    }

    const newProfile: UserProfile = {
      userId: `u-${Math.floor(Math.random() * 9000) + 1000}`,
      name: newUserName,
      email: `${newUserName.toLowerCase().replace(/\s+/g, '')}@factory.com`,
      pin: generatedPin,
      department: newUserDept,
      role: newUserRole,
      active: true,
      canOutsource: newUserCanOutsource,
      createdAt: new Date().toISOString()
    };

    onSaveUser(newProfile);
    onLogAction('CREATE_USER', `Created new user account '${newProfile.name}' for department ${newProfile.department} with role ${newUserRole}${newUserCanOutsource ? ' [Outsource Authorized]' : ''}`);
    
    // Reset Form
    setNewUserName('');
    setNewUserPin('');
    setNewUserCanOutsource(false);
    setShowAddForm(false);
  };

  const toggleUserOutsource = (user: UserProfile) => {
    if (!isManager) {
      showToast('Only plant managers are authorized to modify outsourcing permissions.', 'error');
      return;
    }
    const updated = { ...user, canOutsource: !user.canOutsource };
    onSaveUser(updated);
    onLogAction('TOGGLE_USER_OUTSOURCE', `Changed outsourcing authorization for '${user.name}' to ${updated.canOutsource ? 'AUTHORIZED' : 'REVOKED'}`);
    showToast(`${updated.canOutsource ? 'Granted' : 'Revoked'} process outsourcing authorization for ${user.name}`, 'info');
  };

  const handleSavePinCode = async (user: UserProfile) => {
    if (!isManager) {
      showToast('Unauthorized: Only an administrator is authorized to change security PIN codes.', 'error');
      return;
    }
    if (currentUser?.role === 'admin') {
      if (user.department !== currentUser.department) {
        showToast(`Unauthorized: As the manager of ${currentUser.department}, you cannot modify PINs for users in ${user.department}.`, 'error');
        return;
      }
      if (user.role !== 'staff') {
        showToast('Unauthorized: Department managers can only modify PINs for staff-level employees.', 'error');
        return;
      }
    }

    const cleanPin = editUserPinVal.replace(/\D/g, '');
    if (cleanPin.length !== 4) {
      showToast('Error: PIN code must be exactly 4 digits.', 'error');
      return;
    }

    try {
      const updated = { ...user, pin: cleanPin };
      await onSaveUser(updated);
      onLogAction('UPDATE_USER_PIN', `Updated security PIN code for user '${user.name}'`);
      showToast(`Successfully updated PIN for ${user.name}.`, 'success');
      setEditingUserIdPin(null);
    } catch (err: any) {
      console.error("Failed to update PIN", err);
      showToast(`Failed to update PIN: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const toggleUserActive = (user: UserProfile) => {
    if (!isManager) {
      showToast('Only plant managers are authorized to modify operator profiles.', 'error');
      return;
    }
    if (currentUser?.role === 'admin') {
      if (user.department !== currentUser.department) {
        showToast(`Unauthorized: As the manager of ${currentUser.department}, you cannot modify users in ${user.department}.`, 'error');
        return;
      }
      if (user.role !== 'staff') {
        showToast('Unauthorized: Department managers can only toggle status of staff-level employees.', 'error');
        return;
      }
    }
    const updated = { ...user, active: !user.active };
    onSaveUser(updated);
    onLogAction('TOGGLE_USER_STATUS', `Changed activation status of '${user.name}' to ${updated.active ? 'ACTIVE' : 'INACTIVE'}`);
  };

  // Filtered lists with safety guards to prevent crashing on null/undefined properties
  const filteredUsers = (users || []).filter(u => {
    if (!u) return false;

    // Hierarchy filter: Department heads can only view/manage users in their own department
    if (currentUser && currentUser.role === 'admin') {
      if (u.department !== currentUser.department) {
        return false;
      }
    }

    const name = u.name || '';
    const pin = u.pin || '';
    const email = u.email || '';
    const dept = u.department || '';
    return (
      name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      pin.includes(searchTerm) ||
      email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dept.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const filteredLogs = (auditLogs || []).filter(l => {
    if (!l) return false;
    const userName = l.userName || '';
    const details = l.details || '';
    const action = l.action || '';
    return (
      userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      details.toLowerCase().includes(searchTerm.toLowerCase()) ||
      action.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  if (mountError) {
    return (
      <div className="p-6 max-w-xl mx-auto my-12 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 rounded-2xl shadow-xl space-y-6 animate-fade-in">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-sans font-extrabold text-slate-850 dark:text-slate-100 text-sm uppercase tracking-wide">
              Initialization Interrupted
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              An error occurred during Admin Console initialization or data sync from the remote ledger.
            </p>
          </div>
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-xl">
          <span className="block text-[10px] text-slate-400 font-mono uppercase tracking-wider mb-1">Error Diagnostic Log</span>
          <p className="text-xs font-mono font-bold text-red-600 dark:text-red-400 break-all">
            {mountError}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={handleRetry}
            disabled={isInitializing}
            className="w-full sm:w-auto bg-red-650 hover:bg-red-550 disabled:opacity-50 text-white font-sans font-bold text-xs py-2.5 px-6 rounded-xl shadow-sm transition border border-red-750 cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isInitializing ? 'animate-spin' : ''}`} />
            <span>{isInitializing ? 'Retrying Connection...' : 'Retry Connection'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Google Sheets Syncer Status and Direct Link for Admin */}
      {isSheetsActive && sheetsDetails?.url ? (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 animate-fade-in shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100">Live Google Sheets Sync Active</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Connected logbook: <span className="font-semibold text-slate-700 dark:text-slate-200">{sheetsDetails.name || "Factory Material Flow Ledger"}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {onOpenSheetsInspector && (
              <button
                onClick={onOpenSheetsInspector}
                className="flex-1 sm:flex-initial text-center bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-xs py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                title="View actual spreadsheet columns and rows in-app"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>Inspect Live Sheet</span>
              </button>
            )}
            <a
              href={sheetsDetails.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial text-center bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-sans font-bold text-xs py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open Google Sheet</span>
            </a>
            {onDisconnectSheets && (
              <button
                onClick={onDisconnectSheets}
                className="text-xs bg-red-50 hover:bg-red-100 dark:bg-red-950/20 text-red-600 dark:text-red-400 py-2 px-3 rounded-lg font-semibold transition"
                title="Disconnect from Google Sheets"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      ) : (
        onOpenSheetsModal && (
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-750 dark:text-slate-350">Google Sheets Logbook Offline</h4>
                <p className="text-[11px] text-slate-400">Link your Google Sheets account to sync all production transactions, material movements, and rejections.</p>
              </div>
            </div>
            <button
              onClick={onOpenSheetsModal}
              className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs py-2 px-4 rounded-lg transition"
            >
              Link Google Sheets
            </button>
          </div>
        )
      )}

      {/* Sub tabs header */}
      {/* Mobile Select Dropdown */}
      <div className="block md:hidden w-full pb-2">
        <label className="block text-[10px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1.5">
          Select Management Panel
        </label>
        <select
          value={activeSubTab}
          onChange={(e) => {
            setActiveSubTab(e.target.value as any);
            setSearchTerm('');
          }}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-3 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/20 transition-all cursor-pointer"
        >
          <option value="all">🌐 All Panels (Scroll View)</option>
          <option value="users">👤 User Management</option>
          <option value="audit">📄 Enterprise Audit Logs</option>
          <option value="settings">⚙️ Plant Configurations</option>
          <option value="jobs">📦 Job Cards Admin Database</option>
          <option value="movements">🚚 Material Movements Admin</option>
          <option value="stock">📊 Store Stock Sheet</option>
          <option value="company">🏢 Company Profile</option>
        </select>
      </div>

      {/* Desktop Tab Header Buttons */}
      <div className="hidden md:flex border-b border-slate-200 dark:border-slate-800 overflow-x-auto max-w-full scrollbar-none whitespace-nowrap shrink-0">
        <button
          onClick={() => { setActiveSubTab('all'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'all'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-violet-500" />
          All Panels
        </button>
        <button
          onClick={() => { setActiveSubTab('users'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'users'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          User Management
        </button>
        <button
          onClick={() => { setActiveSubTab('audit'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'audit'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Enterprise Audit Logs
        </button>
        <button
          onClick={() => { setActiveSubTab('settings'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-[#E2E8F0] dark:border-slate-800 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'settings'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          Plant Configurations
        </button>
        <button
          onClick={() => { setActiveSubTab('jobs'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-[#E2E8F0] dark:border-slate-800 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'jobs'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Database className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-500" />
          Job Cards Admin Database
        </button>
        <button
          onClick={() => { setActiveSubTab('movements'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-[#E2E8F0] dark:border-slate-800 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'movements'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500" />
          Material Movements Admin
        </button>
        <button
          onClick={() => { setActiveSubTab('stock'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-[#E2E8F0] dark:border-slate-800 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'stock'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-500" />
          Store Stock Sheet
        </button>
        <button
          onClick={() => { setActiveSubTab('company'); setSearchTerm(''); }}
          className={`flex items-center gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 text-xs sm:text-sm font-semibold border-[#E2E8F0] dark:border-slate-800 border-b-2 transition-all whitespace-nowrap shrink-0 ${
            activeSubTab === 'company'
              ? 'border-[#3B82F6] text-[#3B82F6] font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-500" />
          Company Profile
        </button>
      </div>

      {/* SEARCH AND CONTROL ACTION ROW */}
      {activeSubTab !== 'settings' && activeSubTab !== 'company' && (
        <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder={
                activeSubTab === 'users' 
                  ? "Search users by name, email..." 
                  : activeSubTab === 'jobs'
                  ? "Search job cards by party, number or item..."
                  : activeSubTab === 'stock'
                  ? "Search stock items by code or description..."
                  : activeSubTab === 'all'
                  ? "Search all panels simultaneously..."
                  : "Search audit transactions..."
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white dark:bg-slate-850 pl-9 pr-3 py-2 text-xs text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-750 w-full focus:outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/25"
            />
          </div>

          {activeSubTab === 'users' && isManager && (
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="w-full md:w-auto flex items-center justify-center gap-1.5 bg-[#3B82F6] text-white hover:bg-blue-600 font-sans font-bold text-xs py-2.5 px-4 rounded-lg shadow-sm transition-all border border-[#1D4ED8] cursor-pointer"
            >
              <UserPlus className="h-4 w-4" />
              Add User Profile
            </button>
          )}

          {activeSubTab === 'jobs' && isManager && (
            <button
              type="button"
              onClick={() => {
                showConfirm(
                  "CRITICAL WARNING: Purge All Factory & Raw Material Store Data",
                  "Are you sure you want to PERMANENTLY ERASE all active and completed job cards, material movements, notifications, item catalog, and Raw Material Store inventory? This will wipe all application data completely clean! This step is completely irreversible.\n\nTo confirm, type DELETE ALL below:",
                  async () => {
                    try {
                      await DBService.deleteAllJobCards(currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                      showToast("All application data including Raw Material Store wiped successfully.", "success");
                      if (onRefreshJobs) onRefreshJobs();
                    } catch (err: any) {
                      console.error("Purge command failed", err);
                      showToast(`Purge failed: ${err.message || String(err)}`, "error");
                    }
                  },
                  "Confirm Purge All",
                  "Cancel",
                  "DELETE ALL"
                );
              }}
              className="w-full md:w-auto flex items-center justify-center gap-1.5 bg-red-650 hover:bg-red-550 text-white font-sans font-bold text-xs py-2.5 px-4 rounded-lg shadow-sm transition-all border border-red-750 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
              Purge All Data (Inc. Raw Material Store)
            </button>
          )}
        </div>
      )}

      {activeSubTab === 'users' && !isManager && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-805 text-xs flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
          <span>Restricted Access: Only managerial level accounts are authorized to create or modify operator profiles.</span>
        </div>
      )}

      {/* SHOW ADD USER FORM PANEL */}
      {showAddForm && activeSubTab === 'users' && isManager && (
        <form onSubmit={handleCreateUser} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 max-w-xl transition-all">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 font-sans uppercase">
            Create Simulated User profile
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="col-span-1 md:col-span-2">
              <label className="block text-slate-400 font-medium mb-1">Full Name</label>
              <input
                type="text"
                placeholder="Pawan Kumar"
                required
                value={newUserName}
                onChange={e => setNewUserName(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6]/25"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Assign Line / Department</label>
              <select
                value={newUserDept}
                onChange={e => setNewUserDept(e.target.value as Department | 'Admin')}
                disabled={currentUser?.role === 'admin'}
                className="w-full bg-white dark:bg-slate-800 disabled:bg-slate-100 dark:disabled:bg-slate-900/50 disabled:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none"
              >
                <option value="Admin">Admin Console</option>
                <option value="Dispatch">Dispatch Line</option>
                <option value="Purchase">Purchase Department</option>
                <option value="Raw Material Store">Raw Material Store</option>
                <option value="Production">Production Milling</option>
                <option value="Heat Treatment">Heat Treatment Line</option>
                <option value="Plating">Surface Plating</option>
                <option value="Packing">Packing Line</option>
                <option value="Store">Storehouse</option>
              </select>
              {currentUser?.role === 'admin' && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-sans">
                  Locked to your department: <strong>{currentUser.department}</strong>.
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-400 font-medium mb-1">Access Level Role</label>
              <select
                value={newUserRole}
                onChange={e => setNewUserRole(e.target.value as 'staff' | 'admin' | 'super_admin')}
                disabled={currentUser?.role === 'admin'}
                className="w-full bg-white dark:bg-slate-800 disabled:bg-slate-100 dark:disabled:bg-slate-900/50 disabled:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none"
              >
                <option value="staff">Staff Operator (Privilege Tier 2)</option>
                {currentUser?.role === 'super_admin' && (
                  <>
                    <option value="admin">Admin Overseer / Dept Head (Privilege Tier 1)</option>
                    <option value="super_admin">Super Admin Master (Privilege Tier 0)</option>
                  </>
                )}
              </select>
              {currentUser?.role === 'admin' && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 font-sans">
                  Only Super Admins can assign manager roles.
                </p>
              )}
            </div>

            <div className="col-span-1 md:col-span-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newUserCanOutsource}
                  onChange={e => setNewUserCanOutsource(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-4 w-4"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Authorize as Process Outsourcing Assignee (Can handle outsource POs from Dispatch)
                </span>
              </label>
            </div>
          </div>

          {pinError && (
            <div className="text-red-600 text-xs font-bold leading-none animate-bounce">
              ⚠️ {pinError}
            </div>
          )}

          <div className="flex gap-2 justify-end text-xs font-bold pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-4 py-2 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="bg-[#3B82F6] text-white hover:bg-blue-600 border border-[#1D4ED8] px-4 py-2 rounded-lg transition shadow-sm cursor-pointer"
            >
              Save Profile
            </button>
          </div>
        </form>
      )}

      {/* RENDER ACTIVE TAB VIEWPORT */}
      {(activeSubTab === 'users' || activeSubTab === 'all') && (
        <div className="space-y-4">
          {currentUser?.role === 'super_admin' && activeSubTab === 'users' && (
            <div className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 rounded-2xl p-4 space-y-3 shadow-xs animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-xl text-purple-600 dark:text-purple-450 border border-purple-200/50 shrink-0">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-purple-950 dark:text-purple-300 uppercase tracking-wider font-sans">
                    Master Super Admin Access Portal ({currentUser?.name})
                  </h4>
                  <p className="text-[11px] text-purple-800/80 dark:text-purple-400 font-sans mt-0.5 leading-relaxed">
                    You are authenticated as the <strong>Primary Super Admin</strong>. From this console, you can securely onboard new personnel, grant/revoke manager permissions, and remove off-duty users.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-[11px] font-sans">
                <div className="bg-white/80 dark:bg-slate-900/60 border border-purple-100 dark:border-purple-950 p-3 rounded-xl space-y-1.5">
                  <span className="font-extrabold text-purple-950 dark:text-purple-300 uppercase tracking-wider block text-[10px]">How to Add Members:</span>
                  <p className="text-slate-600 dark:text-slate-400 leading-normal">
                    Click the blue <strong>"Add User Profile"</strong> button above. Fill in the member's full name, select their department/work-center line, and choose their access level (Staff, Admin, or Super Admin). A secure random PIN is automatically generated for them under-the-hood.
                  </p>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/60 border border-purple-100 dark:border-purple-950 p-3 rounded-xl space-y-1.5">
                  <span className="font-extrabold text-purple-950 dark:text-purple-300 uppercase tracking-wider block text-[10px]">How to Remove Members:</span>
                  <p className="text-slate-600 dark:text-slate-400 leading-normal">
                    Locate the user profile in the table below. Click the red <strong>Delete</strong> button in their row (or select multiple users and use the bulk operations panel) to permanently delete their workstation profile.
                  </p>
                </div>
              </div>
            </div>
          )}
          {/* BULK ACTIONS PANEL */}
          {selectedUserIds.length > 0 && (
            <div className="bg-[#EFF6FF] dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-2xl p-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shadow-md animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center font-extrabold text-sm text-[#3B82F6] shrink-0 border border-blue-200 dark:border-blue-900/60 shadow-sm animate-none">
                  {selectedUserIds.length}
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-sans">Bulk Operations Panel</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                    Apply single-click administrative overrides to {selectedUserIds.length} selected operator profile(s)
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                {currentUser?.role === 'super_admin' && (
                  <div className="flex items-center gap-1.5 bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                    <span className="text-[9px] text-slate-450 font-bold uppercase tracking-wider">Set Role:</span>
                    <button
                      onClick={() => handleBulkRoleUpdate('staff')}
                      className="px-2 py-0.5 rounded bg-slate-55 hover:bg-slate-150 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-[10px] font-bold transition cursor-pointer"
                    >
                      Staff Operator
                    </button>
                    <button
                      onClick={() => handleBulkRoleUpdate('admin')}
                      className="px-2 py-0.5 rounded bg-slate-55 hover:bg-slate-150 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-[10px] font-bold transition cursor-pointer"
                    >
                      Admin Overseer
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1.5 bg-white dark:bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                  <span className="text-[9px] text-slate-450 font-bold uppercase tracking-wider">Set State:</span>
                  <button
                    onClick={() => handleBulkStatusUpdate(true)}
                    className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/25 text-emerald-600 dark:text-emerald-450 text-[10px] font-bold transition cursor-pointer"
                  >
                    Active
                  </button>
                  <button
                    onClick={() => handleBulkStatusUpdate(false)}
                    className="px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/25 text-rose-600 dark:text-rose-450 text-[10px] font-bold transition cursor-pointer"
                  >
                    Off-duty
                  </button>
                </div>

                <div className="hidden lg:block h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

                <button
                  onClick={handleBulkDelete}
                  className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 transition shadow-sm cursor-pointer ml-auto lg:ml-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Bulk Delete
                </button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            {/* Desktop View: User Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase tracking-wider font-mono border-b border-slate-200 dark:border-slate-800">
                    <th className="py-3 px-4 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={filteredUsers.length > 0 && filteredUsers.filter(u => u.userId !== currentUser?.userId).every(u => selectedUserIds.includes(u.userId))}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-4">Operator Name</th>
                    <th className="py-3 px-4">Operator Authorization PIN</th>
                    <th className="py-3 px-4">Allocated Line</th>
                    <th className="py-3 px-4">Access Level</th>
                    <th className="py-3 px-4">Outsource Assignee</th>
                    <th className="py-3 px-4">Operator State</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.userId} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 text-xs text-slate-700 dark:text-slate-350 hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                      <td className="py-3.5 px-4 text-center w-12">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.userId)}
                          disabled={u.userId === currentUser?.userId}
                          onChange={(e) => handleSelectUser(u.userId, e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                          title={u.userId === currentUser?.userId ? "You cannot select yourself" : "Select operator"}
                        />
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-[#EFF6FF] flex items-center justify-center font-bold text-[#3B82F6] uppercase text-[10px]">
                          {u.name.charAt(0)}
                        </div>
                        {u.name}
                      </td>
                      <td className="py-3.5 px-4 font-mono">
                        {editingUserIdPin === u.userId ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              maxLength={4}
                              value={editUserPinVal}
                              onChange={e => setEditUserPinVal(e.target.value.replace(/\D/g, ''))}
                              className="w-16 px-1.5 py-0.5 text-xs text-center border rounded-md border-[#3B82F6] bg-slate-50 dark:bg-slate-950 font-bold tracking-widest text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                              placeholder="PIN"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSavePinCode(u)}
                              className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 transition"
                              title="Save PIN"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingUserIdPin(null)}
                              className="p-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 transition"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group">
                            <span className="font-bold tracking-widest text-slate-800 dark:text-[#E2E8F0]">{u.pin || '—'}</span>
                            {(currentUser?.role === 'super_admin' || (currentUser?.role === 'admin' && u.department === currentUser.department && u.role === 'staff')) && (
                              <button
                                onClick={() => {
                                  setEditingUserIdPin(u.userId);
                                  setEditUserPinVal(u.pin || '');
                                }}
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-[#3B82F6] transition cursor-pointer md:opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Change PIN code"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        <span className="block text-[10px] text-slate-450 font-sans tracking-normal font-normal">{u.email}</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 font-sans">{u.department}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                          u.role === 'super_admin' ? 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/50' :
                          u.role === 'admin' ? 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50' : 
                          'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}>
                          {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'Staff'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => toggleUserOutsource(u)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 transition-colors ${
                            u.canOutsource
                              ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50'
                              : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                          }`}
                          title="Click to toggle process outsourcing authorization"
                        >
                          {u.canOutsource ? 'Authorized' : 'Not Authorized'}
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          u.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/20 dark:text-rose-400'
                        }`}>
                          {u.active ? 'Active on Floor' : 'Off-duty'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => toggleUserActive(u)}
                            className={`text-[10px] font-bold px-2.5 py-1 rounded transition-colors ${
                              u.active 
                                ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/20' 
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/20'
                            }`}
                          >
                            {u.active ? 'Disable' : 'Enable'}
                          </button>
                          {isManager && u.userId !== currentUser?.userId && (
                            <button
                              onClick={() => {
                                setConfirmDeleteId(u.userId);
                                setConfirmDeleteName(u.name);
                              }}
                              className="text-[10px] font-bold px-2 py-1 rounded bg-red-50 hover:bg-red-150 text-red-600 dark:bg-red-950/20 dark:text-red-400 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Remove User Permanently"
                            >
                              <Trash2 className="h-3 w-3 text-red-500" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View: User Cards */}
            <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800">
              {filteredUsers.length === 0 ? (
                <div className="text-center p-8 space-y-1.5">
                  <span className="text-xl">🔍</span>
                  <p className="text-xs font-semibold text-slate-400 font-mono">No users found</p>
                </div>
              ) : (
                filteredUsers.map(u => (
                  <div key={u.userId} className="p-4 space-y-3.5 bg-white dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.userId)}
                          disabled={u.userId === currentUser?.userId}
                          onChange={(e) => handleSelectUser(u.userId, e.target.checked)}
                          className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed shrink-0 mr-1"
                        />
                        <div className="h-8 w-8 rounded-full bg-[#EFF6FF] flex items-center justify-center font-bold text-[#3B82F6] uppercase text-xs">
                          {u.name.charAt(0)}
                        </div>
                        <div>
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm leading-tight">{u.name}</h4>
                        <span className="text-[10px] text-slate-400 font-mono block">{u.email}</span>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                      u.role === 'super_admin'
                        ? 'bg-purple-50 border-purple-150 text-purple-800 dark:bg-purple-950/30 dark:border-purple-900/40 dark:text-purple-450'
                        : u.role === 'admin' 
                        ? 'bg-red-50 border-red-100 text-red-800 dark:bg-red-950/30 dark:border-red-900/40 dark:text-red-400' 
                        : 'bg-slate-50 border-slate-150 text-slate-600 dark:bg-slate-850 dark:border-slate-800 dark:text-slate-400'
                    }`}>
                      {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : 'Staff'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-850/60 text-xs">
                    <div>
                      <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Allocated Line</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{u.department}</span>
                    </div>
                    <div>
                      <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Authorization PIN</span>
                      {editingUserIdPin === u.userId ? (
                        <div className="flex items-center gap-1 mt-0.5 animate-fadeIn">
                          <input
                            type="text"
                            maxLength={4}
                            value={editUserPinVal}
                            onChange={e => setEditUserPinVal(e.target.value.replace(/\D/g, ''))}
                            className="w-14 px-1 py-0.5 text-xs text-center border rounded border-[#3B82F6] bg-white dark:bg-slate-900 font-bold tracking-widest text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#3B82F6]"
                            placeholder="PIN"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSavePinCode(u)}
                            className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 transition"
                            title="Save PIN"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setEditingUserIdPin(null)}
                            className="p-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 transition"
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="font-bold font-mono tracking-widest text-[#3B82F6]">{u.pin || '—'}</span>
                          {(currentUser?.role === 'super_admin' || (currentUser?.role === 'admin' && u.department === currentUser.department && u.role === 'staff')) && (
                            <button
                              onClick={() => {
                                setEditingUserIdPin(u.userId);
                                setEditUserPinVal(u.pin || '');
                              }}
                              className="p-1 rounded hover:bg-slate-150 dark:hover:bg-slate-800 text-slate-400 hover:text-[#3B82F6] transition cursor-pointer"
                              title="Change PIN code"
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-1.5 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        u.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/20 dark:text-rose-400'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {u.active ? 'Active on Floor' : 'Off-duty'}
                      </span>

                      <button
                        onClick={() => toggleUserOutsource(u)}
                        className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                          u.canOutsource
                            ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50'
                            : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
                        }`}
                      >
                        {u.canOutsource ? 'Outsource Authorized' : 'No Outsource'}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleUserActive(u)}
                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                          u.active 
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/30' 
                            : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30'
                        }`}
                      >
                        {u.active ? 'Disable' : 'Enable'}
                      </button>
                      {isManager && u.userId !== currentUser?.userId && (
                        <button
                          onClick={() => {
                            setConfirmDeleteId(u.userId);
                            setConfirmDeleteName(u.name);
                          }}
                          className="text-[10px] font-bold px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400 flex items-center gap-1 transition-colors cursor-pointer"
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
      </div>
      )}

      {/* RENDER AUDIT LOG VIEWPORT */}
      {(activeSubTab === 'audit' || activeSubTab === 'all') && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          {/* AUDIT BULK ACTIONS PANEL */}
          {selectedAuditLogIds.length > 0 && (
            <div className="bg-[#EFF6FF] dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl p-4 m-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shadow-md animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center font-extrabold text-sm text-[#3B82F6] shrink-0 border border-blue-200 dark:border-blue-900/60 shadow-sm animate-none">
                  {selectedAuditLogIds.length}
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-sans">Bulk Operations Panel</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                    Apply bulk actions to {selectedAuditLogIds.length} selected audit log(s)
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                {isManager && (
                  <button
                    onClick={handleBulkDeleteLogs}
                    className="bg-red-650 hover:bg-red-550 text-white font-sans font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-1.5 shadow-sm transition border border-red-750 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    Bulk Delete Logs
                  </button>
                )}
                <button
                  onClick={() => setSelectedAuditLogIds([])}
                  className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs py-2 px-3 rounded-lg transition cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Desktop View Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase tracking-wider font-mono border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={
                        filteredLogs.length > 0 &&
                        filteredLogs.every(l => selectedAuditLogIds.includes(l.id))
                      }
                      onChange={(e) => handleSelectAllLogs(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Action Event</th>
                  <th className="py-3 px-4">Audit Details</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                {filteredLogs.map(l => (
                  <tr key={l.id} className="text-xs hover:bg-slate-50/50 dark:hover:bg-slate-850/25">
                    <td className="py-3 px-4 text-center w-12">
                      <input
                        type="checkbox"
                        checked={selectedAuditLogIds.includes(l.id)}
                        onChange={(e) => handleSelectLog(l.id, e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400 shrink-0">
                      {new Date(l.timestamp).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-100">{l.userName}</td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[10px] bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-bold">
                        {l.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400 font-sans max-w-sm truncate">{l.details}</td>
                    <td className="py-3 px-4 text-center">
                      {isManager ? (
                        <button
                          type="button"
                          onClick={() => {
                            showConfirm(
                              "Delete Audit Log",
                              "Are you sure you want to permanently delete this audit log? This action is irreversible!",
                              async () => {
                                try {
                                  await DBService.deleteAuditLog(l.id, currentUser?.userId || 'u-1');
                                  showToast("Audit log successfully deleted.", "success");
                                  setSelectedAuditLogIds(prev => prev.filter(id => id !== l.id));
                                  if (onRefreshJobs) onRefreshJobs();
                                } catch (err: any) {
                                  console.error("Deletion failed", err);
                                  showToast(`Failed to delete audit log: ${err instanceof Error ? err.message : String(err)}`, "error");
                                }
                              }
                            );
                          }}
                          className="text-[11px] bg-red-55 hover:bg-red-150 text-red-600 dark:bg-red-950/20 dark:text-red-400 p-1.5 rounded font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                          title="Delete Audit Log"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Admin role required</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile View Timeline Cards */}
          <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {filteredLogs.length === 0 ? (
              <div className="text-center p-8 space-y-1.5">
                <span className="text-xl">🔍</span>
                <p className="text-xs font-semibold text-slate-400 font-mono">No logs found</p>
              </div>
            ) : (
              filteredLogs.map(l => (
                <div key={l.id} className="p-4 space-y-2 hover:bg-slate-50/30 dark:hover:bg-slate-850/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAuditLogIds.includes(l.id)}
                        onChange={(e) => handleSelectLog(l.id, e.target.checked)}
                        className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                      />
                      <span className="font-bold text-slate-900 dark:text-white text-xs">{l.userName}</span>
                    </div>
                    <span className="font-mono text-[9px] text-slate-400">
                      {new Date(l.timestamp).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] bg-indigo-50 dark:bg-indigo-950/25 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                      {l.action}
                    </span>
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => {
                          showConfirm(
                            "Delete Audit Log",
                            "Are you sure you want to permanently delete this audit log? This action is irreversible!",
                            async () => {
                              try {
                                await DBService.deleteAuditLog(l.id, currentUser?.userId || 'u-1');
                                showToast("Audit log successfully deleted.", "success");
                                setSelectedAuditLogIds(prev => prev.filter(id => id !== l.id));
                                if (onRefreshJobs) onRefreshJobs();
                              } catch (err: any) {
                                console.error("Deletion failed", err);
                                showToast(`Failed to delete audit log: ${err instanceof Error ? err.message : String(err)}`, "error");
                              }
                            }
                          );
                        }}
                        className="text-[10px] text-red-600 dark:text-red-400 p-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-450 font-sans leading-relaxed pt-0.5">
                    {l.details}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* RENDER SETTINGS PANEL */}
      {(activeSubTab === 'settings' || activeSubTab === 'all') && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
              <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Warehouse className="h-5 w-5 text-[#3B82F6]" />
                Multi-Plant System Setup
              </h4>
              
              <p className="text-xs text-slate-500 leading-normal">
                Toggle allocations across separate production campuses. Setting coordinates synchronizes ledger books across multiple physical sites.
              </p>

              <div className="space-y-3.5 text-xs">
                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200/50">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Camp #1 - Standard Line</div>
                    <div className="text-[10px] text-slate-400">Main smelting and electroplating lines</div>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Online
                  </span>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200/50">
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">Camp #2 - Heat Assembly</div>
                    <div className="text-[10px] text-slate-400">Satellite hardening line located in Phase 2 block</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Standby
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm">
              <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Activity className="h-5 w-5 text-indigo-500" />
                Firestore Stream Sync Engine
              </h4>

              <p className="text-xs text-slate-500 leading-normal">
                When Firebase applet credentials are fully loaded, real-time sync is enabled. Adjust active websocket timeouts below:
              </p>

              <div className="space-y-4 text-xs font-mono">
                <div>
                  <label className="block text-slate-400 text-[10px] uppercase font-bold mb-1">Listener Stream Timeout</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    pattern="[0-9]*"
                    defaultValue={30} 
                    className="bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-750 p-2 text-slate-700 dark:text-slate-200 w-full"
                  />
                  <span className="text-[9px] text-slate-400">Minutes before websocket connection refresh</span>
                </div>
                
                <div className="p-3 bg-indigo-50/50 dark:bg-slate-850 rounded-lg flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-200">
                  <ShieldAlert className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                  <p className="leading-tight font-sans">
                    The current build incorporates live updates using local storage custom triggers as fallback, guaranteeing immediate reactive views for development evaluation.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* PRODUCTION RAW MATERIAL REQUIREMENT POLICY CARD */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm mt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-indigo-500" />
                  Production Raw Material Compliance Policy
                </h4>
                <p className="text-xs text-slate-500 leading-normal mt-1">
                  Enforce or disable compulsory Raw Material Store issuance validation before production can be started or logged.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {currentUser?.role === 'super_admin' ? (
                  <span className="bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 text-[10px] font-bold px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800">
                    Super Admin Authority
                  </span>
                ) : (
                  <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                    🔒 Super Admin Access Only
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750">
              <div className="space-y-1">
                <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span>Compulsory Raw Material for Production</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    companyConfig?.requireRawMaterialForProduction !== false
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}>
                    {companyConfig?.requireRawMaterialForProduction !== false ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                  {companyConfig?.requireRawMaterialForProduction !== false
                    ? "Currently Enabled: Raw material MUST be issued by Raw Material Store before production can start or move."
                    : "Currently Disabled: Production department CAN start and log output directly without raw material issuance."}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={currentUser?.role !== 'super_admin'}
                  onClick={async () => {
                    if (currentUser?.role !== 'super_admin') return;
                    const newValue = !(companyConfig?.requireRawMaterialForProduction !== false);
                    try {
                      const updatedWithMeta = {
                        ...companyConfig,
                        companyName: companyConfig?.companyName || 'Precision Metal Works',
                        details: companyConfig?.details || 'Specialists in high-tensile fasteners, engine components, and industrial finishes.',
                        requireRawMaterialForProduction: newValue,
                        updatedBy: currentUser?.name || 'Pawan Kumar',
                        updatedAt: new Date().toISOString()
                      };
                      await DBService.saveCompanyConfig(updatedWithMeta, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                      showToast(`Raw Material requirement for production ${newValue ? 'ENABLED (Compulsory)' : 'DISABLED (Optional)'}!`, "success");
                      if (onRefreshCompany) onRefreshCompany();
                    } catch (err) {
                      console.error("Failed to update raw material requirement", err);
                      showToast("Failed to update policy.", "error");
                    }
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer border flex items-center gap-2 ${
                    currentUser?.role !== 'super_admin'
                      ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border-slate-300'
                      : companyConfig?.requireRawMaterialForProduction !== false
                      ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700'
                  }`}
                >
                  {companyConfig?.requireRawMaterialForProduction !== false ? 'Disable Option' : 'Enable Option'}
                </button>
              </div>
            </div>
          </div>



          {/* WHATSAPP GROUP NOTIFICATIONS CARD */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm mt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-emerald-500" />
                    WhatsApp Group Job Card Movement Alerts
                  </h4>
                  {currentUser?.role === 'super_admin' ? (
                    <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                      Super Admin Control
                    </span>
                  ) : (
                    <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                      🔒 Super Admin Only
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal mt-1">
                  When enabled, an automated WhatsApp notification is generated for every Job Card movement containing Job Card No, Item Name, Item Code, Quantity, and Department transfer details.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs font-bold ${companyConfig?.whatsappEnabled !== false ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {companyConfig?.whatsappEnabled !== false ? 'Active (Enabled)' : 'Disabled'}
                </span>
                <button
                  type="button"
                  disabled={currentUser?.role !== 'super_admin'}
                  onClick={async () => {
                    if (currentUser?.role !== 'super_admin') return;
                    const newValue = !(companyConfig?.whatsappEnabled !== false);
                    try {
                      const updatedWithMeta = {
                        ...companyConfig,
                        companyName: companyConfig?.companyName || 'Precision Metal Works',
                        details: companyConfig?.details || 'Specialists in high-tensile fasteners, engine components, and industrial finishes.',
                        whatsappEnabled: newValue,
                        updatedBy: currentUser?.name || 'Pawan Kumar',
                        updatedAt: new Date().toISOString()
                      };
                      await DBService.saveCompanyConfig(updatedWithMeta, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                      showToast(`WhatsApp Movement Notifications feature ${newValue ? 'ENABLED' : 'DISABLED'}!`, "success");
                      if (onRefreshCompany) onRefreshCompany();
                    } catch (err) {
                      console.error("Failed to update WhatsApp notification settings", err);
                      showToast("Failed to update WhatsApp feature toggle.", "error");
                    }
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer border flex items-center gap-2 ${
                    currentUser?.role !== 'super_admin'
                      ? 'opacity-50 cursor-not-allowed bg-slate-200 dark:bg-slate-800 text-slate-500 border-slate-300'
                      : companyConfig?.whatsappEnabled !== false
                      ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-700'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-700'
                  }`}
                >
                  {companyConfig?.whatsappEnabled !== false ? 'Disable Feature' : 'Enable Feature'}
                </button>
              </div>
            </div>

            {/* Quick Test & Live Message Template Preview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200/80 dark:border-slate-800/80 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">WhatsApp Notification Target Settings:</span>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-500 block font-semibold">Group Link or Target Phone Number:</label>
                    <input
                      type="text"
                      disabled={currentUser?.role !== 'super_admin'}
                      value={companyConfig?.whatsappPhoneNumber || ''}
                      onChange={async (e) => {
                        const val = e.target.value;
                        const updated = { ...companyConfig, companyName: companyConfig?.companyName || 'Precision Metal Works', details: companyConfig?.details || '', whatsappPhoneNumber: val };
                        await DBService.saveCompanyConfig(updated, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                        if (onRefreshCompany) onRefreshCompany();
                      }}
                      placeholder="e.g. +91 98765 43210 or WhatsApp Group Invite Link"
                      className="w-full mt-0.5 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 rounded-lg font-mono text-[11px]"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const sampleMsg = formatMovementWhatsAppMessage({
                          jobCardNo: 'JC-1001',
                          quantity: 450,
                          requestedUnit: 'KGS',
                          fromDepartment: 'Production',
                          toDepartment: 'Heat Treatment',
                          transferBy: currentUser?.name || 'Pawan Kumar',
                          transferDate: new Date().toISOString()
                        }, {
                          jobCardNo: 'JC-1001',
                          itemName: 'HEX BOLT M12 x 50',
                          itemCode: 'BOLT-M12-G8',
                          unit: 'KGS'
                        });
                        const url = getWhatsAppShareUrl(sampleMsg, companyConfig?.whatsappPhoneNumber);
                        window.open(url, '_blank');
                        showToast("Opened test WhatsApp message dispatch!", "success");
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[11px] shadow-sm cursor-pointer"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Test WhatsApp Group Dispatch
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-950/10 dark:bg-emerald-950/30 rounded-xl border border-emerald-500/20 space-y-1.5">
                <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 block flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Live Message Format Preview
                </span>
                <pre className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-[10px] font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-tight shadow-inner">
{formatMovementWhatsAppMessage({
  jobCardNo: 'JC-1001',
  quantity: 450,
  requestedUnit: 'KGS',
  fromDepartment: 'Production',
  toDepartment: 'Heat Treatment',
  transferBy: currentUser?.name || 'Pawan Kumar',
  transferDate: new Date().toISOString()
}, {
  jobCardNo: 'JC-1001',
  itemName: 'HEX BOLT M12 x 50',
  itemCode: 'BOLT-M12-G8',
  unit: 'KGS'
})}
                </pre>
              </div>
            </div>
          </div>

          {/* AUTO-BACKUP CONTROLS CARD */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm mt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Database className="h-5 w-5 text-amber-500" />
                  Daily Auto-Backup & System Recovery
                </h4>
                <p className="text-xs text-slate-500 leading-normal mt-1">
                  Configure automated database snapshots. Backups are stored safely in your browser storage and can be manually downloaded or restored.
                </p>
              </div>

              <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 p-2 rounded-xl border border-slate-200/60 dark:border-slate-850 shrink-0">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Daily Auto-Backup:</span>
                <button
                  type="button"
                  onClick={() => handleToggleAutoBackup(!autoBackupActive)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                    autoBackupActive ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-750'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoBackupActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200/50 dark:border-slate-850/60">
              <div className="space-y-1">
                <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">Manual Database Backup & Download</h5>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                  Trigger an instantaneous snapshot of all database collections as a single JSON payload. This will instantly store the backup in your browser and provide a download file.
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5 w-full sm:w-auto shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    exportComprehensiveExcelBackup(jobCards, movements, auditLogs);
                    showToast("Downloaded multi-sheet Excel backup workbook!", "success");
                    onLogAction('EXPORT_EXCEL_BACKUP', 'Downloaded complete 19-sheet Excel backup workbook.');
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm transition cursor-pointer border border-emerald-500"
                  title="Download Excel workbook with a separate sheet for every report"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Download Excel Backup (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={handleManualBackup}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white font-sans font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm transition cursor-pointer"
                >
                  <Database className="h-3.5 w-3.5" />
                  Trigger Manual JSON Backup
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await DBService.clearAllNotifications('All');
                      showToast("All announcement notifications have been erased from system.", "success");
                      onLogAction('CLEAR_NOTIFICATIONS', 'Erased all system announcement notifications.');
                      if (onRefreshJobs) onRefreshJobs();
                    } catch (err: any) {
                      showToast(`Failed to erase notifications: ${err.message || String(err)}`, "error");
                    }
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-sans font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm transition cursor-pointer border border-rose-500"
                  title="Erase all active plant announcements and notifications"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  Erase Announcements
                </button>
              </div>
            </div>

            {/* Backups list */}
            <div className="space-y-3 pt-2">
              <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                Saved Backup Ledger ({storedBackups.length})
              </h5>

              {storedBackups.length === 0 ? (
                <div className="text-center p-6 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 italic text-xs font-mono">
                  No snapshots currently registered in browser storage.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 dark:bg-slate-950/75 text-[10px] text-slate-400 uppercase tracking-widest font-mono border-b border-slate-200 dark:border-slate-800">
                        <th className="py-2.5 px-4 font-bold">Snapshot Filename</th>
                        <th className="py-2.5 px-4 font-bold">Timestamp</th>
                        <th className="py-2.5 px-4 font-bold">Size</th>
                        <th className="py-2.5 px-4 font-bold">Backup Type</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {storedBackups.map((backup) => (
                        <tr key={backup.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition-all">
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {backup.filename}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 font-mono">
                            {new Date(backup.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 font-mono">
                            {(backup.size / 1024).toFixed(2)} KB
                          </td>
                          <td className="py-2.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              backup.type === 'auto'
                                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-750 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40'
                                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-750 dark:text-amber-400 border border-amber-100 dark:border-amber-900/40'
                            }`}>
                              {backup.type === 'auto' ? 'Automated' : 'Manual'}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleDownloadFile(backup)}
                                className="text-[10px] text-emerald-600 dark:text-emerald-400 p-1.5 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                title="Download JSON file"
                              >
                                <Download className="h-3 w-3" />
                                Download
                              </button>
                              <button
                                onClick={() => {
                                  showConfirm(
                                    "Confirm Database Restore",
                                    `Are you sure you want to restore the database to backup snapshot ${backup.filename}? This will OVERWRITE your current live database. This step is irreversible.`,
                                    () => handleRestoreBackup(backup),
                                    "Restore Database",
                                    "Cancel"
                                  );
                                }}
                                className="text-[10px] text-indigo-600 dark:text-indigo-400 p-1.5 rounded bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                title="Restore database to this point"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Restore
                              </button>
                              <button
                                onClick={() => {
                                  showConfirm(
                                    "Delete Backup Snapshot",
                                    `Are you sure you want to delete backup snapshot ${backup.filename} from your browser?`,
                                    () => handleDeleteBackup(backup.id, backup.filename),
                                    "Delete",
                                    "Cancel"
                                  );
                                }}
                                className="text-[10px] text-red-600 dark:text-red-400 p-1.5 rounded bg-red-50 hover:bg-red-100 dark:bg-red-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                title="Delete backup snapshot"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* SYSTEM RECOVERY DANGER ZONE */}
          <div className="bg-rose-50/40 dark:bg-rose-950/5 border border-rose-150 dark:border-rose-900/20 rounded-2xl p-6 space-y-4 shadow-sm mt-6">
            <h4 className="font-sans font-bold text-sm text-rose-800 dark:text-rose-400 uppercase tracking-wider flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-rose-600 animate-pulse" />
              Administrative Danger Zone
            </h4>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              Perform a global factory reset. This action will clear all live data (including custom job cards, material movements, user accounts, and notifications) and restore the system to its initial pristine pre-seeded demonstration data state.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-rose-100/40 dark:border-rose-900/10">
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Reset System to Pre-Seeded Default State</span>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Reinitializes Firestore and local storage using initial default factory datasets.</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  showConfirm(
                    "CRITICAL CONFIRMATION: Factory Reset System",
                    "Are you sure you want to trigger a FULL SYSTEM RESET? This will permanently wipe all active job cards, custom material movements, notifications, audit logs, and user profiles, restoring everything to the default demo seed state.\n\nTo confirm, type FACTORY RESET below:",
                    async () => {
                      try {
                        await DBService.factoryReset(currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                        showToast("System factory reset completed successfully! Re-seeded initial default datasets.", "success");
                        if (onRefreshJobs) onRefreshJobs();
                      } catch (err: any) {
                        console.error("Factory Reset failed", err);
                        showToast(`Factory Reset failed: ${err.message || String(err)}`, "error");
                      }
                    },
                    "Reset System",
                    "Cancel",
                    "FACTORY_RESET"
                  );
                }}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-sans font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm transition border border-rose-750 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Factory Reset Database
              </button>
            </div>
          </div>
        </>
      )}

      {/* RENDER JOBS MANAGEMENT PANEL */}
      {(activeSubTab === 'jobs' || activeSubTab === 'all') && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                Active & Closed Job Cards Ledger
              </h4>
              <p className="text-[11px] text-slate-400 italic">Manage, search, or administratively remove individual manufacturing runs.</p>
            </div>
            <div className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 p-1.5 rounded border border-slate-200 dark:border-slate-700">
              Total Recorded Lines: <strong>{jobCards.length.toLocaleString()}</strong>
            </div>
          </div>

          {/* HIGH-SCALE LOAD TESTING WIDGET */}
          <div className="bg-slate-50 dark:bg-slate-950/40 p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900 mb-1.5 animate-pulse">
                ⚡ Enterprise Scalability Tool
              </span>
              <h5 className="font-sans font-extrabold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-wide flex items-center gap-1">
                High-Speed Load Test (100,000 Entries)
              </h5>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal mt-0.5 max-w-2xl">
                Writing 100,000 real documents to standard Firestore exceeds Spark Plan limits (<strong>20,000 writes/day</strong>). 
                Use this high-speed local memory injector to load <strong>100,000 active Job Cards</strong> in-memory instantly to test live search, filtering, and sorting speeds under maximum scale.
              </p>
            </div>
            <div className="flex gap-2 shrink-0 w-full md:w-auto">
              <button
                type="button"
                onClick={handleGenerate100kSimulated}
                disabled={isGenerating100k}
                className="w-full md:w-auto bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-sans font-bold text-xs py-2 px-3.5 rounded-lg shadow-sm transition border border-indigo-700 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Activity className="h-3.5 w-3.5" />
                {isGenerating100k ? 'Injecting...' : 'Inject 100,000 Cards'}
              </button>
              {jobCards.length > 200 && (
                <button
                  type="button"
                  onClick={handleResetToOriginal}
                  className="w-full md:w-auto bg-slate-200 dark:bg-slate-850 hover:bg-slate-300 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-sans font-bold text-xs py-2 px-3 rounded-lg transition border border-slate-300 dark:border-slate-750 cursor-pointer flex items-center justify-center gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reset
                </button>
              )}
            </div>
          </div>
          
          {/* JOBS BULK ACTIONS PANEL */}
          {selectedJobNos.length > 0 && (
            <div className="bg-[#EFF6FF] dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl p-4 m-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shadow-md animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center font-extrabold text-sm text-[#3B82F6] shrink-0 border border-blue-200 dark:border-blue-900/60 shadow-sm animate-none">
                  {selectedJobNos.length}
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-slate-850 dark:text-slate-100 uppercase tracking-wider font-sans">Bulk Operations Panel</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
                    Apply bulk actions to {selectedJobNos.length} selected job card(s)
                  </p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                <button
                  onClick={() => setShowBulkStatusModal(true)}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-sans font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-1.5 shadow-sm transition border border-amber-600 cursor-pointer"
                  title="Change status for selected job cards"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Bulk Update Status
                </button>
                <button
                  onClick={handleBulkDeleteJobs}
                  className="bg-red-650 hover:bg-red-550 text-white font-sans font-bold text-xs py-2 px-4 rounded-lg flex items-center gap-1.5 shadow-sm transition border border-red-750 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  Bulk Delete Job Cards
                </button>
                <button
                  onClick={() => setSelectedJobNos([])}
                  className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs py-2 px-3 rounded-lg transition cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* Bulk Status Update Modal */}
          <BulkStatusUpdateModal
            isOpen={showBulkStatusModal}
            onClose={() => setShowBulkStatusModal(false)}
            selectedJobNos={selectedJobNos}
            onConfirmUpdate={handleBulkJobStatusUpdate}
          />

          <div className="overflow-x-auto">
            {jobCards.filter(j => 
              j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
              j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
              j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
            ).length === 0 ? (
              <div className="text-center p-12 space-y-1.5">
                <span className="text-2xl">🔍</span>
                <p className="text-xs font-semibold text-slate-400 font-mono">No job cards match query parameters</p>
              </div>
            ) : (
              <>
                {/* Desktop View Table */}
                <div className="hidden md:block">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 dark:bg-slate-950/75 text-[10px] text-slate-400 uppercase tracking-widest font-mono border-b border-slate-200 dark:border-slate-800">
                        <th className="py-3 px-4 w-12 text-center">
                          <input
                            type="checkbox"
                            checked={
                              jobCards.length > 0 &&
                              jobCards
                                .filter(j => 
                                  j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                  j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                                )
                                .every(j => selectedJobNos.includes(j.jobCardNo))
                            }
                            onChange={(e) => handleSelectAllJobs(e.target.checked)}
                            className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-4">Card No</th>
                        <th className="py-3 px-4">Customer / Party Name</th>
                        <th className="py-3 px-4">Item Details</th>
                        <th className="py-3 px-4">Order Qty</th>
                        <th className="py-3 px-4">Active Station</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                      {jobCards
                        .filter(j => 
                          j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .slice(0, 100)
                        .map(j => (
                          <tr key={j.jobCardNo} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/25">
                            <td className="py-3 px-4 text-center w-12">
                              <input
                                type="checkbox"
                                checked={selectedJobNos.includes(j.jobCardNo)}
                                onChange={(e) => handleSelectJob(j.jobCardNo, e.target.checked)}
                                className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                              />
                            </td>
                            <td className="py-3 px-4 font-mono font-extrabold text-indigo-500">{j.jobCardNo}</td>
                            <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-100">{j.partyName}</td>
                            <td className="py-2 px-4 leading-normal">
                              <p className="font-medium text-slate-700 dark:text-slate-300">{j.itemName}</p>
                              <p className="text-[10px] font-mono text-slate-400">{j.itemCode}</p>
                            </td>
                            <td className="py-3 px-4 font-mono">{j.orderQty.toLocaleString()} KG</td>
                            <td className="py-3 px-4 font-medium text-slate-500 dark:text-slate-400">{j.currentDepartment}</td>
                            <td className="py-3 px-4">
                              <JobStatusBadge status={j.status} size="sm" />
                            </td>
                            <td className="py-3 px-4 text-center">
                              {isManager ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    showConfirm(
                                      "Delete Job Card",
                                      `Are you sure you want to permanently delete Job Card ${j.jobCardNo}? This action is irreversible, and all related material transitions and notifications will be deleted!`,
                                      async () => {
                                        try {
                                          await DBService.deleteJobCard(j.jobCardNo, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                                          showToast(`Job Card ${j.jobCardNo} successfully removed.`, "success");
                                          if (onRefreshJobs) onRefreshJobs();
                                        } catch (err: any) {
                                          console.error("Deletion failed", err);
                                          showToast(`Failed to delete Job Card: ${err instanceof Error ? err.message : String(err)}`, "error");
                                        }
                                      }
                                    );
                                  }}
                                  className="text-[11px] bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/20 dark:text-red-400 p-1.5 rounded font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                                  title="Delete Selected Job Card"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">Admin role required</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View Cards */}
                <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {jobCards
                    .filter(j => 
                      j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                    )
                    .slice(0, 100)
                    .map(j => (
                      <div key={j.jobCardNo} className="p-4 space-y-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedJobNos.includes(j.jobCardNo)}
                              onChange={(e) => handleSelectJob(j.jobCardNo, e.target.checked)}
                              className="rounded border-slate-300 dark:border-slate-700 text-[#3B82F6] focus:ring-[#3B82F6] h-3.5 w-3.5 cursor-pointer"
                            />
                            <span className="font-mono font-extrabold text-sm text-indigo-500">{j.jobCardNo}</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider">Customer / Party Name</span>
                          <p className="font-bold text-slate-900 dark:text-white text-xs">{j.partyName}</p>
                        </div>

                        <div className="space-y-1">
                          <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider">Item Details</span>
                          <p className="font-semibold text-slate-700 dark:text-slate-200 text-xs leading-normal">{j.itemName}</p>
                          <span className="font-mono text-[10px] text-slate-400 block">{j.itemCode}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-850/60 text-xs">
                          <div>
                            <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Order Qty</span>
                            <span className="font-bold font-mono text-slate-800 dark:text-slate-200">{j.orderQty.toLocaleString()} KG</span>
                          </div>
                          <div>
                            <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Active Station</span>
                            <span className="font-semibold text-slate-750 dark:text-slate-300">{j.currentDepartment}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-150 dark:border-slate-800/80">
                          <JobStatusBadge status={j.status} size="sm" />
                          {isManager && (
                            <button
                              type="button"
                              onClick={() => {
                                showConfirm(
                                  "Delete Job Card",
                                  `Are you sure you want to permanently delete Job Card ${j.jobCardNo}? This action is irreversible, and all related material transitions and notifications will be deleted!`,
                                  async () => {
                                    try {
                                      await DBService.deleteJobCard(j.jobCardNo, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                                      showToast(`Job Card ${j.jobCardNo} successfully removed.`, "success");
                                      if (onRefreshJobs) onRefreshJobs();
                                    } catch (err: any) {
                                      console.error("Deletion failed", err);
                                      showToast(`Failed to delete Job Card: ${err instanceof Error ? err.message : String(err)}`, "error");
                                    }
                                  }
                                );
                              }}
                              className="text-[10px] text-red-600 dark:text-red-400 p-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Slicing / Pagination Warning notice */}
                {jobCards.filter(j => 
                  j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                ).length > 100 && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-150 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-[11px] flex flex-col sm:flex-row justify-between items-center gap-1.5 font-sans">
                    <span>
                      Showing first <strong>100</strong> rows of <strong>{jobCards.filter(j => 
                        j.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        j.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        j.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                      ).length.toLocaleString()}</strong> matching entries.
                    </span>
                    <span className="font-semibold text-indigo-500 font-mono text-[10px] uppercase tracking-wide bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-150 dark:border-indigo-900/40">
                      Virtualized Rendering Active
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* RENDER MATERIAL MOVEMENTS ADMIN PANEL */}
      {(activeSubTab === 'movements' || activeSubTab === 'all') && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
            <div>
              <h4 className="font-sans font-bold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-amber-500" />
                Material Movements Admin Ledger
              </h4>
              <p className="text-[11px] text-slate-400 italic">Administratively monitor, modify, or delete specific department-to-department transit records.</p>
            </div>
            <div className="text-[10px] font-mono text-slate-500 bg-slate-100 dark:bg-slate-800 p-1.5 rounded border border-slate-200 dark:border-slate-700">
              Total Recorded Movements: <strong>{movements.length.toLocaleString()}</strong>
            </div>
          </div>

          <div className="overflow-x-auto">
            {movements.filter(m => 
              m.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
              m.transferBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
              m.fromDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
              m.toDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
              (m.accepted ? 'accepted' : 'pending').includes(searchTerm.toLowerCase())
            ).length === 0 ? (
              <div className="text-center p-12 space-y-1.5">
                <span className="text-2xl">🔍</span>
                <p className="text-xs font-semibold text-slate-400 font-mono">No material movements match query parameters</p>
              </div>
            ) : (
              <>
                {/* Desktop View Table */}
                <div className="hidden md:block">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/75 dark:bg-slate-950/75 text-[10px] text-slate-400 uppercase tracking-widest font-mono border-b border-slate-200 dark:border-slate-800">
                        <th className="py-3 px-4 font-bold">Movement ID</th>
                        <th className="py-3 px-4 font-bold">Job Card No</th>
                        <th className="py-3 px-4 font-bold">Transfer Routing</th>
                        <th className="py-3 px-4 font-bold">Quantity (KG)</th>
                        <th className="py-3 px-4 font-bold">Transit Status</th>
                        <th className="py-3 px-4 font-bold">Initiated By / Date</th>
                        <th className="py-3 px-4 font-bold">Action History</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {movements
                        .filter(m => 
                          m.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.transferBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.fromDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.toDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (m.accepted ? 'accepted' : 'pending').includes(searchTerm.toLowerCase())
                        )
                        .slice(0, 100)
                        .map((m) => {
                          const isEditing = editingMovementId === m.movementId;
                          return (
                            <tr key={m.movementId} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/20 transition-all">
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                                {m.movementId}
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-[#3B82F6] hover:underline cursor-pointer">
                                {m.jobCardNo}
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                  <span className="font-medium">{m.fromDepartment}</span>
                                  <span className="text-slate-400">➔</span>
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">{m.toDepartment}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={editMovementQty || ''}
                                    onChange={(e) => setEditMovementQty(Number(e.target.value.replace(/[^0-9.]/g, '')))}
                                    className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-[#3B82F6]"
                                  />
                                ) : (
                                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                                    {m.quantity.toLocaleString()} KG
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  m.accepted
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-750 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40'
                                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-750 dark:text-amber-400 border border-amber-100 dark:border-amber-900/40'
                                }`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${m.accepted ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                                  {m.accepted ? 'Accepted' : 'In Transit (Pending)'}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                                <div className="font-medium text-slate-800 dark:text-slate-200">{m.transferBy}</div>
                                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{new Date(m.transferDate).toLocaleString()}</div>
                              </td>
                              <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 space-y-1">
                                {m.initiatedByUserName && (
                                  <div className="text-[10px] font-medium leading-tight">
                                    <span className="text-slate-400">Initiated by:</span> <strong className="text-slate-700 dark:text-slate-300">{m.initiatedByUserName}</strong>
                                  </div>
                                )}
                                {m.acceptedBy && (
                                  <div className="text-[10px] font-medium leading-tight">
                                    <span className="text-emerald-550 font-bold">Accepted by:</span> <strong className="text-emerald-700 dark:text-emerald-300">{m.acceptedBy}</strong>
                                    {m.acceptedDate && <span className="text-slate-400 font-mono text-[9px] block">{new Date(m.acceptedDate).toLocaleString()}</span>}
                                  </div>
                                )}
                                {m.modifiedByUserName && (
                                  <div className="text-[10px] font-medium leading-tight">
                                    <span className="text-indigo-500 font-bold">Last Modified ({m.modifiedAction}):</span> <strong className="text-indigo-700 dark:text-indigo-300">{m.modifiedByUserName}</strong>
                                    {m.modifiedDate && <span className="text-slate-400 font-mono text-[9px] block">{new Date(m.modifiedDate).toLocaleString()}</span>}
                                  </div>
                                )}
                                {m.remarks && (
                                  <div className="text-[10px] italic text-slate-400 max-w-[180px] truncate leading-tight">
                                    "{m.remarks}"
                                  </div>
                                )}
                                {isEditing && (
                                  <div className="mt-1">
                                    <input
                                      type="text"
                                      placeholder="Remarks/Audit notes..."
                                      value={editMovementRemarks}
                                      onChange={(e) => setEditMovementRemarks(e.target.value)}
                                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-800 dark:text-slate-100 focus:outline-none"
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {isEditing ? (
                                    <>
                                      <button
                                        onClick={async () => {
                                          if (!onUpdateMovement) return;
                                          try {
                                            await onUpdateMovement(m.movementId, editMovementQty, editMovementRemarks);
                                            setEditingMovementId(null);
                                          } catch (err) {
                                            console.error(err);
                                          }
                                        }}
                                        className="text-[10px] text-white bg-indigo-600 hover:bg-indigo-500 px-2 py-1 rounded font-bold transition-all cursor-pointer"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => setEditingMovementId(null)}
                                        className="text-[10px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-1 rounded font-bold transition-all cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingMovementId(m.movementId);
                                          setEditMovementQty(m.quantity);
                                          setEditMovementRemarks(m.remarks || '');
                                        }}
                                        className="text-[10px] text-indigo-600 dark:text-indigo-400 p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                      >
                                        <Edit className="h-3.5 w-3.5" />
                                        Modify
                                      </button>
                                      <button
                                        onClick={() => {
                                          showConfirm(
                                            "Confirm Movement Deletion",
                                            `Are you sure you want to delete material movement ${m.movementId}? This action will wipe this transit record and is logged in the Enterprise Audit Logs.`,
                                            async () => {
                                              if (onDeleteMovement) {
                                                await onDeleteMovement(m.movementId);
                                              }
                                            },
                                            "Wipe Movement",
                                            "Cancel"
                                          );
                                        }}
                                        className="text-[10px] text-red-600 dark:text-red-400 p-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Wipe
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile View Cards */}
                <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800">
                  {movements
                    .filter(m => 
                      m.jobCardNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      m.transferBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      m.fromDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      m.toDepartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      (m.accepted ? 'accepted' : 'pending').includes(searchTerm.toLowerCase())
                    )
                    .slice(0, 100)
                    .map((m) => {
                      const isEditing = editingMovementId === m.movementId;
                      return (
                        <div key={m.movementId} className="p-4 space-y-3 bg-white dark:bg-slate-900">
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-200">
                                {m.movementId}
                              </span>
                              <h5 className="font-bold text-sm text-[#3B82F6] hover:underline cursor-pointer mt-0.5">
                                {m.jobCardNo}
                              </h5>
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              m.accepted
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-750 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40'
                                : 'bg-amber-50 dark:bg-amber-950/40 text-amber-750 dark:text-amber-400 border border-amber-100 dark:border-amber-900/40'
                            }`}>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {m.accepted ? 'Accepted' : 'Pending'}
                            </span>
                          </div>

                          <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-500">Routing:</span>
                              <span className="font-medium text-slate-800 dark:text-slate-200">{m.fromDepartment}➔{m.toDepartment}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-500">Weight:</span>
                              {isEditing ? (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editMovementQty || ''}
                                  onChange={(e) => setEditMovementQty(Number(e.target.value.replace(/[^0-9.]/g, '')))}
                                  className="w-20 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none"
                                />
                              ) : (
                                <span className="font-mono font-bold text-slate-850 dark:text-slate-100">{m.quantity.toLocaleString()} KG</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-normal pt-1 border-t border-slate-100 dark:border-slate-800/60">
                              {m.initiatedByUserName && <div>Initiator: {m.initiatedByUserName} ({new Date(m.transferDate).toLocaleDateString()})</div>}
                              {m.acceptedBy && <div>Accepted by: {m.acceptedBy} {m.acceptedDate && `(${new Date(m.acceptedDate).toLocaleDateString()})`}</div>}
                              {m.modifiedByUserName && <div>Modified: {m.modifiedByUserName} ({m.modifiedAction})</div>}
                              {m.remarks && <div className="italic mt-0.5">"{m.remarks}"</div>}
                            </div>
                            {isEditing && (
                              <div className="mt-2">
                                <input
                                  type="text"
                                  placeholder="Remarks/Audit notes..."
                                  value={editMovementRemarks}
                                  onChange={(e) => setEditMovementRemarks(e.target.value)}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-[10px] text-slate-800 dark:text-slate-100 focus:outline-none"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={async () => {
                                    if (!onUpdateMovement) return;
                                    try {
                                      await onUpdateMovement(m.movementId, editMovementQty, editMovementRemarks);
                                      setEditingMovementId(null);
                                    } catch (err) {
                                      console.error(err);
                                    }
                                  }}
                                  className="text-[10px] text-white bg-indigo-600 hover:bg-indigo-505 px-2 py-1 rounded font-bold transition-all cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingMovementId(null)}
                                  className="text-[10px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-1 rounded font-bold transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingMovementId(m.movementId);
                                    setEditMovementQty(m.quantity);
                                    setEditMovementRemarks(m.remarks || '');
                                  }}
                                  className="text-[10px] text-indigo-600 dark:text-indigo-400 p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                  Modify
                                </button>
                                <button
                                  onClick={() => {
                                    showConfirm(
                                      "Confirm Movement Deletion",
                                      `Are you sure you want to delete material movement ${m.movementId}? This action will wipe this transit record and is logged in the Enterprise Audit Logs.`,
                                      async () => {
                                        if (onDeleteMovement) {
                                          await onDeleteMovement(m.movementId);
                                        }
                                      },
                                      "Wipe Movement",
                                      "Cancel"
                                    );
                                  }}
                                  className="text-[10px] text-red-600 dark:text-red-400 p-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/20 font-bold transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Wipe
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* RENDER STORE STOCK SHEET */}
      {(activeSubTab === 'stock' || activeSubTab === 'all') && (
        <div className="space-y-4">
          <div className="p-5 bg-gradient-to-r from-emerald-550/10 to-teal-555/10 dark:from-slate-900 dark:to-slate-950 border border-emerald-500/10 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h4 className="font-sans font-bold text-base text-emerald-800 dark:text-emerald-400 flex items-center gap-2">
                <Package className="h-5 w-5" />
                Storehouse Inventory & Stock register
              </h4>
              <p className="text-xs text-slate-500 max-w-xl leading-normal mt-1">
                Compiled material ledger showcasing cumulative weights ingested through completed packaging milestones vs outgoing dispatches. Bins coordinates denote current warehouse storage locations.
              </p>
            </div>
            
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-xs py-2 px-3 rounded-lg flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                Print Stock Ledger
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              {(() => {
                const stockMap: Record<string, {
                  itemCode: string;
                  itemName: string;
                  qtyIngested: number;
                  qtyDispatched: number;
                  qtyInStock: number;
                  bins: Set<string>;
                  lastUpdated: string;
                }> = {};

                jobCards.forEach(j => {
                  const m = getJobCardProcessMetrics(j, movements);
                  const key = j.itemCode || 'UNKNOWN';
                  
                  if (!stockMap[key]) {
                    stockMap[key] = {
                      itemCode: key,
                      itemName: j.itemName,
                      qtyIngested: 0,
                      qtyDispatched: 0,
                      qtyInStock: 0,
                      bins: new Set<string>(),
                      lastUpdated: j.createdAt
                    };
                  }
                  
                  stockMap[key].qtyIngested += m.qtyReceivedAtStore;
                  stockMap[key].qtyDispatched += m.qtyDispatched;
                  stockMap[key].qtyInStock += m.qtyRemainingInStock;
                  if (j.storeDetails?.locationBin) {
                    stockMap[key].bins.add(j.storeDetails.locationBin);
                  }
                  if (new Date(j.createdAt) > new Date(stockMap[key].lastUpdated)) {
                    stockMap[key].lastUpdated = j.createdAt;
                  }
                });

                const stockList = Object.values(stockMap).filter(s =>
                  s.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  s.itemName.toLowerCase().includes(searchTerm.toLowerCase())
                );

                if (stockList.length === 0) {
                  return (
                    <div className="text-center p-12 space-y-1.5">
                      <span className="text-2xl">📦</span>
                      <p className="text-xs font-semibold text-slate-400 font-mono">No physical storehouse stock data found matching search criteria</p>
                    </div>
                  );
                }

                return (
                  <>
                    {/* Desktop View Table */}
                    <div className="hidden md:block">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-400 uppercase tracking-widest font-mono border-b border-slate-200 dark:border-slate-800">
                            <th className="py-3.5 px-4 font-mono">Item Code</th>
                            <th className="py-3.5 px-4">Product Name</th>
                            <th className="py-3.5 px-4 text-right bg-blue-500/5 dark:bg-blue-950/20 text-blue-700 dark:text-blue-350">Cum. Ingested (KG)</th>
                            <th className="py-3.5 px-4 text-right bg-pink-500/5 dark:bg-pink-950/20 text-pink-700 dark:text-pink-350">Cum. Dispatched (KG)</th>
                            <th className="py-3.5 px-4 text-right bg-emerald-500/5 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-300 font-bold">In-Stock Balance (KG)</th>
                            <th className="py-3.5 px-4 text-center">Allocated Bins</th>
                            <th className="py-3.5 px-4 text-center">Ledger Refresh</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                          {stockList.map(s => (
                            <tr key={s.itemCode} className="hover:bg-slate-50/40 dark:hover:bg-slate-850/15">
                              <td className="py-3.5 px-3 font-mono font-bold text-[#3B82F6]">{s.itemCode}</td>
                              <td className="py-3.5 px-3 font-semibold text-slate-800 dark:text-slate-100">{s.itemName}</td>
                              <td className="py-3.5 px-3 font-mono text-right bg-blue-500/5 dark:bg-blue-950/20 text-slate-700 dark:text-slate-300 font-medium">{s.qtyIngested.toLocaleString()} KG</td>
                              <td className="py-3.5 px-3 font-mono text-right bg-pink-500/5 dark:bg-pink-950/10 text-slate-700 dark:text-slate-300 font-medium">{s.qtyDispatched.toLocaleString()} KG</td>
                              <td className="py-3.5 px-4 font-mono text-right bg-emerald-500/5 dark:bg-emerald-950/15 text-emerald-600 dark:text-emerald-400 font-bold rounded">
                                {s.qtyInStock.toLocaleString()} KG
                              </td>
                              <td className="py-3.5 px-4 text-center font-mono text-[11px]">
                                {s.bins.size > 0 ? (
                                  Array.from(s.bins).map(bin => (
                                    <span key={bin} className="inline-block bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-bold mr-1">{bin}</span>
                                  ))
                                ) : (
                                  <span className="text-slate-400 italic text-[10px]">No Bin Tagged</span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-center text-slate-400 text-[10px]">
                                {new Date(s.lastUpdated).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile View Cards */}
                    <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {stockList.map(s => (
                        <div key={s.itemCode} className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-mono font-bold text-indigo-500 text-xs">{s.itemCode}</span>
                              <h4 className="font-bold text-slate-900 dark:text-white text-xs mt-0.5">{s.itemName}</h4>
                            </div>
                            <span className="font-mono text-[9px] text-slate-400 shrink-0">
                              {new Date(s.lastUpdated).toLocaleDateString([], {month: 'short', day: 'numeric'})}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 text-center">
                            <div className="bg-blue-50/60 dark:bg-blue-950/20 p-2 rounded-lg border border-blue-100/50 dark:border-blue-900/20 animate-none">
                              <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider">Ingested</span>
                              <span className="font-bold font-mono text-blue-700 dark:text-blue-400 text-[11px]">{s.qtyIngested.toLocaleString()}</span>
                            </div>
                            <div className="bg-pink-50/60 dark:bg-pink-950/20 p-2 rounded-lg border border-pink-100/50 dark:border-pink-900/20 animate-none">
                              <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider">Dispatched</span>
                              <span className="font-bold font-mono text-pink-700 dark:text-pink-400 text-[11px]">{s.qtyDispatched.toLocaleString()}</span>
                            </div>
                            <div className="bg-emerald-50/60 dark:bg-emerald-950/35 p-2 rounded-lg border border-emerald-100/50 dark:border-emerald-900/25 animate-none">
                              <span className="block text-[8px] text-slate-400 uppercase font-bold tracking-wider">In Stock</span>
                              <span className="font-extrabold font-mono text-emerald-600 dark:text-emerald-400 text-[11px]">{s.qtyInStock.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[8px] text-slate-400 uppercase font-bold tracking-wider">Bins:</span>
                            <div className="flex flex-wrap gap-1">
                              {s.bins.size > 0 ? (
                                Array.from(s.bins).map(bin => (
                                  <span key={bin} className="inline-block bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded text-[9px] font-bold">{bin}</span>
                                ))
                              ) : (
                                <span className="text-slate-400 italic text-[9px]">None</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Target delete modal overlay */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <h3 className="text-base font-extrabold text-red-600 uppercase tracking-wider flex items-center gap-1.5 text-red-650 font-sans">
              <ShieldAlert className="h-5 w-5 text-red-600" />
              Confirm Personnel Deletion
            </h3>
            <p className="text-xs text-slate-500 leading-normal">
              Are you sure you want to permanently delete the profile of <strong className="text-slate-800 dark:text-slate-200">{confirmDeleteName}</strong>? This action cannot be undone, and they will lose access to the workstation immediately.
            </p>
            <div className="flex gap-2 justify-end text-xs font-bold font-sans">
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteId(null);
                  setConfirmDeleteName('');
                }}
                className="bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 px-4 py-2.5 rounded-lg transition"
              >
                No, Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmDeleteId) {
                    onDeleteUser(confirmDeleteId, confirmDeleteName);
                  }
                  setConfirmDeleteId(null);
                  setConfirmDeleteName('');
                }}
                className="bg-red-600 text-white hover:bg-red-500 border border-red-700 px-4 py-2.5 rounded-lg transition shadow-sm cursor-pointer"
              >
                Yes, Delete Permanent
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RENDER COMPANY PROFILE UPDATE PAGE */}
      {(activeSubTab === 'company' || activeSubTab === 'all') && (
        <div className="space-y-6 animate-fade-in">
          <div className="p-5 bg-gradient-to-r from-amber-500/10 to-orange-500/10 dark:from-slate-900 dark:to-slate-950 border border-amber-500/15 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h4 className="font-sans font-bold text-base text-amber-800 dark:text-amber-400 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-amber-500" />
                Active Corporate Identity & Works Profile
              </h4>
              <p className="text-xs text-slate-500 max-w-xl leading-normal mt-1">
                Customize your company name, registration metadata, and contact details. Content updated here is globally referenced for report printing, job cards databases, and general ledger headers across the enterprise nodes.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Display View Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50 flex flex-col items-center justify-center">
                    <span className="text-2xl font-extrabold tracking-tight font-mono">
                      {companyConfig?.companyName ? companyConfig.companyName.substring(0, 2).toUpperCase() : 'PM'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold font-mono text-amber-500 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded">
                      Enterprise Hub
                    </span>
                    <h3 className="font-sans font-extrabold text-base text-slate-800 dark:text-slate-100 mt-1">
                      {companyConfig?.companyName || 'Precision Metal Works'}
                    </h3>
                  </div>
                </div>

                <hr className="border-slate-100 dark:border-slate-800" />

                <div className="space-y-3.5 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 font-mono block uppercase">Corporate Details</span>
                    <p className="text-slate-600 dark:text-slate-350 font-medium leading-relaxed mt-0.5">
                      {companyConfig?.details || 'Specialists in high-tensile fasteners, engine components, and industrial finishes.'}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-mono block uppercase">Registered Contact</span>
                    <p className="font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                      {companyConfig?.phone || '+91 98765 43210'}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-mono block uppercase">GSTIN Registration</span>
                    <p className="font-mono text-slate-700 dark:text-slate-200 mt-0.5 font-bold">
                      {companyConfig?.gstIn || '27AAAAA1111A1Z1'}
                    </p>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 font-mono block uppercase">Physical Facility Address</span>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                      {companyConfig?.address || 'Shed No. 12, Phase II, Industrial Area, Pune, MH, India'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-[10px] font-mono text-slate-400 flex justify-between items-center">
                <span>Last Updated By:</span>
                <strong className="text-slate-600 dark:text-slate-300">
                  {companyConfig?.updatedBy || 'System Init'}
                </strong>
              </div>
            </div>

            {/* Editing Form */}
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
              <h4 className="font-sans font-bold text-sm text-slate-805 dark:text-slate-200 uppercase tracking-wider mb-4">
                Operational Identity Setup Form
              </h4>

              {isManager ? (
                <CompanyForm 
                  companyConfig={companyConfig} 
                  currentUser={currentUser}
                  showToast={showToast}
                  onSave={async (updated) => {
                    try {
                      const updatedWithMeta = {
                        ...updated,
                        updatedBy: currentUser?.name || 'Pawan Kumar',
                        updatedAt: new Date().toISOString()
                      };
                      await DBService.saveCompanyConfig(updatedWithMeta, currentUser?.userId || 'u-1', currentUser?.name || 'Pawan Kumar');
                      showToast("Corporate Works Profile successfully synchronized to the secure cloud ledger!", "success");
                      if (onRefreshCompany) onRefreshCompany();
                    } catch (err) {
                      console.error("Failed to save corporate parameters", err);
                      showToast("Critical error: Unable to authenticate secure write block.", "error");
                    }
                  }} 
                />
              ) : (
                <div className="p-8 border border-amber-200 bg-amber-50/50 dark:bg-slate-850 dark:border-slate-800 rounded-xl space-y-3 text-center">
                  <ShieldAlert className="h-8 w-8 text-amber-500 mx-auto" />
                  <h5 className="font-bold text-xs text-amber-900 dark:text-amber-400 uppercase tracking-wide">Access Restricted</h5>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Adjusting company metadata and global business registration parameters requires high-level administrative credentials. Operator accounts are authorized for passive inspection only.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog Overlay with verification support */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in text-slate-800 dark:text-slate-100">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              ⚠️ {confirmDialog.title}
            </h3>
            <p className="text-xs text-slate-650 dark:text-slate-300 mt-3 whitespace-pre-wrap leading-relaxed">
              {confirmDialog.message}
            </p>
            
            {confirmDialog.requireText && (
              <div className="mt-4 space-y-2">
                <span className="block text-[10px] uppercase font-bold tracking-wider text-slate-400">Verification Phrase Needed</span>
                <input
                  type="text"
                  value={verificationInput}
                  placeholder={`Type "${confirmDialog.requireText}"`}
                  className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-xs font-bold font-mono uppercase focus:outline-none focus:ring-1 focus:ring-red-550"
                  id="confirm_verification_input"
                  onChange={(e) => setVerificationInput(e.target.value)}
                />
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setConfirmDialog(null);
                  setVerificationInput('');
                }}
                className="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                {confirmDialog.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                id="btn_confirm_modal_submit"
                disabled={confirmDialog.requireText ? verificationInput.trim().toUpperCase() !== confirmDialog.requireText.trim().toUpperCase() : false}
                onClick={async () => {
                  const onConf = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  setVerificationInput('');
                  await onConf();
                }}
                className="px-5 py-2.5 bg-red-650 hover:bg-red-750 disabled:opacity-30 disabled:hover:bg-red-650 text-white rounded-xl transition shadow-sm cursor-pointer"
              >
                {confirmDialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Non-blocking Toast Alerts */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[999] max-w-sm w-full px-4 animate-bounce-in">
          <div className={`
            flex items-center gap-3 p-4 rounded-xl shadow-lg border text-sm font-medium
            ${toast.type === 'success' 
              ? 'bg-emerald-50 dark:bg-emerald-950/85 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200' 
              : toast.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/85 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
              : 'bg-blue-50 dark:bg-blue-950/85 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200'}
          `}>
            <div className="shrink-0">
              {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
            </div>
            <div className="grow text-xs leading-normal">
              {toast.message}
            </div>
            <button 
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-450 hover:text-slate-650 dark:hover:text-slate-200 shrink-0 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}


    </div>
  );
}

interface CompanyFormProps {
  companyConfig: CompanyConfig | null;
  currentUser?: UserProfile | null;
  onSave: (config: Omit<CompanyConfig, 'updatedBy' | 'updatedAt'>) => Promise<void>;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

function CompanyForm({ companyConfig, currentUser, onSave, showToast }: CompanyFormProps) {
  const [companyName, setCompanyName] = useState(companyConfig?.companyName || 'Precision Metal Works');
  const [details, setDetails] = useState(companyConfig?.details || 'Specialists in high-tensile fasteners, engine components, and industrial finishes.');
  const [phone, setPhone] = useState(companyConfig?.phone || '+91 98765 43210');
  const [address, setAddress] = useState(companyConfig?.address || 'Shed No. 12, Phase II, Industrial Area, Pune, MH, India');
  const [gstIn, setGstIn] = useState(companyConfig?.gstIn || '27AAAAA1111A1Z1');
  const [requireRawMaterialForProduction, setRequireRawMaterialForProduction] = useState<boolean>(companyConfig?.requireRawMaterialForProduction !== false);
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(companyConfig?.whatsappEnabled !== false);
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState(companyConfig?.whatsappPhoneNumber || '');
  const [whatsappApiUrl, setWhatsappApiUrl] = useState(companyConfig?.whatsappApiUrl || '');
  const [whatsappAutoOpenShare, setWhatsappAutoOpenShare] = useState<boolean>(companyConfig?.whatsappAutoOpenShare !== false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (companyConfig) {
      setCompanyName(companyConfig.companyName);
      setDetails(companyConfig.details);
      setPhone(companyConfig.phone || '');
      setAddress(companyConfig.address || '');
      setGstIn(companyConfig.gstIn || '');
      setRequireRawMaterialForProduction(companyConfig.requireRawMaterialForProduction !== false);
      setWhatsappEnabled(companyConfig.whatsappEnabled !== false);
      setWhatsappPhoneNumber(companyConfig.whatsappPhoneNumber || '');
      setWhatsappApiUrl(companyConfig.whatsappApiUrl || '');
      setWhatsappAutoOpenShare(companyConfig.whatsappAutoOpenShare !== false);
    }
  }, [companyConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      if (showToast) {
        showToast("Company Name is required.", "error");
      } else {
        alert("Company Name is required.");
      }
      return;
    }
    setSaving(true);
    try {
      await onSave({ 
        companyName, 
        details, 
        phone, 
        address, 
        gstIn, 
        requireRawMaterialForProduction,
        whatsappEnabled,
        whatsappPhoneNumber,
        whatsappApiUrl,
        whatsappAutoOpenShare
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-xs">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5 col-span-1 md:col-span-2">
          <label className="block font-semibold text-slate-500 dark:text-slate-400">Registered Company Name *</label>
          <input
            type="text"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-755 p-2.5 text-slate-850 dark:text-slate-100 font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 font-bold"
            placeholder="e.g. Precision Metal Works Ltd."
          />
        </div>

        <div className="space-y-1.5 col-span-1 md:col-span-2">
          <label className="block font-semibold text-slate-500 dark:text-slate-400">Works Scope / Operational Description</label>
          <textarea
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-755 p-2.5 text-slate-850 dark:text-slate-100 font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 animate-none resize-none"
            placeholder="Provide a summary of factory line specialty..."
          />
        </div>

        <div className="space-y-1.5">
          <label className="block font-semibold text-slate-500 dark:text-slate-400">Corporate Phone / Support Line</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-755 p-2.5 text-slate-850 dark:text-slate-100 font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
            placeholder="e.g. +91 99999 88888"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block font-semibold text-slate-500 dark:text-slate-400">Tax ID / GSTIN Registration</label>
          <input
            type="text"
            value={gstIn}
            onChange={(e) => setGstIn(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-755 p-2.5 text-slate-850 dark:text-slate-100 font-mono focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 uppercase"
            placeholder="e.g. 27AAAAA1111A1Z1"
          />
        </div>

        <div className="space-y-1.5 col-span-1 md:col-span-2">
          <label className="block font-semibold text-slate-500 dark:text-slate-400">Factory Site Physical Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-850 rounded border border-slate-200 dark:border-slate-755 p-2.5 text-slate-850 dark:text-slate-100 font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
            placeholder="e.g. Phase 2 Industrial Layout, Pune"
          />
        </div>

        {/* Production Raw Material Requirement Toggle (Super Admin Only) */}
        <div className="col-span-1 md:col-span-2 space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750">
            <div className="space-y-1">
              <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                <span>🪵 Compulsory Raw Material Issue for Production</span>
                {currentUser?.role === 'super_admin' ? (
                  <span className="bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                    Super Admin Authority
                  </span>
                ) : (
                  <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                    🔒 Super Admin Only
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                {requireRawMaterialForProduction
                  ? "COMPULSORY (ENABLED): Production department cannot start job cards or log output unless raw material is issued by Raw Store."
                  : "OPTIONAL (DISABLED): Production department can start job cards and log production output directly without raw material issuance."}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-[11px] font-bold ${requireRawMaterialForProduction ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {requireRawMaterialForProduction ? 'Compulsory' : 'Optional'}
              </span>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  disabled={currentUser?.role !== 'super_admin'}
                  checked={requireRawMaterialForProduction}
                  onChange={(e) => {
                    if (currentUser?.role !== 'super_admin') return;
                    setRequireRawMaterialForProduction(e.target.checked);
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-amber-500 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
              </label>
            </div>
          </div>
        </div>

        {/* WhatsApp Group Notification Settings (Super Admin Only) */}
        <div className="col-span-1 md:col-span-2 space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="p-4 bg-emerald-950/10 dark:bg-emerald-950/30 rounded-xl border border-emerald-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                    WhatsApp Group Notifications for Job Card Movement
                  </span>
                  {currentUser?.role === 'super_admin' ? (
                    <span className="bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800">
                      Super Admin Authority
                    </span>
                  ) : (
                    <span className="bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                      🔒 Super Admin Only
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-normal">
                  Automatically send instant formatted alerts containing Job Card No, Item Name, Item Code, Quantity, and Transfer direction to your WhatsApp Group whenever material moves between departments.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[11px] font-bold ${whatsappEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                  {whatsappEnabled ? 'Enabled' : 'Disabled'}
                </span>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    disabled={currentUser?.role !== 'super_admin'}
                    checked={whatsappEnabled}
                    onChange={(e) => {
                      if (currentUser?.role !== 'super_admin') return;
                      setWhatsappEnabled(e.target.checked);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
                </label>
              </div>
            </div>

            {whatsappEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-emerald-500/20 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">WhatsApp Group Phone No. / Target Link</label>
                  <input
                    type="text"
                    disabled={currentUser?.role !== 'super_admin'}
                    value={whatsappPhoneNumber}
                    onChange={(e) => setWhatsappPhoneNumber(e.target.value)}
                    placeholder="e.g. +91 98765 43210 or Group Link"
                    className="w-full bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">WhatsApp API Webhook Endpoint (Optional)</label>
                  <input
                    type="url"
                    disabled={currentUser?.role !== 'super_admin'}
                    value={whatsappApiUrl}
                    onChange={(e) => setWhatsappApiUrl(e.target.value)}
                    placeholder="e.g. https://api.whatsapp-gateway.com/send"
                    className="w-full bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="col-span-1 md:col-span-2 flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={currentUser?.role !== 'super_admin'}
                      checked={whatsappAutoOpenShare}
                      onChange={(e) => setWhatsappAutoOpenShare(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Automatically open WhatsApp share window when a material movement is created
                    </span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-2 text-right">
        <button
          type="submit"
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-500 text-white font-sans font-bold text-xs py-2.5 px-6 rounded-xl shadow-sm transition border border-amber-700 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving ? 'Syncing...' : 'Save & Publish Profile'}
        </button>
      </div>
    </form>
  );
}
