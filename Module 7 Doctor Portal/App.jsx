// frontend/src/App.jsx
// Routing + auth guard. Public: /login, /mfa. Everything else requires a session
// and renders inside the Layout shell. The index route sends each user to their
// role's home (doctor -> /doctor; NIH -> /nih, added in Module 8).
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import MfaPage from './auth/MfaPage';
import Layout from './components/Layout';
import DoctorPortal from './doctor/DoctorPortal';
import './styles.css';

// Wrap a page: require a session, then render it inside the shell.
function Protected({ children }) {
  const { isAuthed, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="fh-auth"><p className="fh-muted">Loading…</p></div>;
  }
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <Layout>{children}</Layout>;
}

// Bare redirect (no shell) that routes each role to its home.
function RoleHome() {
  const { isAuthed, loading, can } = useAuth();
  if (loading) return <div className="fh-auth"><p className="fh-muted">Loading…</p></div>;
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (can('prediction:create')) return <Navigate to="/doctor" replace />;
  if (can('nih:dashboard')) return <Navigate to="/nih" replace />;
  return <Navigate to="/doctor" replace />;
}

function NotFound() {
  return (
    <div className="fh-card">
      <div className="fh-card__body">
        <h3>Not available</h3>
        <p className="fh-muted">This area isn’t available for your role, or the page doesn’t exist.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mfa" element={<MfaPage />} />
          <Route path="/" element={<RoleHome />} />
          <Route path="/doctor" element={<Protected><DoctorPortal /></Protected>} />
          {/* /nih is added in Module 8 (NIH Dashboard). */}
          <Route path="*" element={<Protected><NotFound /></Protected>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
