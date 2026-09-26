// frontend/src/model-health/FederatedRunsTable.jsx
// Every imported federated run (real, from round_history.json / settings.json):
// scenario, seed, encryption, the round the protocol selected, validation loss
// at round 0 / selected / last round, and — for the Colab runs — the frozen test
// accuracy of the selected model versus the same seed's centralized model.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { pct1 } from '../lib/format';

const f3 = (x) => (x == null ? '—' : x.toFixed(3));

export default function FederatedRunsTable({ runs }) {
  if (!runs) return <p className="text-sm text-muted-foreground">Loading runs…</p>;
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No federated run has been imported yet.</p>;

  return (
    <Table data-testid="runs-table">
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Encryption</TableHead>
          <TableHead className="text-right">Labs</TableHead>
          <TableHead className="text-right">Selected round</TableHead>
          <TableHead className="text-right">Val. loss r0 → selected → last</TableHead>
          <TableHead className="text-right">Test acc. (fed / central)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => {
          const fed = r.test_metrics?.federated?.accuracy;
          const cen = r.test_metrics?.centralized_same_seed?.accuracy;
          return (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">
                <span className="font-mono">seed {r.seed}</span> · {r.scenario}
                {r.dirichlet_alpha != null && <span className="text-muted-foreground"> (α={r.dirichlet_alpha})</span>}
              </TableCell>
              <TableCell>
                {r.encryption === 'paillier'
                  ? <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Paillier {r.key_bits}</Badge>
                  : <Badge variant="outline">none</Badge>}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.labs}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {r.selected_round} / {r.total_rounds}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {f3(r.round_zero?.loss)} → {f3(r.selected?.loss)} → {f3(r.final?.loss)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {fed != null ? `${pct1(fed)} / ${pct1(cen)}` : <span className="text-muted-foreground">not test-evaluated</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
