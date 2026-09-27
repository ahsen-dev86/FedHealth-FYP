// frontend/src/auth/MfaPage.jsx
// Two-step MFA. 'setup' shows the TOTP QR to scan and confirms the first code;
// 'verify' asks for a code at login. Both end by storing a full access token and
// redirecting home.
import { useEffect, useState } from 'react';
// react-router-dom: useLocation reads the state handed off by LoginPage
// (preAuthToken + mode); useNavigate redirects home once MFA succeeds.
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function MfaPage() {
  const { mfaSetup, mfaVerifySetup, mfaVerify } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const preAuthToken = state?.preAuthToken;
  const mode = state?.mode; // 'setup' | 'verify'

  const [enrol, setEnrol] = useState(null); // { qrDataUrl, manualKey }
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // No pre-auth token means the user navigated here directly — send them back.
  useEffect(() => { if (!preAuthToken) navigate('/login', { replace: true }); }, [preAuthToken, navigate]);

  // For enrolment, fetch the QR once.
  useEffect(() => {
    if (mode === 'setup' && preAuthToken) {
      mfaSetup(preAuthToken).then(setEnrol).catch((e) => setError(e.message));
    }
  }, [mode, preAuthToken, mfaSetup]);

  // Verifies the 6-digit code (setup enrolls + verifies in one call, verify
  // just checks it) and, on success, AuthContext already has the access
  // token saved — so we just navigate home.
  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'setup') await mfaVerifySetup(preAuthToken, code);
      else await mfaVerify(preAuthToken, code);
      navigate('/', { replace: true });
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
            <div className="fh-brand" style={{ fontSize: 22 }}>Two-factor authentication</div>
            <p>{mode === 'setup'
              ? 'Scan the code with an authenticator app, then enter the 6-digit code.'
              : 'Enter the 6-digit code from your authenticator app.'}</p>
          </div>

          {error && <div className="fh-error" style={{ marginBottom: 14 }}>{error}</div>}

          {mode === 'setup' && enrol && (
            <>
              <img className="fh-qr" src={enrol.qrDataUrl} alt="Authenticator QR code" />
              <p className="fh-muted" style={{ textAlign: 'center', margin: '4px 0 6px' }}>
                Can’t scan? Enter this key manually:
              </p>
              <div className="fh-key">{enrol.manualKey}</div>
              <hr className="fh-hr" />
            </>
          )}

          <form onSubmit={submit}>
            <div className="fh-field">
              <label className="fh-label">6-digit code</label>
              <input className="fh-input fh-num" inputMode="numeric" maxLength={6}
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                     placeholder="000000" autoFocus />
            </div>
            <button className="fh-btn fh-btn--primary" style={{ width: '100%' }}
                    disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : mode === 'setup' ? 'Activate & continue' : 'Verify'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
