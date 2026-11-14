// frontend/src/App.jsx
// Routing + auth guard.
//   /                 public landing page (every visitor starts here)
//   /login, /mfa      sign in / register / two-factor
//   /help/...         public Help Portal
//   /app              sends a signed-in user to their role's portal
//   everything else   requires a session and renders inside the Layout shell
//   /recommendations/:condition  the doctor's reading window (own window, no shell)
// Portal pages are code-split, so the landing page loads without the charting
// and map libraries the dashboards need.
import { Component, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LandingPage from './landing/LandingPage';
import LoginPage from './auth/LoginPage';
import MfaPage from './auth/MfaPage';
import Layout from './components/Layout';
import './tailwind.css';

const DoctorPortal = lazy(() => import('./doctor/DoctorPortal'));
const RecommendationsPage = lazy(() => import('./doctor/RecommendationsPage'));
const SurveillanceDashboard = lazy(() => import('./surveillance/SurveillanceDashboard'));
const ModelHealthDashboard = lazy(() => import('./model-health/ModelHealthDashboard'));
const HelpPortalPage = lazy(() => import('./help/HelpPortalPage'));
const NgoProfilePage = lazy(() => import('./help/NgoProfilePage'));
const NgoDashboard = lazy(() => import('./ngo/NgoDashboard'));
const LabDashboard = lazy(() => import('./lab/LabDashboard'));
const AdminConsole = lazy(() => import('./admin/AdminConsole'));

function LoadingScreen() {
  return (
    <div className="grid min-h-[40vh] place-items-center bg-background p-6" role="status">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

// A rendering error in one page shows a recoverable message instead of a blank screen.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) { console.error('[fedhealth] page error:', error); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-full place-items-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong on this page</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your data is safe. Reload the page; if it happens again, tell your administrator what you were doing.
          </p>
          <button type="button" onClick={() => window.location.reload()}
                  className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Reload
          </button>
        </div>
      </div>
    );
  }
}

// Require a session; `bare` renders the page without the sidebar shell.
function Protected({ children, bare = false }) {
  const { isAuthed, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <LoadingScreen />;
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: loc }} />;
  const page = <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
  return bare ? page : <Layout>{page}</Layout>;
}

// Bare redirect (no shell) that routes each role to its home.
function RoleHome() {
  const { isAuthed, loading, can, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!isAuthed) return <Navigate to="/login" replace />;
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (can('prediction:create')) return <Navigate to="/doctor" replace />;
  if (can('nih:dashboard')) return <Navigate to="/surveillance" replace />;
  if (can('lab:dashboard')) return <Navigate to="/lab" replace />;
  if (user?.role === 'ngo') return <Navigate to="/ngo" replace />;
  return <Navigate to="/doctor" replace />;
}

function NotFound() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">Not available</h3>
      <p className="mt-1 text-sm text-muted-foreground">This area isn't available for your role, or the page doesn't exist.</p>
      <Link to="/app" className="mt-3 inline-block text-sm font-medium text-primary">Go to my portal</Link>
    </div>
  );
}

const Public = ({ children }) => <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/mfa" element={<MfaPage />} />
            <Route path="/help" element={<Public><HelpPortalPage /></Public>} />
            <Route path="/help/ngos/:id" element={<Public><NgoProfilePage /></Public>} />
            <Route path="/app" element={<RoleHome />} />
            <Route path="/doctor" element={<Protected><DoctorPortal /></Protected>} />
            <Route path="/recommendations/:condition" element={<Protected bare><RecommendationsPage /></Protected>} />
            <Route path="/surveillance" element={<Protected><SurveillanceDashboard /></Protected>} />
            <Route path="/model-health" element={<Protected><ModelHealthDashboard /></Protected>} />
            <Route path="/ngo" element={<Protected><NgoDashboard /></Protected>} />
            <Route path="/lab" element={<Protected><LabDashboard /></Protected>} />
            <Route path="/admin" element={<Protected><AdminConsole /></Protected>} />
            <Route path="*" element={<Protected><NotFound /></Protected>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
