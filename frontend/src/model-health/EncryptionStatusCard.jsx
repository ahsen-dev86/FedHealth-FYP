// frontend/src/model-health/EncryptionStatusCard.jsx
// Which federated runs actually used encrypted aggregation, from the imported
// run records (settings.json). Plaintext runs are shown as plaintext; Paillier
// is shown only for runs whose settings record it, with the measured
// equivalence to plaintext FedAvg and the simulation's limits. Encryption
// covers training updates only; inference is not encrypted.
import { Lock, LockOpen } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { formatDate } from '../lib/help';

// Renders a plaintext-run count plus one detail card per encrypted (Paillier) run.
export default function EncryptionStatusCard({ status }) {
  if (!status) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const byScheme = status.runsByScheme || {};
  const plain = byScheme.none || 0;
  const encrypted = status.encryptedRuns || [];

  return (
    <div className="space-y-3.5" data-testid="encryption-card">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <LockOpen className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{plain} plaintext run{plain === 1 ? '' : 's'}</div>
          <div className="text-xs text-muted-foreground">
            Model updates were aggregated in plaintext (no encryption recorded in the run settings).
          </div>
        </div>
        <Badge variant="outline" className="ml-auto">none</Badge>
      </div>

      {encrypted.map((r) => (
        <div key={r.id} className="flex items-start gap-3 border-t border-border pt-3.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <Lock className="size-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold text-foreground">
              Paillier {r.key_bits}-bit · {r.total_rounds} rounds · {r.labs} labs · {r.scenario}, seed {r.seed}
            </div>
            <div className="text-xs text-muted-foreground">
              Labs encrypted their weight updates; the aggregator summed ciphertexts without the private key.
              {r.max_abs_weight_difference != null && (
                <> Decrypted aggregate vs plaintext FedAvg: max abs difference <span className="font-mono">{r.max_abs_weight_difference}</span>.</>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Limits: {r.details?.key_custody}; {r.details?.transport}. Completed {formatDate(r.completed_at)}.
            </div>
          </div>
          <Badge variant="outline" className="ml-auto border-success/30 bg-success/10 text-success">paillier</Badge>
        </div>
      ))}
      {encrypted.length === 0 && (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">No encrypted federated run has been recorded.</p>
      )}
      <p className="text-xs text-muted-foreground">{status.note}</p>
    </div>
  );
}
