// frontend/src/auth/MfaPage.jsx
// Two-step MFA. 'setup' shows the TOTP QR to scan and confirms the first code;
// 'verify' asks for a code at login. Both end by storing a full access token and
// redirecting home.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Separator } from '../components/ui/separator';

// TOTP verification step reached from LoginPage via router state (preAuthToken
// + mode). Renders the QR-enrolment view or the plain code-entry view.
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

  // Verifies the 6-digit TOTP code; which endpoint depends on setup vs. verify
  // mode. Success stores the full access token and returns to the app.
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
    <div className="grid min-h-full place-items-center bg-[radial-gradient(1200px_600px_at_50%_-10%,color-mix(in_oklch,var(--primary),white_85%)_0%,var(--background)_60%)] p-6">
      <Card className="w-full max-w-[400px]">
        <CardContent className="pt-2">
          <div className="mb-6 text-center">
            <div className="text-xl font-bold tracking-tight text-foreground">Two-factor authentication</div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {mode === 'setup'
                ? 'Scan the code with an authenticator app, then enter the 6-digit code.'
                : 'Enter the 6-digit code from your authenticator app.'}
            </p>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {mode === 'setup' && enrol && (
            <>
              <img className="mx-auto block h-[190px] w-[190px] rounded-lg border border-border"
                   src={enrol.qrDataUrl} alt="Authenticator QR code" />
              <p className="mt-2 mb-1.5 text-center text-sm text-muted-foreground">
                Can't scan? Enter this key manually:
              </p>
              <div className="rounded-md bg-muted p-2 text-center font-mono text-[13px] break-all">
                {enrol.manualKey}
              </div>
              <Separator className="my-4" />
            </>
          )}

          <form onSubmit={submit} className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="mfa-code">6-digit code</Label>
              <Input id="mfa-code" className="text-center font-mono tracking-[0.3em]" inputMode="numeric" maxLength={6}
                     value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                     placeholder="000000" autoFocus />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : mode === 'setup' ? 'Activate & continue' : 'Verify'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
