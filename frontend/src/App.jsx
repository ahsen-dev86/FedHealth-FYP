// frontend/src/App.jsx
// Routing + auth guard. Public: /login, /mfa. Everything else requires a session
// and renders inside the Layout shell. The index route sends each user to their
// role's home (doctor -> /doctor; surveillance -> /surveillance, added in Module 8).
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import MfaPage from './auth/MfaPage';
import Layout from './components/Layout';
import DoctorPortal from './doctor/DoctorPortal';
import SurveillanceDashboard from './surveillance/SurveillanceDashboard';
import ModelHealthDashboard from './model-health/ModelHealthDashboard';
import HelpPortalPage from './help/HelpPortalPage';
import NgoProfilePage from './help/NgoProfilePage';
import NgoDashboard from './ngo/NgoDashboard';
import './tailwind.css';

// Wrap a page: require a session, then render it inside the shell.
function LoadingScreen() {
  return (
    <div className="grid min-h-full place-items-center bg-background p-6">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function Protected({ children }) {
  const { isAuthed, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <LoadingScreen />;
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <Layout>{children}</Layout>;
}

// Bare redirect (no shell) that routes each role to its home.
function RoleHome() {
  const { isAuthed, loading, can, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (can('prediction:create')) return <Navigate to="/doctor" replace />;
  if (can('nih:dashboard')) return <Navigate to="/surveillance" replace />;
  if (user?.role === 'ngo') return <Navigate to="/ngo" replace />;
  return <Navigate to="/doctor" replace />;
}

function NotFound() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">Not available</h3>
      <p className="mt-1 text-sm text-muted-foreground">This area isn't available for your role, or the page doesn't exist.</p>
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
          <Route path="/help" element={<HelpPortalPage />} />
          <Route path="/help/ngos/:id" element={<NgoProfilePage />} />
          <Route path="/" element={<RoleHome />} />
          <Route path="/doctor" element={<Protected><DoctorPortal /></Protected>} />
          <Route path="/surveillance" element={<Protected><SurveillanceDashboard /></Protected>} />
          <Route path="/model-health" element={<Protected><ModelHealthDashboard /></Protected>} />
          <Route path="/ngo" element={<Protected><NgoDashboard /></Protected>} />
          <Route path="*" element={<Protected><NotFound /></Protected>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
