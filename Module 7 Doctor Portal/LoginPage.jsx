// frontend/src/auth/LoginPage.jsx
// Sign in, or register a new account. On success we hand off to the MFA page
// with a short-lived pre-auth token (login never yields a full session token —
// MFA is mandatory, per the backend).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // react-router-dom: programmatic navigation after login/register
import { useAuth } from './AuthContext';

// Combined sign-in / register form (toggled by `mode`). Both flows end by
// navigating to /mfa with a pre-auth token, since a full session always
// requires completing MFA first.
export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', role: 'doctor', organization: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Submits login or register, then routes to the MFA page with the
  // pre-auth token; 'setup' vs 'verify' tells MfaPage which flow to run.
  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'login') {
        const r = await login(form.email, form.password);
        navigate('/mfa', { state: {
          preAuthToken: r.preAuthToken,
          // Backend tells us whether this account still needs to enroll in MFA.
          mode: r.mfaSetupRequired ? 'setup' : 'verify',
        }});
      } else {
        const r = await register({
          email: form.email, password: form.password,
          fullName: form.fullName, role: form.role,
          organization: form.organization || undefined,
        });
        navigate('/mfa', { state: { preAuthToken: r.preAuthToken, mode: 'setup' } });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fh-auth">
      <div className="fh-auth__card fh-card">
        <div className="fh-card__body">
          <div className="fh-auth__brand">
            <div className="fh-brand">Fed<span>Health</span></div>
            <p>Clinical decision support · CBC intelligence</p>
          </div>

          {error && <div className="fh-error" style={{ marginBottom: 14 }}>{error}</div>}

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="fh-field">
                <label className="fh-label">Full name</label>
                <input className="fh-input" value={form.fullName} onChange={set('fullName')} required />
              </div>
            )}
            <div className="fh-field">
              <label className="fh-label">Email</label>
              <input className="fh-input" type="email" value={form.email} onChange={set('email')} required
                     autoComplete="email" />
            </div>
            <div className="fh-field">
              <label className="fh-label">Password</label>
              <input className="fh-input" type="password" value={form.password} onChange={set('password')} required
                     autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
            {mode === 'register' && (
              <>
                <div className="fh-field">
                  <label className="fh-label">Role</label>
                  <select className="fh-select" value={form.role} onChange={set('role')}>
                    <option value="doctor">Doctor</option>
                    <option value="lab_tech">Lab technician</option>
                    <option value="nih_official">Health official (gov email required)</option>
                  </select>
                </div>
                <div className="fh-field">
                  <label className="fh-label">Organization <span className="fh-muted">(optional)</span></label>
                  <input className="fh-input" value={form.organization} onChange={set('organization')} />
                </div>
              </>
            )}

            <button className="fh-btn fh-btn--primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <hr className="fh-hr" />
          <p className="fh-muted" style={{ textAlign: 'center', margin: 0 }}>
            {mode === 'login' ? "New here? " : 'Have an account? '}
            <button className="fh-btn fh-btn--ghost" style={{ padding: '4px 10px' }}
                    onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
