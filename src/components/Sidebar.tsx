import React, { useState, useEffect } from 'react';
import { 
  Factory, 
  Truck, 
  Layers, 
  Flame, 
  ShieldCheck, 
  PackageCheck, 
  Warehouse, 
  Users, 
  FileText, 
  Bell, 
  Activity, 
  X
} from 'lucide-react';
import { Department, UserProfile, CompanyConfig } from '../types';
import { isFirestoreOffline } from '../lib/firebase';
import AppLogo from './AppLogo';

interface SidebarProps {
  currentUser: UserProfile;
  availableUsers: UserProfile[];
  onSwitchUser: (userId: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  unreadCount: number;
  isOpen?: boolean;
  onClose?: () => void;
  companyConfig?: CompanyConfig | null;
}

export default function Sidebar({
  currentUser,
  availableUsers,
  onSwitchUser,
  activeTab,
  setActiveTab,
  unreadCount,
  isOpen,
  onClose,
  companyConfig = null
}: SidebarProps) {
  const [isOffline, setIsOffline] = useState(isFirestoreOffline);

  useEffect(() => {
    const handleStatusChange = (e: any) => {
      setIsOffline(e.detail.isOffline);
    };
    window.addEventListener('firestore-status-change', handleStatusChange);
    return () => window.removeEventListener('firestore-status-change', handleStatusChange);
  }, []);
  // Determine menu items based on department and role
  const isAdminOrSuperAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin';
  const isSystemAdmin = isAdminOrSuperAdmin || currentUser.department === 'Admin';

  const menuItems = [
    { id: 'dashboard', label: 'Department Panel', icon: Factory },
    { id: 'all-orders', label: 'All Job Cards', icon: FileText },
    { id: 'outsource', label: 'Process Outsourcing', icon: Truck },
    { id: 'timeline-live', label: 'Real-Time Tracking', icon: Activity },
    { id: 'reports', label: 'Reports & Analytics', icon: Layers },
  ];

  if (isAdminOrSuperAdmin) {
    menuItems.push(
      { id: 'admin-users', label: 'Admin Console', icon: ShieldCheck }
    );
  }

  // Define department badges for UI styling
  const getDepartmentColor = (dept: string) => {
    switch (dept) {
      case 'Admin': return 'bg-cyan-600 text-white';
      case 'Purchase': return 'bg-teal-600 text-white';
      case 'Raw Material Store': return 'bg-indigo-600 text-white';
      case 'Dispatch': return 'bg-amber-600 text-white';
      case 'Production': return 'bg-blue-600 text-white';
      case 'Heat Treatment': return 'bg-red-600 text-white';
      case 'Plating': return 'bg-purple-600 text-white';
      case 'Packing': return 'bg-pink-600 text-white';
      case 'Store': return 'bg-emerald-600 text-white';
      default: return 'bg-gray-600 text-white';
    }
  };

  return (
    <aside className="w-full h-full bg-[#0F172A] text-[#E2E8F0] flex flex-col border-r border-[#1E293B]">
      {/* Top Header Logo */}
      <div className="p-5 pt-[max(env(safe-area-inset-top,0px),1.75rem)] lg:pt-5 border-b border-[#1E293B] flex items-center justify-between gap-2 text-ellipsis overflow-hidden">
        <div className="flex items-center gap-3 min-w-0">
          <AppLogo size="sm" />
          <div className="min-w-0">
            <h1 className="font-sans font-extrabold leading-none tracking-tight text-xs text-white uppercase truncate text-ellipsis" title={companyConfig?.companyName || 'PRO-MFG TRACK'}>
              {companyConfig?.companyName || 'PRO-MFG TRACK'}
            </h1>
            <p className="font-mono text-[9px] text-slate-400 mt-1 uppercase tracking-wider flex items-center gap-1.5">
              <span>Site Node #1 Live</span>
              {isOffline ? (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Local Storage Offline Fallback Mode" />
              ) : (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title="Connected to Firestore Cloud Storage" />
              )}
            </p>
          </div>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="lg:hidden p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            title="Close navigation menu"
            id="btn_close_sidebar_icon"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* User Information Profile Block */}
      <div className="p-4 border-b border-[#1E293B] bg-[#0F172A]/40">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[#1E293B] border border-slate-700 flex items-center justify-center text-[#3B82F6] font-bold uppercase text-xs">
            {currentUser.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-semibold text-white truncate text-ellipsis">
              {currentUser.name}
            </h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide ${getDepartmentColor(currentUser.department)}`}>
                {currentUser.department}
              </span>
              {(() => {
                const extraDepts = Array.from(new Set([
                  ...(currentUser.accessList || []),
                  ...(currentUser.allowedDepartments || [])
                ])).filter(d => d !== currentUser.department);
                if (extraDepts.length > 0 && currentUser.role !== 'super_admin') {
                  return (
                    <span 
                      className="text-[9px] bg-indigo-900/80 text-indigo-200 border border-indigo-700/60 px-1.5 py-0.5 rounded font-bold uppercase cursor-help"
                      title={`Multi-Dept Authority: ${extraDepts.join(', ')}`}
                    >
                      +{extraDepts.length} Depts
                    </span>
                  );
                }
                return null;
              })()}
              {currentUser.role === 'super_admin' && (
                <span className="text-[9px] bg-purple-700 text-purple-100 px-1 py-0.5 rounded font-bold uppercase">
                  SUPER
                </span>
              )}
              {currentUser.role === 'admin' && (
                <span className="text-[9px] bg-red-800 text-red-100 px-1 py-0.5 rounded font-bold uppercase">
                  ADM
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Primary Navigation Menu */}
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        <p className="text-[9px] text-slate-500 font-bold tracking-wider uppercase px-4 mb-2">
          Operations Nav
        </p>
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (onClose) onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 lg:py-2.5 min-h-[44px] text-sm lg:text-xs font-semibold transition-all duration-200 text-left cursor-pointer ${
                isActive 
                  ? 'bg-[#1E293B] text-white border-l-4 border-[#3B82F6] opacity-100 pl-3' 
                  : 'text-[#E2E8F0] opacity-70 hover:opacity-100 hover:bg-[#1E293B] pl-4'
              }`}
            >
              <IconComponent className={`h-4 w-4 ${isActive ? 'text-[#3B82F6]' : 'text-slate-400'}`} />
              <span>{item.label}</span>
              {item.id === 'dashboard' && unreadCount > 0 && (
                <span className="ml-auto bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
