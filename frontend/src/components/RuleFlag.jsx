// frontend/src/components/RuleFlag.jsx
// Renders the interpretable thalassemia-trait discriminant-index flag that the
// inference service returns alongside the ML scores. It's a transparent second
// opinion (Mentzer index etc.), shown as a clinical note — never a diagnosis.
import { useState } from 'react';

export default function RuleFlag({ flag }) {
  const [open, setOpen] = useState(false);
  if (!flag) return null;

  const applicable = flag.applicable;
  const fired = flag.flag;
  const cls = fired ? 'fh-flag fh-flag--warn' : 'fh-flag fh-flag--ok';
  const titleCls = fired ? 'fh-flag__title fh-flag__title--warn' : 'fh-flag__title';

  return (
    <div className={cls} style={{ flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <div>
          <div className={titleCls}>
            {fired ? 'Possible beta-thalassemia trait' : 'Thalassemia-trait screen'}
          </div>
          <div className="fh-flag__body">{flag.rationale}</div>
        </div>
        {flag.mentzer_index != null && (
          <div style={{ textAlign: 'right', minWidth: 92 }}>
            <div className="fh-muted" style={{ fontSize: 11 }}>Mentzer index</div>
            <div className="fh-num" style={{ fontSize: 18, color: fired ? 'var(--warn)' : 'var(--ink)' }}>
              {flag.mentzer_index}
            </div>
          </div>
        )}
      </div>

      {applicable && flag.indices && (
        <>
          <button className="fh-btn fh-btn--ghost" style={{ padding: '4px 10px', marginTop: 8, alignSelf: 'flex-start' }}
                  onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'} discriminant indices
          </button>
          {open && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6, width: '100%' }}>
              {Object.entries(flag.indices).map(([name, d]) => (
                <div key={name} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between',
                                         padding: '5px 8px', background: '#fff', border: '1px solid var(--line)', borderRadius: 6 }}>
                  <span style={{ textTransform: 'capitalize' }}>{name.replace(/_/g, ' ')}</span>
                  <span className="fh-num" style={{ color: d.thal_suggestive ? 'var(--warn)' : 'var(--ink-soft)' }}>
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
