# FedHealth — Frontend (Doctor Portal + Surveillance Dashboard)

A React (Vite) single-page app. One build, **role-routed**: doctors land in the
Doctor Portal, health officials in the Surveillance Dashboard — mirroring
backend RBAC. (The backend role slug/permission/API paths stay `nih_official`
/ `nih:dashboard` / `/nih/...` to match Module 2/6; only the UI copy and
routing are genericized.)

## Design
A "clinical instrument" identity: IBM Plex Sans for UI, **IBM Plex Mono for every
clinical value and confidence score**, a calm deep-teal palette, and a
clinical-red reserved *only* for risk flags. The signature element is the ranked,
calibrated **confidence readout** — the app never shows a single verdict; it shows
every condition's confidence and the doctor confirms.

## Run
```bash
cd frontend
cp .env.example .env
npm install
npm run dev          # http://localhost:5173  (proxies /api -> backend :4000)
```
Have the backend (Module 2/6) and the inference service (Module 6) running.

## What's here
- **Auth** — login / register, then mandatory TOTP MFA (QR enrolment + code),
  matching the backend flow. Token kept in localStorage (see note).
- **Doctor Portal** (`/doctor`):
  - Patient reference (pseudonymous — no name/ID), sex, age, district/province.
  - **CBC entry** as a monospace grid, or **OCR**: upload a photo of a paper
    report → Tesseract → auto-filled values to review.
  - **Multilingual symptoms** (English / Urdu / Roman-Urdu) with optional voice
    dictation (Web Speech API), parsed to canonical tags.
  - **Analyze** → calibrated per-condition **confidence readout**, the
    **thalassemia-trait rule flag** (Mentzer + discriminant indices, expandable),
    a **risk banner** when flagged, and **doctor confirmation** (the only
    authoritative diagnosis).
  - **Longitudinal trends** — recharts line chart of any CBC index across the
    patient's visits, plus a visit table.

## Decisions / notes (for defense)
- **Leaflet** (fixed stack) via **react-leaflet** + **leaflet.heat** for the
  surveillance map. The Surveillance Dashboard (`/surveillance`) has three
  views: **Surveillance** (a cluster map — proportional markers or a heat
  layer — with province/condition filters, summary stats, and a cluster
  table), **Alerts** (the predictive-alert feed with acknowledgement), and
  **Compliance** (audit-chain verification + recent log). All surveillance
  data is aggregated/anonymized; the role can't reach individual records.
- **recharts** is an addition to the fixed stack (a React charting library) for
  the trend charts. Minor dependency choice; hand-rolled SVG was the alternative.
- **Voice input** uses the browser's Web Speech API (no dependency); the mic
  button hides where unsupported. Urdu recognition quality varies by browser —
  it's a progressive enhancement, not a hard requirement.
- **Token in localStorage** keeps the demo simple; a production build would use an
  httpOnly cookie to reduce XSS exposure. Flagged.
- **Symptoms are context, not model input** — shown to the doctor and stored on
  the report; the CBC model stays CBC-only.
- Single app, **role-routed** (one build serves Doctor + Surveillance), rather
  than two separate apps.
