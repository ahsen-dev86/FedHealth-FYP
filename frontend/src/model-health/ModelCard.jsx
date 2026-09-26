// frontend/src/model-health/ModelCard.jsx
// The registered, served model and its MEASURED results (registry row written by
// scripts/register-model.js from final_test/*_metrics.json): frozen 480-row
// test split, hybrid head, per-class recall/precision, calibration, and the
// same-split ANN and baseline accuracies for comparison.
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { CLASSES } from '../lib/contract';
import { conditionLabel, conditionColor, pct1 } from '../lib/format';

function Fact({ label, children }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

export default function ModelCard({ model }) {
  if (model === undefined) return <p className="text-sm text-muted-foreground">Loading model…</p>;
  if (!model) return <p className="text-sm text-muted-foreground">No model is registered as active.</p>;
  const m = model.metrics || {};
  const p = model.provenance || {};
  const perClass = m.per_class || {};
  const measured = m.split === 'test';

  return (
    <div className="space-y-4" data-testid="model-card">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">{model.name}</Badge>
        <Badge variant="outline" className="font-mono">{model.version}</Badge>
        {model.is_active && <Badge className="bg-success/15 text-success">Active</Badge>}
        {!measured && <Badge variant="outline" className="border-warning/40 text-warning">No measured metrics recorded</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Architecture">ANN 10→64→32→4 + local XGBoost head ({m.head || p.artifact_type || '—'})</Fact>
        <Fact label="Calibration">
          {model.calibration ? model.calibration.replace(/_/g, ' ') : '—'}
          {p.temperature != null && <span className="font-mono text-muted-foreground"> T={p.temperature.toFixed(3)}</span>}
        </Fact>
        <Fact label="Rows">train {p.preprocessor_fit_rows ?? '—'} · validation {p.validation_rows ?? '—'} · test {m.test_rows ?? '—'}</Fact>
        <Fact label="Dataset SHA-256"><span className="font-mono text-xs">{(p.data_sha256 || '').slice(0, 12) || '—'}…</span></Fact>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(model.classes || []).map((c) => (
          <Badge key={c} variant="outline" className="gap-1.5">
            <span className="size-2 rounded-full" style={{ background: conditionColor(c) }} />{conditionLabel(c)}
          </Badge>
        ))}
      </div>

      {measured && (
        <>
          <Table data-testid="per-class-metrics">
            <TableHeader>
              <TableRow>
                <TableHead>Class (test split)</TableHead>
                <TableHead className="text-right">Recall</TableHead>
                <TableHead className="text-right">Precision</TableHead>
                <TableHead className="text-right">F1</TableHead>
                <TableHead className="text-right">Support</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CLASSES.filter((c) => perClass[c]).map((c) => (
                <TableRow key={c}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: conditionColor(c) }} />{conditionLabel(c)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{pct1(perClass[c].recall)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{pct1(perClass[c].precision)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{pct1(perClass[c].f1)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{perClass[c].support}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Same test split: ANN alone {pct1(m.ann?.accuracy)}
            {m.baselines?.logistic_regression && <>, logistic regression {pct1(m.baselines.logistic_regression.accuracy)}</>}
            {m.baselines?.random_forest && <>, random forest {pct1(m.baselines.random_forest.accuracy)}</>}.
            Log loss {m.log_loss?.toFixed(3)} · ECE (15 bins) {m.ece_15_bins?.toFixed(3)} ·
            sick called healthy {m.sick_called_healthy} of {m.test_rows - (perClass.healthy?.support || 0)}.
            Source: <span className="font-mono">{m.source_file}</span>
          </p>
        </>
      )}
      {p.intended_use && <p className="text-xs text-muted-foreground">Intended use: {p.intended_use}</p>}
    </div>
  );
}
