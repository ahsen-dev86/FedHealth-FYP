// frontend/src/components/Layout.jsx
// Shared shell for authenticated pages: topbar with role-aware nav + user
// chip, then the page content. Wrapped around every /doctor and /surveillance
// route by the Protected guard in App.jsx.
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Display-only labels, decoupled from the backend role slug (which stays
// e.g. 'nih_official' to match Module 2/6 RBAC) so the UI can use generic
// wording without a backend contract change.
const ROLE_LABELS = {
  doctor: 'Doctor',
  lab_tech: 'Lab technician',
  nih_official: 'Health official',
};

export default function Layout({ children }) {
  const { user, can, logout } = useAuth();

  return (
    <div className="fh-app">
      <div className="fh-topbar">
        <div className="fh-topbar__inner">
          <div className="fh-brand">Fed<span>Health</span></div>
          <nav style={{ display: 'flex', gap: 4 }}>
            {can('prediction:create') && <NavLink to="/doctor">Doctor Portal</NavLink>}
            {can('nih:dashboard') && <NavLink to="/surveillance">Surveillance Dashboard</NavLink>}
          </nav>
          <div className="fh-topbar__spacer" />
          {user && (
            <div className="fh-userchip">
              <span>{user.fullName || user.email}</span>
              <span className="role">{ROLE_LABELS[user.role] || (user.role || '').replace(/_/g, ' ')}</span>
              <button className="fh-btn fh-btn--ghost" style={{ padding: '4px 10px' }} onClick={logout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="fh-main">{children}</div>
    </div>
  );
}
