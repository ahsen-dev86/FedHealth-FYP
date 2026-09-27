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

// --- NGO profile field handling (Pakistani mobile number + basic email/url) ---

// Local (03XX-XXXXXXX) or international (+923XX-XXXXXXX / 923XX-XXXXXXX)
// Pakistani mobile number, dashes/spaces already stripped. Same shape as the
// phone heuristic in lib/contract.js (patient-ref identifier guard), just
// checked the other way: here a match is what we WANT.
const PK_MOBILE = /^(\+?92|0)3\d{9}$/;

/**
 * Keeps a phone input to digits, a single leading '+', and spaces/dashes for
 * readability — typed letters or symbols never make it into the field, so
 * there's nothing to reject later. Also caps length generously above any
 * valid Pakistani mobile number (max +92 300 1234567 = 15 chars).
 */
export function sanitizePhoneInput(raw) {
  const s = String(raw ?? '');
  const plus = s.startsWith('+') ? '+' : '';
  return (plus + s.slice(plus.length).replace(/[^\d\s-]/g, '')).slice(0, 16);
}

/** Error message for a contact phone, or '' when blank/acceptable. */
export function phoneError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const compact = s.replace(/[\s-]/g, '');
  if (!PK_MOBILE.test(compact)) {
    return 'Enter a Pakistani mobile number, e.g. 0300-1234567 or +92 300 1234567';
  }
  return '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Error message for a contact email, or '' when blank/acceptable. */
export function emailError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  return EMAIL_RE.test(s) ? '' : 'Enter a valid email address';
}

/** Error message for a website URL, or '' when blank/acceptable. */
export function websiteError(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes('.') ? '' : 'Enter a valid website address';
  } catch {
    return 'Enter a valid website address';
  }
}
