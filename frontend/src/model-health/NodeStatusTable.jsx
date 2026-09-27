// frontend/src/model-health/NodeStatusTable.jsx
// Federated participants as recorded in the run settings: the simulated lab
// partitions lab-00..lab-04 of the public training split, with the training
// rows each held per run (real, from settings.json). There is no live FL
// heartbeat — the federation ran as a batch simulation — so live status is
// shown separately below as clearly labelled sample data.
import { CircleCheck, CircleAlert, CircleX } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import SampleBadge from './SampleBadge';
import { sampleNodeStatus } from './sampleData';

const STATUS_META = {
  up: { label: 'Up', icon: CircleCheck, cls: 'border-success/30 bg-success/10 text-success' },
  stale: { label: 'Stale', icon: CircleAlert, cls: 'border-warning/30 bg-warning/10 text-warning' },
  down: { label: 'Down', icon: CircleX, cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

// Human-readable "time since last report" for the sample node-status table.
function timeAgo(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Illustrative "live node heartbeat" table (no real FL client reports liveness).
export function SampleNodeStatus() {
  const nodes = sampleNodeStatus();
  return (
    <div data-testid="sample-node-status">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <SampleBadge title="No live FL heartbeat exists; illustrative only" />
        <span>What live node monitoring would look like once labs run always-on clients.</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Last seen</TableHead>
            <TableHead className="text-right">Reports (7d)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => {
            const meta = STATUS_META[n.status];
            const Icon = meta.icon;
            return (
              <TableRow key={n.id}>
                <TableCell className="font-medium text-foreground">{n.name}</TableCell>
                <TableCell className="text-muted-foreground">{n.district}, {n.province}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`gap-1 ${meta.cls}`}><Icon className="size-3" /> {meta.label}</Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{timeAgo(n.last_report_at)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{n.reports_7d}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// Lists the simulated lab partitions and how many training rows each held per run.
export default function NodeStatusTable({ nodes }) {
  if (!nodes) return <p className="text-sm text-muted-foreground">Loading nodes…</p>;
  if (nodes.length === 0) return <p className="text-sm text-muted-foreground">No federated run has been imported yet.</p>;

  return (
    <div data-testid="fl-nodes">
      <p className="mb-3 text-sm text-muted-foreground">
        {nodes.length} simulated lab partitions of the public training split, as recorded in the run settings.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lab id</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Runs</TableHead>
            <TableHead>Scenarios</TableHead>
            <TableHead className="text-right">Training rows (min–max)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => (
            <TableRow key={n.lab_id}>
              <TableCell className="font-mono font-medium text-foreground">{n.lab_id}</TableCell>
              <TableCell><Badge variant="outline">simulated partition</Badge></TableCell>
              <TableCell className="text-right font-mono tabular-nums">{n.runs}</TableCell>
              <TableCell className="text-muted-foreground">{n.scenarios.join(', ')}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {n.min_train_rows === n.max_train_rows ? n.min_train_rows : `${n.min_train_rows}–${n.max_train_rows}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
