// frontend/src/ngo/NgoDashboard.jsx
// Protected workspace for an 'ngo' account (route: /ngo): edit the public
// profile shown on the Help Portal, and create/close supply requests. Every
// write is scoped to the caller's own NGO — there is no ngo id in this UI at
// all, only "mine".
import { useEffect, useState } from 'react';
import { Plus, Save, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '../components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import { PROVINCES, DISTRICTS } from '../lib/districts';
import {
  CATEGORY_LABELS, URGENCY_LABELS, URGENCY_BADGE_CLASS, STATUS_LABELS, formatDate,
  sanitizePhoneInput, phoneError, emailError, websiteError,
} from '../lib/help';

const CATEGORIES = ['blood', 'medicine', 'equipment', 'funds', 'other'];
const URGENCIES = ['low', 'medium', 'high', 'critical'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const STATUSES = ['open', 'partially_fulfilled', 'fulfilled', 'closed'];
const DONATION_METHODS = [
  ['bank', 'Bank transfer'], ['jazzcash', 'JazzCash'], ['easypaisa', 'Easypaisa'], ['paypal', 'PayPal'],
];

// Editable form for the NGO's own public profile (name, mission, contact,
// donation methods). Saves via PUT /help/ngos/me — always "my own NGO", no id.
function ProfileForm({ ngo, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState(ngo);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // A brand-new profile has no contact email yet — default it to the account's
  // login email rather than leaving the field blank (the backend does the same
  // on first create; this also covers profiles that predate that change).
  useEffect(() => {
    setForm({ ...ngo, contact_email: ngo.contact_email || user?.email || '' });
  }, [ngo, user?.email]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };
  const setPhone = (e) => {
    setForm((f) => ({ ...f, contact_phone: sanitizePhoneInput(e.target.value) }));
    setSaved(false);
  };
  // Changing province clears district unless the current one still belongs to it.
  const setProvince = (v) => {
    setForm((f) => ({ ...f, province: v, district: DISTRICTS.some((d) => d.province === v && d.district === f.district) ? f.district : '' }));
    setSaved(false);
  };
  const setDistrict = (v) => { setForm((f) => ({ ...f, district: v })); setSaved(false); };
  const setDonation = (method) => (e) => {
    setForm((f) => ({ ...f, donation_info: { ...f.donation_info, [method]: e.target.value } }));
    setSaved(false);
  };

  const emailErr = emailError(form.contact_email);
  const phoneErr = phoneError(form.contact_phone);
  const websiteErr = websiteError(form.website);
  const hasErrors = !!(emailErr || phoneErr || websiteErr);

  // Districts for the chosen province, plus the current value even if it's
  // stale (no province yet, or a district outside this fixed list) so saved
  // data is never silently dropped out of the dropdown.
  const districtOptions = DISTRICTS.filter((d) => d.province === form.province);
  if (form.district && !districtOptions.some((d) => d.district === form.district)) {
    districtOptions.push({ district: form.district, province: form.province });
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.put('/help/ngos/me', {
        name: form.name, mission: form.mission, description: form.description,
        website: form.website, contactEmail: form.contact_email, contactPhone: form.contact_phone,
        district: form.district, province: form.province, donationInfo: form.donation_info,
      });
      onSaved(updated);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Public profile</CardTitle></CardHeader>
      <CardContent className="space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="ngo-name">Organization name</Label>
          <Input id="ngo-name" value={form.name || ''} onChange={set('name')} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ngo-mission">Mission <span className="font-normal text-muted-foreground">(shown on the directory card)</span></Label>
          <Input id="ngo-mission" value={form.mission || ''} onChange={set('mission')} placeholder="One sentence describing your cause" maxLength={240} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ngo-description">Full description</Label>
          <Textarea id="ngo-description" rows={4} value={form.description || ''} onChange={set('description')} maxLength={4000} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ngo-province">Province</Label>
            <Select value={form.province || ''} onValueChange={setProvince}>
              <SelectTrigger id="ngo-province" className="w-full"><SelectValue placeholder="Select province" /></SelectTrigger>
              <SelectContent>
                {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ngo-district">District</Label>
            <Select value={form.district || ''} onValueChange={setDistrict} disabled={!form.province}>
              <SelectTrigger id="ngo-district" className="w-full">
                <SelectValue placeholder={form.province ? 'Select district' : 'Select province first'} />
              </SelectTrigger>
              <SelectContent>
                {districtOptions.map((d) => <SelectItem key={d.district} value={d.district}>{d.district}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ngo-email">Contact email</Label>
            <Input id="ngo-email" type="email" value={form.contact_email || ''} onChange={set('contact_email')}
                   aria-invalid={emailErr ? true : undefined} maxLength={254} />
            {emailErr && <p className="text-[11px] text-destructive" data-testid="ngo-email-error">{emailErr}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ngo-phone">Contact phone</Label>
            <Input id="ngo-phone" inputMode="tel" value={form.contact_phone || ''} onChange={setPhone}
                   aria-invalid={phoneErr ? true : undefined} maxLength={16} placeholder="03XX-XXXXXXX" />
            {phoneErr && <p className="text-[11px] text-destructive" data-testid="ngo-phone-error">{phoneErr}</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ngo-website">Website</Label>
          <Input id="ngo-website" value={form.website || ''} onChange={set('website')} placeholder="https://…"
                 aria-invalid={websiteErr ? true : undefined} maxLength={2048} />
          {websiteErr && <p className="text-[11px] text-destructive" data-testid="ngo-website-error">{websiteErr}</p>}
        </div>

        <div className="pt-1">
          <Label className="mb-1.5">Donation methods</Label>
          <div className="space-y-2">
            {DONATION_METHODS.map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
                <Input value={form.donation_info?.[key] || ''} onChange={setDonation(key)}
                       placeholder={key === 'bank' ? 'Bank — account number (account title)' : 'Number / handle'} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1.5">
          <Button onClick={save} disabled={saving || hasErrors}>
            <Save /> {saving ? 'Saving…' : 'Save profile'}
          </Button>
          {saved && <span className="text-xs text-success">Saved.</span>}
          <Link to={`/help/ngos/${ngo.id}`} target="_blank" className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline">
            View public profile <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// Modal form for posting a new supply request against the caller's own NGO.
function NewRequestDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    category: 'blood', bloodGroup: '', title: '', description: '', quantity: '', urgency: 'medium', neededBy: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const created = await api.post('/help/ngos/me/requests', {
        ...form, bloodGroup: form.category === 'blood' ? form.bloodGroup || undefined : undefined,
      });
      onCreated(created);
      setOpen(false);
      setForm({ category: 'blood', bloodGroup: '', title: '', description: '', quantity: '', urgency: 'medium', neededBy: '' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><Plus /> New request</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Post a supply request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v) => CATEGORY_LABELS[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.category === 'blood' && (
              <div className="space-y-1.5">
                <Label>Blood group</Label>
                <Select value={form.bloodGroup} onValueChange={(v) => setForm((f) => ({ ...f, bloodGroup: v }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{BLOOD_GROUPS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-title">Title</Label>
            <Input id="req-title" value={form.title} onChange={set('title')} placeholder="e.g. Urgent O- units needed" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-desc">Description</Label>
            <Textarea id="req-desc" rows={3} value={form.description} onChange={set('description')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="req-qty">Quantity</Label>
              <Input id="req-qty" value={form.quantity} onChange={set('quantity')} placeholder="e.g. 15 units" />
            </div>
            <div className="space-y-1.5">
              <Label>Urgency</Label>
              <Select value={form.urgency} onValueChange={(v) => setForm((f) => ({ ...f, urgency: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v) => URGENCY_LABELS[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>{URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABELS[u]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-needed">Needed by</Label>
            <Input id="req-needed" type="date" value={form.neededBy} onChange={set('neededBy')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.title.trim()}>{busy ? 'Posting…' : 'Post request'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Top-level page: loads the caller's NGO profile + its requests, then renders
// the profile editor next to the request list/creator.
export default function NgoDashboard() {
  const [ngo, setNgo] = useState(null);
  const [requests, setRequests] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/help/ngos/me').then(setNgo).catch((e) => setErr(e.message));
    api.get('/help/ngos/me/requests').then(setRequests).catch(() => setRequests([]));
  }, []);

  // Inline status change (e.g. open -> fulfilled) for one of this NGO's requests.
  async function setStatus(id, status) {
    const updated = await api.patch(`/help/ngos/me/requests/${id}`, { status });
    setRequests((rows) => rows.map((r) => (r.id === id ? updated : r)));
  }

  return (
    <div>
      <div className="mb-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Help Portal</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">My NGO</h1>
      </div>

      {err && (
        <Alert variant="destructive" className="mb-4"><AlertDescription>{err}</AlertDescription></Alert>
      )}

      {!ngo ? (
        <p className="text-sm text-muted-foreground">Loading your profile…</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_1.1fr]">
          <ProfileForm ngo={ngo} onSaved={setNgo} />

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>My requests</CardTitle>
              <NewRequestDialog onCreated={(r) => setRequests((rows) => [r, ...(rows || [])])} />
            </CardHeader>
            <CardContent className="space-y-2.5">
              {requests == null && <p className="text-sm text-muted-foreground">Loading…</p>}
              {requests?.length === 0 && <p className="text-sm text-muted-foreground">No requests posted yet.</p>}
              {requests?.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
                    <Badge variant="outline" className={URGENCY_BADGE_CLASS[r.urgency]}>{URGENCY_LABELS[r.urgency]}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{CATEGORY_LABELS[r.category]}{r.blood_group ? ` · ${r.blood_group}` : ''}</span>
                    {r.quantity && <span className="font-mono">{r.quantity}</span>}
                    {r.needed_by && <span>by {formatDate(r.needed_by)}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                      <SelectTrigger size="sm" className="w-[190px]">
                        <SelectValue>{(v) => STATUS_LABELS[v]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
