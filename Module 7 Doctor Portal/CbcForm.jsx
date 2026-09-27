// frontend/src/doctor/CbcForm.jsx
// Manual CBC entry: the 14 Model-A indices as a compact monospace grid that
// echoes a lab report. Values are strings here; the page converts to numbers on
// submit. Fields left blank are median-imputed server-side.
import { CBC_FIELDS } from '../lib/format';

// Renders one labeled input per CBC field. `cbc` is a string-keyed value map
// and `setCbc` is the parent's setter; this component owns no state itself.
export default function CbcForm({ cbc, setCbc }) {
  // Curried change handler: set(key) returns an onChange for that one field,
  // merging the new value into the existing cbc object.
  const set = (k) => (e) => setCbc({ ...cbc, [k]: e.target.value });
  return (
    <div className="fh-cbc-grid">
      {CBC_FIELDS.map((f) => (
        <div className="fh-cbc-cell" key={f.key}>
          <label>{f.label} <span className="fh-muted">{f.unit}</span></label>
          <input className="fh-input" inputMode="decimal"
                 value={cbc[f.key] ?? ''} onChange={set(f.key)} placeholder="—" />
        </div>
      ))}
    </div>
  );
}
