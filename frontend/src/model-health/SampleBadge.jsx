// frontend/src/model-health/SampleBadge.jsx
// Visible marker for charts showing illustrative data (see sampleData.js), so a
// sample series is never mistaken for a measured result.
import { Badge } from '../components/ui/badge';

export default function SampleBadge({ title = 'Illustrative data, not a measured result' }) {
  return (
    <Badge variant="outline" title={title} data-testid="sample-data-badge"
           className="border-warning/40 bg-warning/10 text-warning">
      Sample data
    </Badge>
  );
}
