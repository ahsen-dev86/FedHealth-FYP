// frontend/src/auth/AuthContext.jsx
// ---------------------------------------------------------------------------
// Auth state + flows, matching the Module 2 backend:
//   login -> (mfaSetupRequired | mfaRequired) -> mfa verify -> access token.
// The access token is kept in localStorage so a refresh doesn't log the user
// out. NOTE: localStorage is readable by JS, so a strict production build would
// use an httpOnly cookie instead (XSS hardening) — flagged for the supervisor.
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setTokenGetter, setUnauthorizedHandler } from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY = 'fedhealth_token';
export const NOTICE_KEY = 'fedhealth_notice';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Let the api client read the current token without importing React state.
  useEffect(() => { setTokenGetter(() => token); }, [token]);

  // On boot (or token change), resolve the current user profile.
  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) { setUser(null); setLoading(false); return; }
      try {
        const me = await api.get('/auth/me');
        if (active) setUser(me);
      } catch {
        if (active) { setToken(null); localStorage.removeItem(TOKEN_KEY); setUser(null); }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [token]);

  const saveToken = useCallback((t) => {
    localStorage.setItem(TOKEN_KEY, t);
    // Set loading in the same update as the token so the route guard sees
    // "still resolving" instead of a one-render window where the token is
    // set but /auth/me hasn't returned yet (isAuthed false -> redirects to
    // /login right after a successful MFA verify).
    setLoading(true);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Any API call rejected with 401 while signed in = the session expired or the
  // account was suspended: sign out and tell the user on the login page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      try { sessionStorage.setItem(NOTICE_KEY, 'Your session has expired. Please sign in again.'); } catch { /* ignore */ }
      logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // --- Auth flow calls (return the backend payloads to the pages) ---------
  const login = useCallback((email, password) =>
    api.post('/auth/login', { email, password }), []);

  const register = useCallback((payload) =>
    api.post('/auth/register', payload), []);

  const mfaSetup = useCallback((preAuthToken) =>
    api.post('/auth/mfa/setup', {}, preAuthToken), []);

  const mfaVerifySetup = useCallback(async (preAuthToken, code) => {
    const { accessToken } = await api.post('/auth/mfa/verify-setup', { code }, preAuthToken);
    saveToken(accessToken);
    return accessToken;
  }, [saveToken]);

  const mfaVerify = useCallback(async (preAuthToken, code) => {
    const { accessToken } = await api.post('/auth/mfa/verify', { code }, preAuthToken);
    saveToken(accessToken);
    return accessToken;
  }, [saveToken]);

  const value = useMemo(() => ({
    token, user, loading,
    isAuthed: !!token && !!user,
    can: (perm) => !!user && user.permissions?.includes(perm),
    login, register, mfaSetup, mfaVerifySetup, mfaVerify, logout,
  }), [token, user, loading, login, register, mfaSetup, mfaVerifySetup, mfaVerify, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook for consuming the auth context; throws if used outside AuthProvider so
// misplaced components fail fast instead of silently getting a null user.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
