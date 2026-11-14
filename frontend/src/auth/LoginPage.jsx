// frontend/src/auth/LoginPage.jsx
// Sign in, or register a new account. Reached from a portal card on the
// landing page (/login?role=doctor), which presets the role. On success we
// hand off to the MFA page with a short-lived pre-auth token (login never
// yields a full session token: MFA is mandatory, per the backend).
//
// First sign-up needs proof of the claimed role: a medical licence, an
// employee card or an NGO registration certificate, uploaded here once. An
// administrator reviews it before the account can open a portal.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock, FileCheck2, Upload, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth, NOTICE_KEY } from './AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Separator } from '../components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

// What each self-registrable role must upload once, at sign-up.
export const ROLES = [
  { value: 'doctor', label: 'Doctor', portal: 'Doctor Portal',
    proof: 'Medical licence', proofHint: 'Your PMDC registration certificate or licence card.' },
  // A lab engineer runs a lab's FedHealth node and sees that lab's Lab Node
  // dashboard; the account is tied to one lab, picked below.
  { value: 'lab_tech', label: 'Lab engineer (lab node)', portal: 'Lab Node',
    proof: 'Laboratory employee card', proofHint: 'The staff card issued by the laboratory you work at.' },
  { value: 'nih_official', label: 'Health official (gov email required)', portal: 'Surveillance',
    proof: 'Government employee card', proofHint: 'Your official service or department card.' },
  { value: 'ngo', label: 'NGO / foundation', portal: 'NGO Portal',
    proof: 'Certificate of registration', proofHint: 'The organisation\'s registration certificate.' },
];
const ROLE_TITLES = { ...Object.fromEntries(ROLES.map((r) => [r.value, r.portal])), admin: 'Administration' };
export const PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** '' when the chosen file can be uploaded as proof, else what is wrong with it. */
export function proofError(file) {
  if (!file) return 'Upload your proof document to create the account';
  if (!PROOF_TYPES.includes(file.type)) return 'The proof must be a PDF, PNG, JPEG or WebP file';
  if (file.size > PROOF_MAX_BYTES) return 'The proof document is larger than 5 MB';
  if (file.size === 0) return 'That file is empty';
  return '';
}

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Combined sign-in / registration form. Either flow ends the same way: navigate
// to /mfa with a pre-auth token and whether MFA still needs to be set up.
export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetRole = params.get('role');
  const canRegisterRole = ROLES.some((r) => r.value === presetRole);
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', role: canRegisterRole ? presetRole : 'doctor', organization: '', labId: '',
  });
  const [proof, setProof] = useState(null);
  const fileInput = useRef(null);
  const [labs, setLabs] = useState(null); // labs a lab engineer can pick; loaded on demand
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null); // { rejected, message } when the account awaits review
  const [notice] = useState(() => {
    try {
      const n = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      return n || '';
    } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);

  const role = ROLES.find((r) => r.value === form.role) || ROLES[0];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Emptying the email also empties the password, so a cleared form never
  // keeps a (possibly autofilled) password behind for the next email.
  const setEmail = (e) => {
    const email = e.target.value;
    setForm((f) => ({ ...f, email, password: email ? f.password : '' }));
  };

  // The lab list is only needed once someone chooses the lab-engineer role.
  useEffect(() => {
    if (mode !== 'register' || form.role !== 'lab_tech' || labs) return;
    api.get('/auth/labs').then(setLabs).catch(() => setLabs([]));
  }, [mode, form.role, labs]);

  // Calls login or register depending on the current mode, then always hands
  // off to the MFA page (login never returns a full session token by itself).
  async function submit(e) {
    e.preventDefault();
    setError(''); setPending(null); setBusy(true);
    try {
      if (mode === 'login') {
        const r = await login(form.email, form.password);
        navigate('/mfa', { state: {
          preAuthToken: r.preAuthToken,
          mode: r.mfaSetupRequired ? 'setup' : 'verify',
        }});
      } else {
        if (form.role === 'lab_tech' && !form.labId) throw new Error('Choose the lab you work at');
        const problem = proofError(proof);
        if (problem) throw new Error(problem);
        const r = await register({
          email: form.email, password: form.password,
          fullName: form.fullName, role: form.role,
          organization: form.organization || undefined,
          labId: form.role === 'lab_tech' ? form.labId : undefined,
          proof,
        });
        navigate('/mfa', { state: { preAuthToken: r.preAuthToken, mode: 'setup', awaitingReview: true } });
      }
    } catch (err) {
      if (err.code === 'PENDING_VERIFICATION' || err.code === 'VERIFICATION_REJECTED') {
        setPending({ rejected: err.code === 'VERIFICATION_REJECTED', message: err.message });
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function chooseProof(e) {
    const file = e.target.files?.[0] || null;
    setProof(file);
    setError(file ? proofError(file) : '');
  }

  return (
    <div className="grid min-h-full place-items-center bg-[radial-gradient(1200px_600px_at_50%_-10%,color-mix(in_oklch,var(--primary),white_85%)_0%,var(--background)_60%)] px-4 py-8 sm:p-6">
      <div className="w-full max-w-[420px]">
        <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="back-home">
          <ArrowLeft className="size-4" /> Back to home
        </Link>
        <Card className="w-full">
          <CardContent className="pt-2">
            <div className="mb-6 text-center">
              <div className="text-[26px] font-bold tracking-tight text-foreground">
                Fed<span className="text-primary">Health</span>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground" data-testid="login-subtitle">
                {presetRole && ROLE_TITLES[presetRole]
                  ? `${mode === 'login' ? 'Sign in to' : 'Request access to'} the ${ROLE_TITLES[mode === 'register' ? form.role : presetRole]}`
                  : 'Clinical decision support · CBC intelligence'}
              </p>
            </div>

            {notice && !error && !pending && (
              <Alert className="mb-4" data-testid="login-notice">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}
            {pending && (
              <Alert className={`mb-4 ${pending.rejected ? 'border-destructive/40' : 'border-warning/40'}`} data-testid="verification-notice">
                {pending.rejected ? <AlertCircle className="text-destructive" /> : <Clock className="text-warning" />}
                <AlertTitle>{pending.rejected ? 'Proof document not accepted' : 'Awaiting verification'}</AlertTitle>
                <AlertDescription>{pending.message}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={submit} className="space-y-3.5" noValidate={false}>
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" value={form.fullName} onChange={set('fullName')} required autoComplete="name" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={setEmail} required
                       autoComplete="email" inputMode="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={form.password} onChange={set('password')} required
                       minLength={mode === 'register' ? 8 : undefined}
                       autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                {mode === 'register' && <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>}
              </div>
              {mode === 'register' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select value={form.role} onValueChange={(v) => { setForm((f) => ({ ...f, role: v })); }}>
                      <SelectTrigger className="w-full" data-testid="role-select">
                        <SelectValue>{(v) => ROLES.find((r) => r.value === v)?.label || v}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.role === 'lab_tech' && (
                    <div className="space-y-1.5">
                      <Label>Your lab</Label>
                      <Select value={form.labId} onValueChange={(v) => setForm((f) => ({ ...f, labId: v }))}>
                        <SelectTrigger className="w-full" data-testid="lab-select">
                          <SelectValue placeholder={labs ? 'Choose your lab' : 'Loading labs…'}>
                            {(v) => { const l = labs?.find((x) => x.id === v); return l ? l.name : 'Choose your lab'; }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(labs || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} · {l.district}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="organization">Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="organization" value={form.organization} onChange={set('organization')} autoComplete="organization" />
                  </div>

                  {/* Proof of role: required once, at first sign-up. */}
                  <div className="space-y-1.5">
                    <Label htmlFor="proof">{role.proof} <span className="font-normal text-muted-foreground">(proof, required)</span></Label>
                    <input id="proof" ref={fileInput} type="file" className="sr-only" data-testid="proof-input"
                           accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                           onChange={chooseProof} />
                    {proof ? (
                      <div className="flex items-center gap-2.5 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5" data-testid="proof-chosen">
                        <FileCheck2 className="size-5 shrink-0 text-success" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{proof.name}</p>
                          <p className="text-[11px] text-muted-foreground">{fmtSize(proof.size)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove file"
                                onClick={() => { setProof(null); if (fileInput.current) fileInput.current.value = ''; }}>
                          <X />
                        </Button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => fileInput.current?.click()}
                              className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-input px-3 py-4 text-center transition-colors hover:border-primary hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                        <Upload className="size-5 text-primary" />
                        <span className="text-sm font-medium text-foreground">Upload {role.proof.toLowerCase()}</span>
                        <span className="text-[11px] text-muted-foreground">PDF or photo (PNG, JPEG, WebP), up to 5 MB</span>
                      </button>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {role.proofHint} An administrator reviews it before your account is activated. It is asked for only once.
                    </p>
                  </div>
                </>
              )}

              <Button type="submit" className="h-10 w-full" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
              </Button>
            </form>

            {presetRole === 'admin' ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Administrator accounts are issued by the operator and cannot be self-registered.
              </p>
            ) : (
              <>
                <Separator className="my-4" />
                <p className="m-0 text-center text-sm text-muted-foreground">
                  {mode === 'login' ? 'New here? ' : 'Have an account? '}
                  <Button variant="ghost" size="sm" className="px-2.5"
                          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setPending(null); }}>
                    {mode === 'login' ? 'Register' : 'Sign in'}
                  </Button>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
