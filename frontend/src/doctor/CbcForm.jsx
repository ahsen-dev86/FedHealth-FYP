// frontend/src/doctor/CbcForm.jsx
// Manual CBC entry: the 14 Model-A indices as a compact grid that echoes a lab
// report. Values are strings here; the page converts to numbers on submit.
// Fields left blank are median-imputed server-side.
import { CBC_FIELDS } from '../lib/format';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export default function CbcForm({ cbc, setCbc }) {
  const set = (k) => (e) => setCbc({ ...cbc, [k]: e.target.value });
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {CBC_FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`cbc-${f.key}`} className="text-[11px] font-normal text-muted-foreground">
            {f.label} <span className="text-[10px]">{f.unit}</span>
          </Label>
          <Input id={`cbc-${f.key}`} className="text-right font-mono text-sm" inputMode="decimal"
                 value={cbc[f.key] ?? ''} onChange={set(f.key)} placeholder="—" />
        </div>
      ))}
    </div>
  );
}
