import React, { createContext, useContext, useState, useEffect } from 'react';
import { DBService } from '../lib/firebase';
import { UserProfile } from '../types';

// ─── Shape ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  currentUser: UserProfile | null;
  setCurrentUser: (u: UserProfile | null) => void;

  // Login form state
  loginName: string;
  loginPin: string;
  showPin: boolean;
  authError: string;
  isVerifyingPin: boolean;
  selectedLoginUser: UserProfile | null;
  selectedDeptFilter: string;
  userSearchQuery: string;

  setLoginName: (v: string) => void;
  setLoginPin: (v: string) => void;
  setShowPin: (v: boolean) => void;
  setAuthError: (v: string) => void;
  setSelectedLoginUser: (u: UserProfile | null) => void;
  setSelectedDeptFilter: (v: string) => void;
  setUserSearchQuery: (v: string) => void;

  // Registration
  isRegistering: boolean;
  regName: string;
  regSuccess: string;
  setIsRegistering: (v: boolean) => void;
  setRegName: (v: string) => void;
  setRegSuccess: (v: string) => void;

  // Actions
  handleUsernamePinLogin: (users: UserProfile[], e?: React.FormEvent) => Promise<void>;
  handleLogout: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function AuthProvider({ children, showToast }: Props) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  // Login form
  const [loginName, setLoginName] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [selectedLoginUser, setSelectedLoginUser] = useState<UserProfile | null>(null);
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('All');
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  // Registration
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regSuccess, setRegSuccess] = useState('');

  // ── Auto-submit when 4-digit PIN is entered ───────────────────────────────
  // Note: the actual call is wired in App.tsx via a useEffect that calls
  // handleUsernamePinLogin, because it needs the current users list.

  // ── Login ─────────────────────────────────────────────────────────────────

  const handleUsernamePinLogin = async (users: UserProfile[], e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isVerifyingPin) return;
    setAuthError('');
    setRegSuccess('');

    const nameToMatch = loginName.trim().toLowerCase();
    const pinToMatch = loginPin.trim();

    if (!nameToMatch) {
      setAuthError('Please enter your Registered Full Name.');
      return;
    }
    if (pinToMatch.length !== 4) {
      setAuthError('Please enter your 4-digit Security PIN.');
      return;
    }

    const matchedUser = users.find(u => u.name.trim().toLowerCase() === nameToMatch);
    if (!matchedUser) {
      setAuthError('Invalid credentials. Please verify your Registered Full Name and Security PIN.');
      return;
    }
    if (!matchedUser.active) {
      setAuthError(`Your profile (${matchedUser.name}) is currently inactive. Please contact your manager.`);
      setLoginPin('');
      return;
    }

    setIsVerifyingPin(true);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(matchedUser.userId)}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pinToMatch,
          pinHash: matchedUser.pinHash || null,
          // fallbackPin removed — plaintext PIN is no longer stored or transmitted
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'Authentication failed');
      }

      const result = await response.json();

      if (!result.success) {
        setAuthError('Invalid credentials. Please verify your Registered Full Name and Security PIN.');
        setLoginPin('');
        setIsVerifyingPin(false);
        return;
      }

      if (result.newPinHash && !matchedUser.pinHash) {
        DBService.updateUser(matchedUser.userId, { pinHash: result.newPinHash }).catch(e => {
          console.warn('Could not save upgraded pinHash:', e);
        });
      }

      setCurrentUser({ ...matchedUser, pinHash: result.newPinHash || matchedUser.pinHash });
      sessionStorage.setItem('mfr_active_user_uid', matchedUser.userId);
      setLoginName('');
      setLoginPin('');
      setSelectedLoginUser(null);
      await DBService.logAction(matchedUser.userId, matchedUser.name, 'USER_LOGIN', 'Logged in via secure bcrypt PIN verification.');
    } catch (err: any) {
      console.warn('Backend PIN verification warning:', err);
      setAuthError('Could not reach verification service. Please check your connection and try again.');
      setLoginPin('');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = () => {
    setCurrentUser(null);
    sessionStorage.removeItem('mfr_active_user_uid');
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider
      value={{
        currentUser, setCurrentUser,
        loginName, loginPin, showPin, authError, isVerifyingPin,
        selectedLoginUser, selectedDeptFilter, userSearchQuery,
        setLoginName, setLoginPin, setShowPin, setAuthError,
        setSelectedLoginUser, setSelectedDeptFilter, setUserSearchQuery,
        isRegistering, regName, regSuccess,
        setIsRegistering, setRegName, setRegSuccess,
        handleUsernamePinLogin, handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
