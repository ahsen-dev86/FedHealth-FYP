// frontend/src/doctor/PatientHistory.jsx
// Longitudinal view for a pseudonymous patient: prior visits (canonical CBC
// values), the trend chart, and for each visit the model's highest score and
// the doctor's confirmed diagnosis. Loaded on demand by patient_ref.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import TrendChart from '../components/TrendChart';
import { conditionLabel, conditionColor, pct } from '../lib/format';
import { CANONICAL_UNITS } from '../lib/contract';
import { Separator } from '../components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

const COLUMNS = ['HGB', 'MCV', 'PLT', 'WBC'];

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
      <Table data-testid="visit-table">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            {COLUMNS.map((k) => (
              <TableHead key={k} className="text-right">{k} <span className="text-[10px] font-normal">{CANONICAL_UNITS[k]}</span></TableHead>
            ))}
            <TableHead>Highest score</TableHead>
            <TableHead>Confirmed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground">{(r.collected_at || r.created_at || '').slice(0, 10)}</TableCell>
              {COLUMNS.map((k) => (
                <TableCell key={k} className="text-right font-mono tabular-nums">{r.cbc?.[k] ?? '—'}</TableCell>
              ))}
              <TableCell>
                {r.prediction ? (
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="size-2 rounded-full" style={{ background: conditionColor(r.prediction.top_condition) }} />
                    {conditionLabel(r.prediction.top_condition)} {pct(r.prediction.top_confidence)}
                  </span>
                ) : <span className="text-muted-foreground">not run</span>}
              </TableCell>
              <TableCell>{r.prediction?.confirmed_condition ? conditionLabel(r.prediction.confirmed_condition) : <span className="text-muted-foreground">—</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
