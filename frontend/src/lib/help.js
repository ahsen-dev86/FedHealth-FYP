// frontend/src/lib/help.js
// Presentation helpers for the Help Portal (NGO directory + supply requests).
import { Droplet, Pill, Wrench, HandCoins, Package } from 'lucide-react';

export const CATEGORY_LABELS = {
  blood: 'Blood', medicine: 'Medicine', equipment: 'Equipment', funds: 'Funds', other: 'Other',
};
export const CATEGORY_ICONS = {
  blood: Droplet, medicine: Pill, equipment: Wrench, funds: HandCoins, other: Package,
};

export const URGENCY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

// Tailwind class fragments (not shadcn Badge `variant`s — these need a custom
// look per urgency level distinct from the generic default/secondary/outline set).
export const URGENCY_BADGE_CLASS = {
  critical: 'border-destructive/30 bg-destructive/10 text-destructive',
  high: 'border-warning/30 bg-warning/10 text-warning',
  medium: 'border-border bg-muted text-foreground',
  low: 'border-border bg-transparent text-muted-foreground',
};

export const STATUS_LABELS = {
  open: 'Open', partially_fulfilled: 'Partially fulfilled', fulfilled: 'Fulfilled', closed: 'Closed',
};

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
