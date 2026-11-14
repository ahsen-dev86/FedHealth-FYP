// frontend/src/auth/MfaPage.jsx
// Two-step MFA. 'setup' shows the TOTP QR to scan and confirms the first code;
// 'verify' asks for a code at login. Both end by storing a full access token and
// redirecting home.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CircleCheck, Clock } from 'lucide-react';
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
  const [awaiting, setAwaiting] = useState(false); // MFA enrolled, proof still to be reviewed

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
      if (mode === 'setup') {
        const r = await mfaVerifySetup(preAuthToken, code);
        if (r?.pendingVerification) { setAwaiting(true); return; }
      } else {
        await mfaVerify(preAuthToken, code);
      }
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Sign-up is complete, but the account stays locked until the proof is approved.
  if (awaiting) {
    return (
      <div className="grid min-h-full place-items-center bg-[radial-gradient(1200px_600px_at_50%_-10%,color-mix(in_oklch,var(--primary),white_85%)_0%,var(--background)_60%)] px-4 py-8 sm:p-6">
        <Card className="w-full max-w-[420px]">
          <CardContent className="pt-2 text-center" data-testid="awaiting-verification">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
              <Clock className="size-7" />
            </div>
            <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">Account created — awaiting verification</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Two-factor authentication is set up and your proof document has been received. An administrator will
              review it; once it is approved you can sign in with your email, password and authenticator code.
            </p>
            <ol className="mt-5 space-y-2 text-left text-sm">
              <li className="flex items-center gap-2 text-foreground"><CircleCheck className="size-4 text-success" /> Account details saved</li>
              <li className="flex items-center gap-2 text-foreground"><CircleCheck className="size-4 text-success" /> Proof document uploaded</li>
              <li className="flex items-center gap-2 text-foreground"><CircleCheck className="size-4 text-success" /> Authenticator enrolled</li>
              <li className="flex items-center gap-2 text-muted-foreground"><Clock className="size-4 text-warning" /> Administrator review (pending)</li>
            </ol>
            <Button className="mt-6 h-10 w-full" nativeButton={false} render={<Link to="/" />}>Back to home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-full place-items-center bg-[radial-gradient(1200px_600px_at_50%_-10%,color-mix(in_oklch,var(--primary),white_85%)_0%,var(--background)_60%)] px-4 py-8 sm:p-6">
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
