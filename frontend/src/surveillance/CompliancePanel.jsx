// frontend/src/surveillance/CompliancePanel.jsx
// Regulatory oversight (PDPB 2023). Verifies the immutable audit log's hash
// chain and shows the most recent entries. The "verified" badge is backed by the
// backend recomputing the whole SHA-256 chain (GET /audit/verify).
import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

export default function CompliancePanel() {
  const [chain, setChain] = useState(null);
  const [log, setLog] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/audit/verify').then(setChain).catch((e) => { setChain({ ok: false }); setErr(e.message); });
    api.get('/audit?limit=50').then(setLog).catch(() => setLog([]));
  }, []);

  const ok = chain?.ok;

  return (
    <div>
      <Alert className={`mb-4 ${ok ? 'border-success/30' : 'border-destructive/30'}`}>
        {ok ? <ShieldCheck className="text-success" /> : <ShieldAlert className="text-destructive" />}
        <AlertTitle className={ok ? 'text-success' : 'text-destructive'}>
          {chain == null ? 'Verifying audit chain…'
            : ok ? 'Audit chain verified — tamper-evident and intact'
                 : `Audit chain BROKEN at entry ${chain.broken_at ?? '?'}`}
        </AlertTitle>
        <AlertDescription>
          Each log entry is hash-chained to the previous one; any edit or deletion
          breaks every later hash and is detected here.
        </AlertDescription>
      </Alert>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Recent activity</div>
      {!log && <p className="text-sm text-muted-foreground">Loading log…</p>}
      {log && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor role</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                  {new Date(e.ts).toLocaleString()}
                </TableCell>
                <TableCell>{e.actor_role || '—'}</TableCell>
                <TableCell>{e.action}</TableCell>
                <TableCell className="text-muted-foreground">{e.resource_type || ''} {e.resource_id || ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
