// frontend/src/landing/LandingPage.jsx
// The public front door. Every visitor lands here first: what FedHealth is,
// how it works, how patient data is protected, and a portal card per role that
// leads to sign-in. Signed-in visitors get a shortcut to their own portal.
//
// Motion is CSS only (landing.css): staggered hero entrance, an animated
// federation diagram, scroll-triggered reveals, counters and bars. All of it
// is disabled under prefers-reduced-motion. Claims on this page are limited to
// what the system does (docs/VERIFICATION.md); no accuracy figures are quoted.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Stethoscope, FlaskConical, Radar, HeartHandshake, ShieldCheck, ArrowRight, Lock, Network, KeyRound,
  FileSearch, ScanLine, Mic, BrainCircuit, CheckCircle2, ServerCog, Fingerprint, Menu, X, Activity, UserCog,
  ChevronDown, Database,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import './landing.css';

// ---- small motion hooks -----------------------------------------------------

// Adds the class "in" the first time the element scrolls into view.
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('in'); return undefined; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({ as: Tag = 'div', className = '', variant = '', i = 0, children, ...rest }) {
  const ref = useReveal();
  return (
    <Tag ref={ref} className={`lp-reveal ${variant} ${className}`} style={{ '--i': i }} {...rest}>
      {children}
    </Tag>
  );
}

// Counts from 0 to `to` once the number is on screen.
function CountUp({ to, suffix = '', duration = 1400 }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') { setValue(to); return undefined; }
    let raf;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        setValue(Math.round(to * (1 - (1 - t) ** 3)));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to, duration]);
  return <span ref={ref} className="tabular-nums">{value.toLocaleString()}{suffix}</span>;
}

// ---- content ------------------------------------------------------------------

const STATS = [
  { value: 4, label: 'conditions screened', note: 'healthy · anaemia · thalassaemia · leukaemia' },
  { value: 10, label: 'CBC values per report', note: 'the only inputs the model uses' },
  { value: 2048, suffix: '-bit', label: 'Paillier encryption', note: 'on shared model updates' },
  { value: 0, label: 'patient records leave a lab', note: 'only model weights travel' },
];

const PILLARS = [
  {
    icon: Activity, title: 'Screening from a routine blood test',
    body: 'A complete blood count is the cheapest, most common lab test in the country. FedHealth reads its ten core values and returns a calibrated confidence for four conditions in under a second.',
  },
  {
    icon: Network, title: 'Labs learn together, data stays home',
    body: 'Each laboratory trains the model on its own records. Only the learned weights are shared and averaged, so a rural lab benefits from patterns seen in Karachi without either one exporting a patient file.',
  },
  {
    icon: Radar, title: 'Early warning for public health',
    body: 'District-level, de-identified counts feed a surveillance map. A cluster of high-risk results raises an alert for health officials days before it would show up in paper reporting.',
  },
];

const STEPS = [
  {
    icon: ScanLine, title: 'A CBC report comes in',
    body: 'The doctor types the values, scans the printed report, or receives it from the lab system. Units are declared, converted and range-checked before anything is scored.',
    chips: ['Report scan (OCR)', 'Unit conversion', 'Range checks'],
  },
  {
    icon: Mic, title: 'Symptoms are captured by voice or text',
    body: 'Dictate in English, Urdu or a mix of both. Speech is transcribed on the hospital\'s own server and turned into symptom tags that sit beside the result as clinical context.',
    chips: ['English', 'اردو', 'Mixed speech'],
  },
  {
    icon: BrainCircuit, title: 'The model scores it and shows its reasoning',
    body: 'A neural network with a gradient-boosted head returns four calibrated confidences. Every result explains which values pushed each score up or down, and lists the next tests published guidelines recommend.',
    chips: ['Calibrated confidence', 'Per-value explanation', 'Guideline next steps'],
  },
  {
    icon: CheckCircle2, title: 'The doctor decides',
    body: 'FedHealth never issues a diagnosis. The doctor confirms or overrides the result, and each confirmed case becomes a labelled record that improves the next round of training.',
    chips: ['Doctor confirmation', 'De-duplicated dataset'],
  },
  {
    icon: ServerCog, title: 'Labs retrain, encrypted',
    body: 'Laboratories train locally and send encrypted weight updates. The coordinator adds them together without being able to read any single lab\'s contribution, then publishes the improved model to everyone.',
    chips: ['Federated averaging', 'Paillier aggregation', 'Versioned registry'],
  },
];

const SAFEGUARDS = [
  { icon: Network, title: 'Federated by design', body: 'Raw reports never leave the laboratory that produced them.' },
  { icon: Lock, title: 'Encrypted aggregation', body: 'Model updates are combined under Paillier homomorphic encryption.' },
  { icon: KeyRound, title: 'Mandatory two-factor sign-in', body: 'Every account uses an authenticator code. There is no password-only path.' },
  { icon: ShieldCheck, title: 'Verified accounts only', body: 'Doctors, officials, lab staff and NGOs upload proof of role, reviewed before access is granted.' },
  { icon: Fingerprint, title: 'Pseudonymous patients', body: 'Records carry a FedHealth patient ID. No names, CNICs or phone numbers are stored.' },
  { icon: FileSearch, title: 'Tamper-evident audit trail', body: 'Every access is written to a hash-chained log that cannot be edited, even by an administrator.' },
  { icon: ServerCog, title: 'No single point of failure', body: 'A second, independently trained model takes over automatically if the primary stops answering.' },
  { icon: Database, title: 'Least-privilege roles', body: 'Health officials see district totals only; patient-level rows are out of reach for that role.' },
];

const PORTALS = [
  {
    role: 'doctor', icon: Stethoscope, title: 'Doctor', tag: 'Clinical decision support',
    body: 'Enter or scan a CBC, dictate symptoms, read the explained result and confirm the diagnosis.',
    proof: 'Medical licence required at sign-up',
  },
  {
    role: 'lab_tech', icon: FlaskConical, title: 'Lab engineer', tag: 'Federated node',
    body: 'Monitor your laboratory\'s node: training rounds, data intake, connection health.',
    proof: 'Laboratory employee card required',
  },
  {
    role: 'nih_official', icon: Radar, title: 'Health official', tag: 'Surveillance',
    body: 'District heat map, outbreak alerts, model health and the compliance log.',
    proof: 'Government email and employee card required',
  },
  {
    role: 'ngo', icon: HeartHandshake, title: 'NGO / foundation', tag: 'Help Portal',
    body: 'Publish your profile and post requests for blood, medicine, equipment or funds.',
    proof: 'Certificate of registration required',
  },
  {
    role: 'admin', icon: UserCog, title: 'Administrator', tag: 'Operations',
    body: 'Review sign-up proofs, manage accounts and reach every portal.',
    proof: 'Issued by the operator; no self sign-up',
  },
];

const CAPABILITIES = [
  'Four-class CBC screening', 'Federated learning', 'Paillier encrypted aggregation', 'Explainable results',
  'Urdu + English voice intake', 'Report OCR', 'Backup model failover', 'District surveillance map',
  'Outbreak cluster alerts', 'Immutable audit log', 'Role-based access', 'Two-factor authentication',
];

// Lab positions around the coordinator in the hero diagram (viewBox 520 x 440).
const LABS = [
  { x: 86, y: 92, name: 'Karachi' }, { x: 434, y: 78, name: 'Lahore' }, { x: 470, y: 268, name: 'Islamabad' },
  { x: 290, y: 396, name: 'Peshawar' }, { x: 56, y: 300, name: 'Quetta' },
];
const HUB = { x: 262, y: 214 };

// ---- sections -------------------------------------------------------------------

function FederationDiagram() {
  return (
    <svg className="lp-net lp-float" viewBox="0 0 520 440" role="img"
         aria-label="Five laboratories exchanging encrypted model updates with a central coordinator; patient data stays in each lab">
      <defs>
        <radialGradient id="lp-hub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.86 0.1 186)" />
          <stop offset="100%" stopColor="oklch(0.56 0.09 194)" />
        </radialGradient>
      </defs>
      {LABS.map((lab, i) => {
        const d = `M${lab.x},${lab.y} Q${(lab.x + HUB.x) / 2 + (i % 2 ? 26 : -26)},${(lab.y + HUB.y) / 2 - 18} ${HUB.x},${HUB.y}`;
        return (
          <g key={lab.name}>
            <path className="lp-link" d={d} />
            <path className="lp-flow" d={d} style={{ animationDelay: `${i * 0.55}s` }} />
            <path className="lp-flow back" d={d} style={{ animationDelay: `${i * 0.4 + 1}s` }} />
          </g>
        );
      })}
      <g>
        <circle className="lp-ring" cx={HUB.x} cy={HUB.y} r="40" strokeWidth="1.5" />
        <circle className="lp-ring delay" cx={HUB.x} cy={HUB.y} r="40" strokeWidth="1.5" />
        <g className="lp-core">
          <circle cx={HUB.x} cy={HUB.y} r="44" fill="url(#lp-hub)" />
          <circle cx={HUB.x} cy={HUB.y} r="44" fill="none" stroke="oklch(1 0 0 / 0.35)" />
          {/* padlock */}
          <rect x={HUB.x - 13} y={HUB.y - 4} width="26" height="20" rx="4" fill="oklch(0.2 0.03 205)" />
          <path d={`M${HUB.x - 8},${HUB.y - 4} v-6 a8,8 0 0 1 16,0 v6`} fill="none" stroke="oklch(0.2 0.03 205)" strokeWidth="3.2" />
        </g>
        <text x={HUB.x} y={HUB.y + 70} textAnchor="middle" fontSize="12.5" fontWeight="600" fill="oklch(0.95 0.02 186)">Encrypted aggregation</text>
        <text x={HUB.x} y={HUB.y + 86} textAnchor="middle" fontSize="10.5" fill="oklch(0.8 0.03 186)">global model</text>
      </g>
      {LABS.map((lab, i) => (
        <g key={lab.name} className="lp-node" style={{ '--i': i }}>
          <circle cx={lab.x} cy={lab.y} r="27" fill="oklch(0.26 0.045 204)" stroke="oklch(0.8 0.1 186 / 0.7)" strokeWidth="1.4" />
          {/* flask glyph */}
          <path d={`M${lab.x - 4},${lab.y - 11} h8 M${lab.x - 2.5},${lab.y - 11} v7 l-7,12 a2.4,2.4 0 0 0 2,3.6 h15 a2.4,2.4 0 0 0 2,-3.6 l-7,-12 v-7`}
                fill="none" stroke="oklch(0.9 0.08 186)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <text x={lab.x} y={lab.y + 43} textAnchor="middle" fontSize="11" fill="oklch(0.86 0.03 186)">{lab.name} lab</text>
        </g>
      ))}
    </svg>
  );
}

// A static, clearly labelled illustration of a result card (not live model output).
function ResultIllustration() {
  const ref = useReveal();
  const rows = [
    { label: 'Healthy', pct: 6, color: 'var(--chart-2)' },
    { label: 'Anaemia', pct: 21, color: 'var(--chart-3)' },
    { label: 'Thalassaemia', pct: 70, color: 'var(--chart-5)' },
    { label: 'Leukaemia', pct: 3, color: 'var(--chart-4)' },
  ];
  const drivers = [
    { f: 'MCV 68 fL', dir: 'up', w: 82 }, { f: 'RBC 5.9', dir: 'up', w: 58 }, { f: 'MCH 21 pg', dir: 'up', w: 44 }, { f: 'RDW 13.4 %', dir: 'down', w: 20 },
  ];
  return (
    <div ref={ref} className="lp-reveal zoom relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-[0_30px_70px_-40px_color-mix(in_oklch,var(--primary)_80%,transparent)] sm:p-6">
      <span className="lp-scan" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Model confidence</div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">Illustration</span>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-foreground">{r.label}</span>
              <span className="font-mono text-muted-foreground">{r.pct}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="lp-bar h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color, '--i': i }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">Why this score</div>
        <div className="mt-2.5 space-y-2">
          {drivers.map((d, i) => (
            <div key={d.f} className="flex items-center gap-2.5 text-xs">
              <span className="w-[88px] shrink-0 font-mono text-foreground">{d.f}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="lp-bar h-full rounded-full" style={{ width: `${d.w}%`, '--i': i + 4, background: d.dir === 'up' ? 'var(--chart-5)' : 'var(--muted-foreground)' }} />
              </div>
              <span className="w-12 shrink-0 text-right text-muted-foreground">{d.dir === 'up' ? 'raises' : 'lowers'}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 rounded-lg bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        Screening support, not a diagnosis. Suggested next step: haemoglobin analysis (HPLC) with ferritin.
      </p>
    </div>
  );
}

function HowItWorks() {
  const wrap = useRef(null);
  // Fill the rail as the section scrolls through the viewport.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.6 - r.top) / r.height));
      el.style.setProperty('--progress', `${(p * 100).toFixed(1)}%`);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);
  return (
    <div ref={wrap} className="relative">
      <div className="lp-rail" aria-hidden="true"><span /></div>
      <ol className="space-y-8">
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.title} variant="from-left" className="relative pl-14">
            <span className="absolute left-0 top-0 flex size-10 items-center justify-center rounded-full border border-primary/30 bg-card text-primary shadow-sm">
              <s.icon className="size-[18px]" />
            </span>
            <div className="text-xs font-medium text-muted-foreground">Step {i + 1}</div>
            <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{s.title}</h3>
            <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.chips.map((c) => (
                <span key={c} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground">{c}</span>
              ))}
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children }) {
  return (
    <Reveal className="mx-auto max-w-[720px] text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</div>
      <h2 className="mt-2.5 text-balance text-[28px] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {children && <p className="mt-3.5 text-pretty text-base leading-relaxed text-muted-foreground">{children}</p>}
    </Reveal>
  );
}

export default function LandingPage() {
  const { isAuthed, user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    document.title = 'FedHealth — privacy-preserving blood disorder screening';
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [['#what', 'What it is'], ['#how', 'How it works'], ['#privacy', 'Privacy'], ['#portals', 'Portals']];

  return (
    <div className="lp min-h-full bg-background" data-testid="landing">
      {/* ---------------- nav ---------------- */}
      <header className={`lp-nav fixed inset-x-0 top-0 z-50 text-white ${scrolled || menu ? 'scrolled' : ''}`}>
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-6 px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[oklch(0.8_0.1_186)] text-[oklch(0.2_0.03_205)]">F</span>
            Fed<span className="-ml-2 text-[oklch(0.84_0.1_186)]">Health</span>
          </a>
          <nav className="ml-4 hidden items-center gap-6 text-sm text-white/75 md:flex" aria-label="Sections">
            {links.map(([href, label]) => <a key={href} href={href} className="transition-colors hover:text-white">{label}</a>)}
            <Link to="/help" className="transition-colors hover:text-white">Help Portal</Link>
          </nav>
          <div className="flex-1" />
          <Link to={isAuthed ? '/app' : '/login'} data-testid="landing-signin"
                className="lp-cta hidden rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[oklch(0.2_0.03_205)] sm:inline-flex">
            {isAuthed ? 'Open my portal' : 'Sign in'}
          </Link>
          <button type="button" className="inline-flex size-10 items-center justify-center rounded-lg border border-white/20 md:hidden"
                  aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {menu ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menu && (
          <nav className="border-t border-white/10 px-4 pb-4 pt-2 md:hidden" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)} className="block rounded-lg px-2 py-3 text-base text-white/85">{label}</a>
            ))}
            <Link to="/help" className="block rounded-lg px-2 py-3 text-base text-white/85">Help Portal</Link>
            <Link to={isAuthed ? '/app' : '/login'} className="mt-2 block rounded-lg bg-white px-4 py-3 text-center text-base font-semibold text-[oklch(0.2_0.03_205)]">
              {isAuthed ? 'Open my portal' : 'Sign in'}
            </Link>
          </nav>
        )}
      </header>

      {/* ---------------- hero ---------------- */}
      <section id="top" className="lp-hero overflow-hidden pt-16">
        <span className="lp-blob left-[-80px] top-[120px] size-[280px] bg-[oklch(0.6_0.1_186)]" aria-hidden="true" />
        <span className="lp-blob bottom-[-60px] right-[10%] size-[240px] bg-[oklch(0.6_0.1_158)]" style={{ animationDelay: '-6s' }} aria-hidden="true" />
        <div className="mx-auto grid max-w-[1180px] items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-24 lg:pt-20">
          <div>
            <div className="lp-rise inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80" style={{ '--i': 0 }}>
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[oklch(0.85_0.12_158)] opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-[oklch(0.85_0.12_158)]" />
              </span>
              Federated clinical intelligence for Pakistan's laboratories
            </div>
            <h1 className="lp-rise mt-5 text-balance text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[58px]" style={{ '--i': 1 }}>
              Catch blood disorders early. <span className="lp-gradient-text">Keep every patient record where it belongs.</span>
            </h1>
            <p className="lp-rise mt-5 max-w-[56ch] text-pretty text-base leading-relaxed text-white/75 sm:text-lg" style={{ '--i': 2 }}>
              FedHealth screens a routine blood count for anaemia, thalassaemia and leukaemia, explains its reasoning to the
              doctor, and lets laboratories improve the model together without sharing a single report.
            </p>
            <div className="lp-rise mt-8 flex flex-col gap-3 sm:flex-row" style={{ '--i': 3 }}>
              <a href="#portals" data-testid="landing-cta"
                 className="lp-cta inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[oklch(0.84_0.1_186)] px-6 text-base font-semibold text-[oklch(0.2_0.03_205)]">
                {isAuthed ? 'Go to the portals' : 'Choose your portal'} <ArrowRight className="size-4" />
              </a>
              <a href="#how" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-6 text-base font-medium text-white transition-colors hover:bg-white/10">
                See how it works
              </a>
            </div>
            <ul className="lp-rise mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70" style={{ '--i': 4 }}>
              {['Screening support, never an automatic diagnosis', 'Two-factor sign-in for every account', 'Runs on the hospital\'s own servers'].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[oklch(0.85_0.12_158)]" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="lp-rise mx-auto w-full max-w-[520px]" style={{ '--i': 3 }}>
            <FederationDiagram />
          </div>
        </div>
        <a href="#what" className="mx-auto mb-6 hidden w-fit flex-col items-center text-xs text-white/50 transition-colors hover:text-white lg:flex" aria-label="Scroll to content">
          <ChevronDown className="size-5 animate-bounce" />
        </a>
      </section>

      {/* ---------------- stats strip ---------------- */}
      <section className="border-b border-border bg-card">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px bg-border lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} i={i} className="bg-card px-4 py-7 text-center sm:px-6">
              <div className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"><CountUp to={s.value} suffix={s.suffix} /></div>
              <div className="mt-1.5 text-sm font-medium text-foreground">{s.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.note}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- what it is ---------------- */}
      <section id="what" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <SectionHeading eyebrow="What FedHealth is" title="One platform for the clinic, the laboratory and public health">
            Blood disorders are common, treatable when found early, and often missed because specialist review is far away.
            FedHealth brings a second opinion to the point of care and turns everyday lab work into shared, privacy-preserving knowledge.
          </SectionHeading>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} i={i} className="lp-card rounded-2xl border border-border bg-card p-6">
                <span className="lp-icon flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><p.icon className="size-5" /></span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- marquee ---------------- */}
      <div className="overflow-hidden border-y border-border bg-secondary/60 py-3.5" aria-hidden="true">
        <div className="lp-marquee">
          {[...CAPABILITIES, ...CAPABILITIES].map((c, i) => (
            <span key={`${c}-${i}`} className="mx-5 flex items-center gap-2.5 whitespace-nowrap text-sm font-medium text-secondary-foreground">
              <span className="size-1.5 rounded-full bg-primary" />{c}
            </span>
          ))}
        </div>
      </div>

      {/* ---------------- how it works ---------------- */}
      <section id="how" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <SectionHeading eyebrow="How it works" title="From a printed report to a shared, improving model" />
          <div className="mt-12 grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
            <HowItWorks />
            <div className="lg:sticky lg:top-24">
              <ResultIllustration />
              <Reveal className="mt-4 text-center text-xs text-muted-foreground">
                What the doctor sees: calibrated scores, the values that drove them, and what to check next.
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- privacy ---------------- */}
      <section id="privacy" className="scroll-mt-20 bg-[oklch(0.2_0.03_205)] px-4 py-16 text-white sm:px-6 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <Reveal className="mx-auto max-w-[720px] text-center">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[oklch(0.84_0.1_186)]">Privacy and safety</div>
            <h2 className="mt-2.5 text-balance text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">Built so that trust does not depend on a promise</h2>
            <p className="mt-3.5 text-base leading-relaxed text-white/70">
              Health data is the most sensitive data there is. Each safeguard below is enforced by the system itself, in code and in the database.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SAFEGUARDS.map((s, i) => (
              <Reveal key={s.title} i={i % 4} variant="zoom"
                      className="lp-card rounded-2xl border border-white/10 bg-white/[0.04] p-5 hover:!border-[oklch(0.8_0.1_186/0.6)]">
                <span className="lp-icon flex size-10 items-center justify-center rounded-xl bg-[oklch(0.8_0.1_186/0.14)] text-[oklch(0.86_0.1_186)]"><s.icon className="size-5" /></span>
                <h3 className="mt-3.5 text-base font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/65">{s.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- portals ---------------- */}
      <section id="portals" className="scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-[1180px]">
          <SectionHeading eyebrow="Portals" title="Sign in to your workspace">
            {isAuthed
              ? `You are signed in${user?.fullName ? ` as ${user.fullName}` : ''}. Open your portal, or pick another role to switch account.`
              : 'Pick your role. New accounts upload proof of role once and are reviewed by an administrator before access is granted.'}
          </SectionHeading>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PORTALS.map((p, i) => (
              <Reveal key={p.role} i={i % 3}>
                <Link to={isAuthed && user?.role === p.role ? '/app' : `/login?role=${p.role}`} data-testid={`portal-${p.role}`}
                      className="lp-card group flex h-full flex-col rounded-2xl border border-border bg-card p-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  <div className="flex items-start justify-between gap-3">
                    <span className="lp-icon flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"><p.icon className="size-6" /></span>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{p.tag}</span>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">{p.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-primary" />{p.proof}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                    {isAuthed && user?.role === p.role ? 'Open portal' : `Sign in as ${p.title.toLowerCase()}`} <ArrowRight className="lp-arrow size-4" />
                  </span>
                </Link>
              </Reveal>
            ))}
            <Reveal i={2}>
              <Link to="/help" className="lp-card group flex h-full flex-col justify-between rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <div>
                  <span className="lp-icon flex size-12 items-center justify-center rounded-xl bg-card text-primary"><HeartHandshake className="size-6" /></span>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">Want to help?</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Browse NGOs and their open requests for blood, medicine and equipment. No account needed.
                  </p>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">Open the Help Portal <ArrowRight className="lp-arrow size-4" /></span>
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-border bg-card px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[460px]">
            <div className="text-lg font-bold tracking-tight text-foreground">Fed<span className="text-primary">Health</span></div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              FedHealth is clinical decision support. It does not diagnose, and it does not replace a doctor's judgement or
              confirmatory laboratory testing. A final-year project in federated, privacy-preserving machine learning for healthcare.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm text-muted-foreground" aria-label="Footer">
            {links.map(([href, label]) => <a key={href} href={href} className="hover:text-foreground">{label}</a>)}
            <Link to="/help" className="hover:text-foreground">Help Portal</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </nav>
        </div>
        <div className="mx-auto mt-8 max-w-[1180px] border-t border-border pt-5 text-xs text-muted-foreground">
          © {new Date().getFullYear()} FedHealth. Patient data stays in the laboratory that produced it.
        </div>
      </footer>
    </div>
  );
}
