// frontend/src/doctor/PatientHistory.jsx
// Longitudinal view for a pseudonymous patient: fetches prior visits and shows a
// trend chart plus a compact visit table. Loaded on demand by patient_ref.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import TrendChart from '../components/TrendChart';
import { Separator } from '../components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

export default function PatientHistory({ patientRef }) {
  const [reports, setReports] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!patientRef) return;
    let active = true;
    setReports(null); setErr('');
    api.get(`/patients/${encodeURIComponent(patientRef)}/history`)
      .then((r) => { if (active) setReports(r); })
      .catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [patientRef]);

  if (!patientRef) return null;
  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!reports) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">No prior visits recorded for this patient.</p>;

  return (
    <div>
      <TrendChart reports={reports} />
      <Separator className="my-4" />
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-primary">Visits ({reports.length})</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">HGB</TableHead>
            <TableHead className="text-right">MCV</TableHead>
            <TableHead className="text-right">PLT</TableHead>
            <TableHead className="text-right">WBC</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground">{(r.collected_at || r.created_at || '').slice(0, 10)}</TableCell>
              {['HGB', 'MCV', 'PLT', 'WBC'].map((k) => (
                <TableCell key={k} className="text-right font-mono tabular-nums">{r.cbc?.[k] ?? '—'}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
