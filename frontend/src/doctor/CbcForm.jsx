// frontend/src/doctor/CbcForm.jsx
// Manual CBC entry: exactly the 10 values the model uses, in model order, each
// with the unit it was measured in. Units are never guessed: the value is sent
// with its unit and converted by the API (e.g. WBC 9,010 /mm³ -> 9.01 ×10³/µL).
// The same range/unit rules as the API run here so mistakes show inline.
// Blank fields are allowed; the model fills them with training medians and the
// result says which ones were imputed.
import { CBC_FIELDS } from '../lib/format';
import { CANONICAL_UNITS, unitOptionFor } from '../lib/contract';
import { Input } from '../components/ui/input';

const UNIT_SELECT = 'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-1.5 text-xs text-foreground '
  + 'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 '
  + 'aria-invalid:border-destructive';

function fmt(x) {
  return Number.isInteger(x) ? String(x) : String(+x.toPrecision(4));
}

export default function CbcForm({ cbc, setCbc, units, setUnits, validation, printedUnits = {} }) {
  const setValue = (k) => (e) => setCbc({ ...cbc, [k]: e.target.value });
  const setUnit = (k) => (e) => setUnits({ ...units, [k]: e.target.value });

  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
      {CBC_FIELDS.map((f) => {
        const unit = units[f.key];
        const option = unitOptionFor(f.key, unit);
        const error = validation?.errors?.[f.key];
        const converted = validation?.canonical?.[f.key];
        const printed = printedUnits[f.key];
        const showConverted = converted != null && option && option.value !== f.unitOptions[0].value;
        return (
          <div key={f.key} className="space-y-1" data-testid={`cbc-field-${f.key}`}>
            <label htmlFor={`cbc-${f.key}`} className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                   title={f.name}>
              <span><span className="font-medium text-foreground">{f.label}</span> <span className="hidden lg:inline">{f.name.replace(/\s*\(.*\)$/, '')}</span></span>
              <span className="font-mono text-[10px]">{f.range[0]}–{f.range[1]} {CANONICAL_UNITS[f.key]}</span>
            </label>
            <div className="grid grid-cols-[1fr_118px] gap-1.5">
              <Input id={`cbc-${f.key}`} className="text-right font-mono text-sm" inputMode="decimal"
                     aria-invalid={error ? true : undefined}
                     value={cbc[f.key] ?? ''} onChange={setValue(f.key)} placeholder="—" />
              <select aria-label={`${f.label} unit`} className={UNIT_SELECT} data-testid={`unit-${f.key}`}
                      aria-invalid={error && /unit/i.test(error) ? true : undefined}
                      value={option ? option.value : ''} onChange={setUnit(f.key)}>
                {!option && <option value="">Choose unit…</option>}
                {f.unitOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {printed && (
              <div className={`text-[10px] ${option ? 'text-muted-foreground' : 'text-warning'}`}>
                Printed on report: <span className="font-mono">{printed}</span>
                {!option && ' — not a supported unit, choose one'}
              </div>
            )}
            {error
              ? <div className="text-[11px] text-destructive" role="alert">{error}</div>
              : showConverted && (
                <div className="font-mono text-[10px] text-muted-foreground">= {fmt(converted)} {CANONICAL_UNITS[f.key]}</div>
              )}
          </div>
        );
      })}
    </div>
  );
}
