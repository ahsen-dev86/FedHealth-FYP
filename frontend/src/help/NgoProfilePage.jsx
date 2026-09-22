// frontend/src/help/NgoProfilePage.jsx
// Public NGO profile (route: /help/ngos/:id, no auth required): mission,
// contact info, donation instructions, and the NGO's full request history.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ShieldCheck, Globe, Mail, Phone, MapPin, Wallet, CalendarClock,
} from 'lucide-react';
import { api } from '../api/client';
import PublicHeader from '../components/PublicHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import {
  CATEGORY_LABELS, CATEGORY_ICONS, URGENCY_LABELS, URGENCY_BADGE_CLASS, STATUS_LABELS, formatDate,
} from '../lib/help';

const DONATION_METHOD_LABELS = { bank: 'Bank transfer', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', paypal: 'PayPal' };

export default function NgoProfilePage() {
  const { id } = useParams();
  const [ngo, setNgo] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setNgo(null); setErr('');
    api.get(`/help/ngos/${id}`).then(setNgo).catch((e) => setErr(e.message));
  }, [id]);

  return (
    <div className="min-h-full bg-background">
      <PublicHeader />
      <div className="mx-auto max-w-[820px] px-6 py-8">
        <Link to="/help" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to Help Portal
        </Link>

        {err && <p className="text-sm text-destructive">{err}</p>}

        {!ngo && !err && (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}

        {ngo && (
          <>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">{ngo.name}</h1>
                  {ngo.verified && (
                    <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
                      <ShieldCheck className="size-3" /> Verified
                    </Badge>
                  )}
                </div>
                {ngo.mission && <p className="mt-1.5 text-sm text-muted-foreground">{ngo.mission}</p>}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-[1fr_260px]">
              <div className="space-y-5">
                {ngo.description && (
                  <Card>
                    <CardHeader><CardTitle>About</CardTitle></CardHeader>
                    <CardContent><p className="whitespace-pre-line text-sm text-muted-foreground">{ngo.description}</p></CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader><CardTitle>Current requests</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {(!ngo.requests || ngo.requests.length === 0) && (
                      <p className="text-sm text-muted-foreground">No requests posted right now.</p>
                    )}
                    {ngo.requests?.map((r) => {
                      const Icon = CATEGORY_ICONS[r.category];
                      return (
                        <div key={r.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              <Icon className="size-4 text-primary" />
                              {CATEGORY_LABELS[r.category]}{r.blood_group ? ` · ${r.blood_group}` : ''}
                            </div>
                            <div className="flex gap-1.5">
                              <Badge variant="outline" className={URGENCY_BADGE_CLASS[r.urgency]}>{URGENCY_LABELS[r.urgency]}</Badge>
                              <Badge variant="secondary">{STATUS_LABELS[r.status]}</Badge>
                            </div>
                          </div>
                          <h4 className="mt-1.5 text-sm font-semibold text-foreground">{r.title}</h4>
                          {r.description && <p className="mt-0.5 text-[13px] text-muted-foreground">{r.description}</p>}
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {r.quantity && <span className="font-mono">{r.quantity}</span>}
                            {r.needed_by && <span className="flex items-center gap-1"><CalendarClock className="size-3.5" /> by {formatDate(r.needed_by)}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-5">
                <Card>
                  <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {(ngo.district || ngo.province) && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="size-4 shrink-0" /> {[ngo.district, ngo.province].filter(Boolean).join(', ')}
                      </div>
                    )}
                    {ngo.contact_email && (
                      <a href={`mailto:${ngo.contact_email}`} className="flex items-center gap-2 text-primary hover:underline">
                        <Mail className="size-4 shrink-0" /> {ngo.contact_email}
                      </a>
                    )}
                    {ngo.contact_phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="size-4 shrink-0" /> {ngo.contact_phone}
                      </div>
                    )}
                    {ngo.website && (
                      <a href={ngo.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                        <Globe className="size-4 shrink-0" /> Website
                      </a>
                    )}
                  </CardContent>
                </Card>

                {ngo.donation_info && Object.keys(ngo.donation_info).length > 0 && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader><CardTitle className="flex items-center gap-1.5"><Wallet className="size-4" /> How to donate</CardTitle></CardHeader>
                    <CardContent className="space-y-2.5">
                      {Object.entries(ngo.donation_info).map(([method, details]) => (
                        <div key={method}>
                          <div className="text-xs font-semibold text-muted-foreground">{DONATION_METHOD_LABELS[method] || method}</div>
                          <div className="font-mono text-[13px] text-foreground">{details}</div>
                        </div>
                      ))}
                      <Separator />
                      <p className="text-xs text-muted-foreground">Contact the NGO directly before donating to confirm current details.</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
