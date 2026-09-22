// frontend/src/model-health/NodeStatusTable.jsx
// Per-lab (FL node) status. "up/stale/down" is a RECENCY HEURISTIC derived
// from each lab's most recent lab_report — not a live FL heartbeat, since
// Module 4's federation is a batch simulation, not an always-on cluster.
import { CircleCheck, CircleAlert, CircleX } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';

const STATUS_META = {
  up: { label: 'Up', icon: CircleCheck, cls: 'border-success/30 bg-success/10 text-success' },
  stale: { label: 'Stale', icon: CircleAlert, cls: 'border-warning/30 bg-warning/10 text-warning' },
  down: { label: 'Down', icon: CircleX, cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
};

function timeAgo(iso) {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export default function NodeStatusTable({ nodes }) {
  if (!nodes) return <p className="text-sm text-muted-foreground">Loading nodes…</p>;
  const up = nodes.filter((n) => n.status === 'up').length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{up}</span> of {nodes.length} nodes up
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Node</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Last seen</TableHead>
            <TableHead className="text-right">Reports (7d)</TableHead>
            <TableHead className="text-right">Reports (total)</TableHead>
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
                <TableCell className="text-right font-mono tabular-nums">{n.reports_total}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
