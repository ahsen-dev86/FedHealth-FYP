// frontend/src/auth/LoginPage.jsx
// Sign in, or register a new account. On success we hand off to the MFA page
// with a short-lived pre-auth token (login never yields a full session token —
// MFA is mandatory, per the backend).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth, NOTICE_KEY } from './AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Separator } from '../components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';

const ROLES = [
  { value: 'doctor', label: 'Doctor' },
  { value: 'lab_tech', label: 'Lab technician' },
  { value: 'nih_official', label: 'Health official (gov email required)' },
  { value: 'ngo', label: 'NGO / foundation' },
];

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', role: 'doctor', organization: '',
  });
  const [error, setError] = useState('');
  const [notice] = useState(() => {
    try {
      const n = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      return n || '';
    } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  // Emptying the email also empties the password, so a cleared form never
  // keeps a (possibly autofilled) password behind for the next email.
  const setEmail = (e) => {
    const email = e.target.value;
    setForm((f) => ({ ...f, email, password: email ? f.password : '' }));
  };

  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      if (mode === 'login') {
        const r = await login(form.email, form.password);
        navigate('/mfa', { state: {
          preAuthToken: r.preAuthToken,
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
    <div className="grid min-h-full place-items-center bg-[radial-gradient(1200px_600px_at_50%_-10%,color-mix(in_oklch,var(--primary),white_85%)_0%,var(--background)_60%)] p-6">
      <Card className="w-full max-w-[400px]">
        <CardContent className="pt-2">
          <div className="mb-6 text-center">
            <div className="text-[26px] font-bold tracking-tight text-foreground">
              Fed<span className="text-primary">Health</span>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">Clinical decision support · CBC intelligence</p>
          </div>

          {notice && !error && (
            <Alert className="mb-4" data-testid="login-notice">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={submit} className="space-y-3.5">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={form.fullName} onChange={set('fullName')} required />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={setEmail} required
                     autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={form.password} onChange={set('password')} required
                     autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>
            {mode === 'register' && (
              <>
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{(v) => ROLES.find((r) => r.value === v)?.label || v}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="organization">Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="organization" value={form.organization} onChange={set('organization')} />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <Separator className="my-4" />
          <p className="m-0 text-center text-sm text-muted-foreground">
            {mode === 'login' ? 'New here? ' : 'Have an account? '}
            <Button variant="ghost" size="sm" className="px-2.5"
                    onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
              {mode === 'login' ? 'Register' : 'Sign in'}
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
