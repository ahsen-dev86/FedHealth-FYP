// frontend/src/admin/AdminConsole.jsx
// The administrator's home ('user:manage'):
//   * system counts and shortcuts into every portal (an admin reaches them all)
//   * account verification: open each sign-up's proof document, approve or
//     reject it (a reason is required to reject), suspend or reactivate accounts
//   * model serving: primary / backup status and the failover drill
//   * the confirmed-case dataset: size, duplicates skipped, CSV export
// Every action here is written to the immutable audit log by the API.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Stethoscope, Radar, ActivitySquare, FlaskConical, Building2, HeartHandshake, FileText, Check, X,
  UserX, UserCheck, Download, ServerCog, Database, AlertCircle, ArrowRight,
} from 'lucide-react';
import { api } from '../api/client';
import ModelServingCard from '../model-health/ModelServingCard';
import { conditionLabel, relativeTime } from '../lib/format';
import { CLASSES } from '../lib/contract';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog';

const ROLE_LABELS = { doctor: 'Doctor', lab_tech: 'Lab engineer', nih_official: 'Health official', ngo: 'NGO', admin: 'Administrator' };
const DOC_LABELS = {
  medical_license: 'Medical licence', employee_card: 'Government employee card',
  lab_employee_card: 'Laboratory employee card', ngo_registration: 'NGO registration certificate',
};
const VERIFY_BADGE = {
  pending: 'border-warning/50 bg-warning/10 text-warning',
  approved: 'border-success/40 bg-success/10 text-success',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
};
const PORTALS = [
  { to: '/doctor', label: 'Doctor Portal', icon: Stethoscope },
  { to: '/surveillance', label: 'Surveillance', icon: Radar },
  { to: '/model-health', label: 'Model Health', icon: ActivitySquare },
  { to: '/lab', label: 'Lab Node', icon: FlaskConical },
  { to: '/ngo', label: 'NGO Portal', icon: Building2 },
  { to: '/help', label: 'Help Portal', icon: HeartHandshake },
];
const FILTERS = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className={`text-2xl font-semibold tracking-tight ${tone || 'text-foreground'}`}>{value ?? '—'}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// Loads the proof document with the session token and shows it (image inline, PDF in a frame).
function ProofDialog({ account, onClose, onDecision }) {
  const [doc, setDoc] = useState(null); // { url, type }
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let url;
    let live = true;
    api.download(`/admin/users/${account.id}/proof`)
      .then(({ blob }) => { if (!live) return; url = URL.createObjectURL(blob); setDoc({ url, type: blob.type }); })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [account.id]);

  async function decide(decision) {
    if (decision === 'reject' && note.trim().length < 3) { setErr('Give the reason for rejecting, so the applicant knows what to fix.'); return; }
    setBusy(decision); setErr('');
    try {
      await api.post(`/admin/users/${account.id}/verification`, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
      onDecision();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[720px]" data-testid="proof-dialog">
        <DialogHeader>
          <DialogTitle>Review proof: {account.full_name}</DialogTitle>
          <DialogDescription>
            {ROLE_LABELS[account.role] || account.role} · {account.email}
            {account.organization ? ` · ${account.organization}` : ''}{account.lab_name ? ` · ${account.lab_name}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">
          {DOC_LABELS[account.proof_doc_type] || 'Proof document'} · {account.proof_filename} · uploaded {relativeTime(account.proof_uploaded_at)}
        </div>
        <div className="grid min-h-[240px] place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
          {!doc && !err && <p className="text-sm text-muted-foreground">Loading document…</p>}
          {doc && doc.type.startsWith('image/') && <img src={doc.url} alt="Uploaded proof document" className="max-h-[52dvh] w-full object-contain" />}
          {doc && doc.type === 'application/pdf' && (
            <object data={doc.url} type="application/pdf" className="h-[52dvh] w-full" aria-label="Uploaded proof document (PDF)">
              <p className="p-4 text-sm text-muted-foreground">This browser cannot show the PDF inline.</p>
            </object>
          )}
        </div>
        {doc && (
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline">
            Open the document in a new tab
          </a>
        )}
        {account.verification_status === 'pending' ? (
          <>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                      placeholder="Note (required to reject: tell the applicant what was wrong)" aria-label="Review note" />
            {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => decide('reject')} disabled={!!busy} data-testid="reject-proof">
                <X /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </Button>
              <Button className="h-9" onClick={() => decide('approve')} disabled={!!busy} data-testid="approve-proof">
                <Check /> {busy === 'approve' ? 'Approving…' : 'Approve account'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
            <p className="text-sm text-muted-foreground">
              Already {account.verification_status}{account.verified_by_name ? ` by ${account.verified_by_name}` : ''}
              {account.verification_note ? `: ${account.verification_note}` : '.'}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Primary / backup serving status with the failover-drill switch (shared with Model Health).
function ServingCard() {
  return (
    <Card data-testid="serving-card">
      <CardHeader><CardTitle className="flex items-center gap-2"><ServerCog className="size-4 text-primary" /> Model serving</CardTitle></CardHeader>
      <CardContent>
        <ModelServingCard onDrill={(primaryDown) => api.post('/admin/failover-drill', { primaryDown })} />
      </CardContent>
    </Card>
  );
}

function DatasetCard() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/dataset/confirmed/summary').then(setSummary).catch((e) => setErr(e.message)); }, []);

  async function exportCsv() {
    try {
      const { blob, filename } = await api.download('/dataset/confirmed.csv');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr(e.message); }
  }

  const max = Math.max(1, ...CLASSES.map((c) => summary?.byLabel?.[c]?.records || 0));
  return (
    <Card data-testid="dataset-card">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2"><Database className="size-4 text-primary" /> Confirmed-case dataset</CardTitle>
        <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={!summary?.records}><Download /> CSV</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!summary && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
        {summary && (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-xl font-semibold text-foreground" data-testid="dataset-records">{summary.records}</div><div className="text-[11px] text-muted-foreground">unique records</div></div>
              <div><div className="text-xl font-semibold text-foreground">{summary.confirmations}</div><div className="text-[11px] text-muted-foreground">confirmations</div></div>
              <div><div className="text-xl font-semibold text-foreground">{summary.duplicatesSkipped}</div><div className="text-[11px] text-muted-foreground">duplicates skipped</div></div>
            </div>
            <ul className="space-y-1.5">
              {CLASSES.map((c) => {
                const row = summary.byLabel?.[c] || { records: 0, modelAgreed: 0 };
                return (
                  <li key={c} className="grid grid-cols-[92px_1fr_auto] items-center gap-2 text-xs">
                    <span className="text-foreground">{conditionLabel(c)}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(row.records / max) * 100}%` }} /></div>
                    <span className="font-mono text-muted-foreground">{row.records}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Every diagnosis a doctor confirms is stored as one labelled CBC record for the next training round. A record
              with the same ten values and the same diagnosis is kept once.
              {summary.lastAdded ? ` Last added ${relativeTime(summary.lastAdded)}.` : ''}
            </p>
          </>
        )}
        {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      </CardContent>
    </Card>
  );
}

export default function AdminConsole() {
  const [overview, setOverview] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [accounts, setAccounts] = useState(null);
  const [review, setReview] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setErr('');
    api.get('/admin/overview').then(setOverview).catch((e) => setErr(e.message));
    api.get(`/admin/users?verification=${filter}`).then(setAccounts).catch((e) => { setErr(e.message); setAccounts([]); });
  }, [filter]);
  useEffect(() => { setAccounts(null); load(); }, [load]);

  async function setStatus(account, status) {
    try { await api.post(`/admin/users/${account.id}/status`, { status }); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="mb-4.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Administration</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">Admin Console</h1>
      </div>

      {err && (
        <Alert variant="destructive" className="mb-4"><AlertCircle /><AlertDescription>{err}</AlertDescription></Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="admin-stats">
        <Stat label="awaiting verification" value={overview?.pending_verifications} tone={overview?.pending_verifications ? 'text-warning' : undefined} />
        <Stat label="accounts" value={overview?.users} />
        <Stat label="screenings run" value={overview?.predictions} />
        <Stat label="confirmed cases in dataset" value={overview?.confirmed_cases} />
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Portals</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {PORTALS.map((p) => (
              <Link key={p.to} to={p.to} data-testid={`admin-portal-${p.to.slice(1)}`}
                    className="group flex flex-col gap-2 rounded-xl border border-border p-3 outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50">
                <p.icon className="size-5 text-primary" />
                <span className="flex items-center justify-between gap-1 text-sm font-medium text-foreground">
                  {p.label} <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Account verification</CardTitle>
          <div className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 sm:w-auto" role="tablist" aria-label="Filter accounts">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} data-testid={`filter-${key}`}
                      className={`h-8 flex-1 shrink-0 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-none ${
                        filter === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {label}{key === 'pending' && overview?.pending_verifications ? ` (${overview.pending_verifications})` : ''}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {accounts == null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {accounts?.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="no-accounts">
              {filter === 'pending' ? 'No accounts are waiting for review.' : 'No accounts in this list.'}
            </p>
          )}
          <ul className="divide-y divide-border" data-testid="account-list">
            {accounts?.map((a) => (
              <li key={a.id} className="flex flex-col gap-2.5 py-3 sm:flex-row sm:items-center sm:gap-4" data-testid="account-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium text-foreground">{a.full_name}</span>
                    <Badge variant="secondary">{ROLE_LABELS[a.role] || a.role}</Badge>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${VERIFY_BADGE[a.verification_status]}`}>
                      {a.verification_status}
                    </span>
                    {a.status === 'suspended' && <Badge variant="destructive">Suspended</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.email}{a.organization ? ` · ${a.organization}` : ''}{a.lab_name ? ` · ${a.lab_name}` : ''} · joined {relativeTime(a.created_at)}
                  </div>
                  {a.verification_status === 'rejected' && a.verification_note && (
                    <div className="mt-0.5 text-xs text-destructive">Rejected: {a.verification_note}</div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {a.proof_filename ? (
                    <Button variant={a.verification_status === 'pending' ? 'default' : 'outline'} size="sm" className="h-8"
                            onClick={() => setReview(a)} data-testid="review-proof">
                      <FileText /> {a.verification_status === 'pending' ? 'Review proof' : 'View proof'}
                    </Button>
                  ) : (
                    <span className="self-center text-xs text-muted-foreground">No proof on file (created before proofs were required)</span>
                  )}
                  {a.role !== 'admin' && a.status !== 'pending' && (
                    a.status === 'suspended'
                      ? <Button variant="outline" size="sm" className="h-8" onClick={() => setStatus(a, 'active')}><UserCheck /> Reactivate</Button>
                      : <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setStatus(a, 'suspended')}><UserX /> Suspend</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <ServingCard />
        <DatasetCard />
      </div>

      {review && (
        <ProofDialog account={review} onClose={() => setReview(null)} onDecision={() => { setReview(null); load(); }} />
      )}
    </div>
  );
}
