// frontend/src/components/RuleFlag.jsx
// Renders the interpretable thalassemia-trait discriminant-index flag that the
// inference service returns alongside the ML scores. It's a transparent second
// opinion (Mentzer index etc.), shown as a clinical note — never a diagnosis.
import { useState } from 'react';
import { TriangleAlert, CircleCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

export default function RuleFlag({ flag }) {
  const [open, setOpen] = useState(false);
  if (!flag) return null;

  const applicable = flag.applicable;
  const fired = flag.flag;

  return (
    <Alert variant={fired ? 'destructive' : 'default'} className={fired ? 'border-warning/40 text-warning [&_*]:text-warning' : 'border-success/30'}>
      {fired ? <TriangleAlert /> : <CircleCheck className="text-success" />}
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <AlertTitle className={fired ? '' : 'text-foreground'}>
            {fired ? 'Possible beta-thalassemia trait' : 'Thalassemia-trait screen'}
          </AlertTitle>
          <AlertDescription className={fired ? 'text-warning/85' : ''}>{flag.rationale}</AlertDescription>
        </div>
        {flag.mentzer_index != null && (
          <div className="shrink-0 text-right">
            <div className="text-[11px] text-muted-foreground">Mentzer index</div>
            <div className="font-mono text-lg tabular-nums">{flag.mentzer_index}</div>
          </div>
        )}
      </div>

      {applicable && flag.indices && (
        <div className="col-start-2 mt-2 w-full">
          <Button type="button" variant="ghost" size="sm" className="px-2" onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp /> : <ChevronDown />}
            {open ? 'Hide' : 'Show'} discriminant indices
          </Button>
          {open && (
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {Object.entries(flag.indices).map(([name, d]) => (
                <div key={name} className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1.5 text-xs">
                  <span className="capitalize text-muted-foreground">{name.replace(/_/g, ' ')}</span>
                  <span className={`font-mono tabular-nums ${d.thal_suggestive ? 'text-warning' : 'text-foreground'}`}>
                    {d.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Alert>
  );
}
