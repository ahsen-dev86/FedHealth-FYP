// frontend/src/components/RuleFlag.jsx
// Research-only rule notes (e.g. the Mentzer-index thalassemia-trait screen).
// These rules are DISABLED in inference: the service always returns
// rule_flags = {}, so nothing renders today. If a rule is ever re-enabled it is
// shown here, explicitly labelled as a research rule and not model output.
import { FlaskConical } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

export default function RuleFlag({ flags }) {
  const entries = Object.entries(flags || {});
  if (entries.length === 0) return null;
  return (
    <Alert className="border-border">
      <FlaskConical className="text-muted-foreground" />
      <AlertTitle>Research-only rule notes — not model output</AlertTitle>
      <AlertDescription>
        {entries.map(([name, flag]) => (
          <div key={name}>
            <span className="font-medium">{name.replace(/_/g, ' ')}:</span> {flag?.rationale || JSON.stringify(flag)}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
