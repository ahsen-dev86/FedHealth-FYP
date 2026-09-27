// frontend/src/help/HelpPortalPage.jsx
// Public Help Portal directory (route: /help, no auth required). Two views:
//   * Supply requests — a donor-facing board of what NGOs currently need,
//     filterable by category/province/urgency.
//   * NGO directory — profiles NGOs have set up, with a donation callout.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartHandshake, MapPin, CalendarClock, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import PublicHeader from '../components/PublicHeader';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../components/ui/select';
import {
  CATEGORY_LABELS, CATEGORY_ICONS, URGENCY_LABELS, URGENCY_BADGE_CLASS, formatDate,
} from '../lib/help';

const PROVINCES = ['Punjab', 'Sindh', 'KPK', 'Balochistan', 'Islamabad', 'Gilgit-Baltistan', 'AJK'];
const CATEGORIES = ['blood', 'medicine', 'equipment', 'funds', 'other'];
const URGENCIES = ['critical', 'high', 'medium', 'low'];

// One NGO supply request tile shown in the "Supply requests" tab.
function RequestCard({ r }) {
  const Icon = CATEGORY_ICONS[r.category];
  return (
    <Card>
      <CardContent className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-4 text-primary" />
            {CATEGORY_LABELS[r.category]}{r.blood_group ? ` · ${r.blood_group}` : ''}
          </div>
          <Badge variant="outline" className={URGENCY_BADGE_CLASS[r.urgency]}>{URGENCY_LABELS[r.urgency]}</Badge>
        </div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{r.title}</h3>
        {r.description && <p className="line-clamp-2 text-[13px] text-muted-foreground">{r.description}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
          {r.quantity && <span className="font-mono">{r.quantity}</span>}
          {r.needed_by && <span className="flex items-center gap-1"><CalendarClock className="size-3.5" /> by {formatDate(r.needed_by)}</span>}
        </div>
        <Link to={`/help/ngos/${r.ngo_id}`} className="flex items-center gap-1 pt-1 text-[13px] font-medium text-primary hover:underline">
          <MapPin className="size-3.5" /> {r.ngo_name} · {r.ngo_district}
        </Link>
      </CardContent>
    </Card>
  );
}

// One NGO summary tile shown in the "NGO directory" tab.
function NgoCard({ n }) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{n.name}</h3>
          {n.verified && (
            <Badge variant="outline" className="shrink-0 gap-1 border-success/30 bg-success/10 text-success">
              <ShieldCheck className="size-3" /> Verified
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{n.mission}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3.5" /> {n.district}, {n.province}
          </span>
          {n.open_request_count > 0 && (
            <Badge variant="secondary">{n.open_request_count} open request{n.open_request_count === 1 ? '' : 's'}</Badge>
          )}
        </div>
        <Link to={`/help/ngos/${n.id}`} className="block pt-1 text-[13px] font-medium text-primary hover:underline">
          View profile & donate →
        </Link>
      </CardContent>
    </Card>
  );
}

// Public landing page for the Help Portal: tabs between the filterable supply
// requests board and the NGO directory.
export default function HelpPortalPage() {
  const [requests, setRequests] = useState(null);
  const [ngos, setNgos] = useState(null);
  const [filters, setFilters] = useState({ category: '__all', province: '__all', urgency: '__all' });

  // NGO directory is fetched once; it doesn't depend on the request filters.
  useEffect(() => { api.get('/help/ngos').then(setNgos).catch(() => setNgos([])); }, []);

  // Requests are re-fetched whenever a filter changes, with the filters sent
  // as query params so the backend does the filtering.
  useEffect(() => {
    const qs = new URLSearchParams();
    if (filters.category !== '__all') qs.set('category', filters.category);
    if (filters.province !== '__all') qs.set('province', filters.province);
    if (filters.urgency !== '__all') qs.set('urgency', filters.urgency);
    api.get(`/help/requests?${qs.toString()}`).then(setRequests).catch(() => setRequests([]));
  }, [filters]);

  return (
    <div className="min-h-full bg-background">
      <PublicHeader />
      <div className="mx-auto max-w-[1180px] px-6 py-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HeartHandshake className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Help Portal</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              NGOs and foundations working on blood disorders across Pakistan post what they need here —
              blood, medicines, equipment, or funds. Browse below, or open a profile to see how to donate directly.
            </p>
          </div>
        </div>

        <Tabs defaultValue="requests">
          <TabsList variant="line">
            <TabsTrigger value="requests">Supply requests</TabsTrigger>
            <TabsTrigger value="ngos">NGO directory</TabsTrigger>
          </TabsList>

          <TabsContent value="requests" className="mt-4">
            <div className="mb-4 flex flex-wrap gap-2">
              <Select value={filters.category} onValueChange={(v) => setFilters((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue>{(v) => (v === '__all' ? 'All categories' : CATEGORY_LABELS[v])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All categories</SelectItem>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.province} onValueChange={(v) => setFilters((f) => ({ ...f, province: v }))}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue>{(v) => (v === '__all' ? 'All provinces' : v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All provinces</SelectItem>
                  {PROVINCES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.urgency} onValueChange={(v) => setFilters((f) => ({ ...f, urgency: v }))}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue>{(v) => (v === '__all' ? 'Any urgency' : URGENCY_LABELS[v])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Any urgency</SelectItem>
                  {URGENCIES.map((u) => <SelectItem key={u} value={u}>{URGENCY_LABELS[u]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {requests == null ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
              </div>
            ) : requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests match these filters right now.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {requests.map((r) => <RequestCard key={r.id} r={r} />)}
              </div>
            )}
          </TabsContent>

          <TabsContent value="ngos" className="mt-4">
            {ngos == null ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {ngos.map((n) => <NgoCard key={n.id} n={n} />)}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
