// frontend/src/model-health/EncryptionStatusCard.jsx
// Encryption configuration used by the last FL training run (Module 5:
// Paillier homomorphic encryption on client weight updates). This is
// CONFIGURATION status, not a live per-request crypto probe — Module 5 has
// no per-operation telemetry to sample, so we surface what the last run was
// actually configured with plus how many of its rounds ran encrypted.
import { Lock, LockOpen, KeyRound } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { formatDate } from '../lib/help';

export default function EncryptionStatusCard({ status }) {
  if (!status) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const active = status.scheme === 'paillier';

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          {active ? <Lock className="size-5" /> : <LockOpen className="size-5" />}
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">
            {active ? 'Paillier homomorphic encryption' : 'No encryption configured'}
          </div>
          <div className="text-xs text-muted-foreground">
            {active ? 'Client weight updates are encrypted before aggregation' : 'Last run trained on plaintext weights'}
          </div>
        </div>
        <Badge variant="outline" className={`ml-auto ${active ? 'border-success/30 bg-success/10 text-success' : ''}`}>
          {active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3.5">
        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><KeyRound className="size-3.5" /> Key size</div>
          <div className="mt-0.5 font-mono text-sm text-foreground">{status.keyBits ? `${status.keyBits}-bit` : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Rounds encrypted</div>
          <div className="mt-0.5 font-mono text-sm text-foreground">{status.roundsEncrypted ?? 0}</div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-muted-foreground">Last training run completed</div>
          <div className="mt-0.5 text-sm text-foreground">{formatDate(status.lastRunCompletedAt)}</div>
        </div>
      </div>
    </div>
  );
}
