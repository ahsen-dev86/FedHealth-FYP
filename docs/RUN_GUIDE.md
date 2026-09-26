# FedHealth — how to run it yourself

This guide is for running and demonstrating FedHealth on this laptop without any help.
Everything below was tested on this machine on 2026-09-26.

## What is already set up on this laptop

| Piece | Where | Starts how |
|---|---|---|
| PostgreSQL 18 + PostGIS (database `fedhealth`) | Windows service `postgresql-x64-18` | automatically with Windows |
| AI model service (Flask, seed-42 model) | `Module 6 Domain API/app.py` in `.venv` | by the start script, port **8000** |
| Backend API (Node/Express) | `Module 1-2 Merged Backend` | by the start script, port **4000** |
| Website (React/Vite) | `frontend` | by the start script, port **5173** |
| Tesseract OCR 5.4 | `C:\Program Files\Tesseract-OCR` | used by the backend when a report image is uploaded |

Secrets (database password, JWT key, API key) are in the git-ignored files `.env` and
`Module 1-2 Merged Backend\.env`. Do not delete, commit or share them.

## 1. Start FedHealth

**Easiest:** in File Explorer, open the `FedHealth FYP` folder and double-click **`start-fedhealth.cmd`**.
Wait until it prints four `up` lines (about 20–40 seconds: loading the AI model takes the longest).
Your browser opens <http://localhost:5173>.

**From VS Code (same result):**
1. VS Code → *File → Open Folder…* → `C:\Users\Ahsan\Desktop\FedHealth FYP`.
2. *Terminal → New Terminal* (PowerShell).
3. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Start -Frontend
   ```
4. Open <http://localhost:5173> in Chrome/Edge.

Check what is running at any time:
```powershell
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Status
```

> Note: `frontend\.env.local` (your file) contains `VITE_USE_MOCK=true`, so a plain `npm run dev`
> inside `frontend` starts the **demo mock** with fake scores. The start script always starts the
> real website; add `-Mock` only if you deliberately want the offline demo.

## 2. Sign in (demo accounts)

Every account needs a password **and** a 6-digit code (MFA). Demo accounts with MFA already set up exist:

| Role | Email | What it sees |
|---|---|---|
| Doctor | `doctor.demo@fedhealth.test` | Doctor Portal (enter CBC, OCR, confirm diagnosis, history) |
| NIH official | `nih.demo@nih.org.pk` | Surveillance map + alerts + compliance, AI Model Health |
| Admin | `admin.demo@fedhealth.test` | everything, including the audit log |

- Passwords and MFA keys are in **`run-results\demo-accounts.txt`** (git-ignored; open it in VS Code).
- Get the current 6-digit codes (valid ~30 s) in a VS Code terminal:
  ```powershell
  cd "Module 1-2 Merged Backend"
  npm run demo:code
  ```
- Or add each `mfa-key` to Google/Microsoft Authenticator on your phone ("enter a setup key", time-based).
- Lost the file or want new passwords: `npm run demo:users -- --reset` (in `Module 1-2 Merged Backend`).

You can also register new accounts on the login page ("Register"). NIH officials must use an
`@nih.org.pk` or `@gov.pk` address (no email is sent). The QR code shown after registering is
scanned with an authenticator app; below it is the key for `node scripts/totp-code.js <KEY>`.

## 3. A demonstration path (about 10 minutes)

1. **Doctor** → Doctor Portal. Patient reference `pt-demo-001`, district Lahore. Enter the example
   report **with the units printed on it**:
   WBC 9,010 `/mm³` · RBC 4.47 `million/mm³` · HGB 12.4 `g/dL` · HCT 38 `%` · MCV 85 `fL` · MCH 28 `pg` ·
   MCHC 33 `g/dL` · RDW-CV 13 `%` · PLT 147,000 `/mm³` · Neutrophils 69 `%`.
   *Analyze CBC* → Anemia 59%, Healthy 22%, Thalassemia 17%, Leukemia 2%, model version, disclaimer.
   Confirm a diagnosis at the bottom; the visit appears under *Longitudinal trends*.
2. **OCR:** *Scan report (OCR)* → choose `Module 1-2 Merged Backend\test\fixtures\cbc_report.png`
   → all 10 values and their printed units are filled in for review. *Paste text* works for PDFs.
3. **Wrong input handling** (what evaluators try): type `35202-1234567-1` as patient reference
   (refused: looks like a CNIC), age `abc`, HGB `abc`, WBC `9010` with unit ×10³/µL (hint: "would fit
   if the unit is /mm³"), HCT `0.38` with `%` (hint: L/L), HGB `2.4` with the rest of the example
   (amber warning: MCHC/MCH do not match), upload a `.txt` file (refused). Nothing is sent until
   the form is valid; the API and database reject the same things independently.
4. **NIH official** → Surveillance: clusters by district and condition, alerts (a leukemia score
   ≥ 30% raises one), Compliance tab (audit chain verified). → **AI Model Health**: registered
   model and its measured test results, federated runs per round, encryption per run
   (12 plaintext, 1 Paillier-2048), charts marked **Sample data** where no real data exists.
   (Known limitations are in the written report, not on this page.)
5. **Help Portal** (<http://localhost:5173/help>, no login): five sample NGOs with supply requests.
   They are marked "(sample)"; if the portal is ever empty run `npm run demo:help` in
   `Module 1-2 Merged Backend`.

## 4. Stop FedHealth

Double-click **`stop-fedhealth.cmd`**, or:
```powershell
powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Stop
```
PostgreSQL keeps running as a service (that is fine).

## 5. Run the tests yourself

Start FedHealth first (step 1) for the live tests. From the `FedHealth FYP` folder in a VS Code terminal:

| What | Command | Expected |
|---|---|---|
| Python: ML, federation, encryption, contract | `.venv\Scripts\python.exe -m pytest` | all pass (takes ~4 min) |
| Backend unit + database tests | `cd "Module 1-2 Merged Backend"; npm test` | all pass |
| API acceptance (login+MFA, predict, OCR, confirm, alerts, Model Health) | `npm run test:e2e -- --out ..\run-results\acceptance.md` | `60 passed, 0 failed` |
| Robustness matrix (130+ wrong/absurd inputs) | `npm run test:robustness -- --out ..\run-results\robustness.md` | `133 of 133 passed` |
| Frontend unit tests | `cd frontend; npm test` | all pass |
| Frontend build | `cd frontend; npm run build` | `✓ built` |
| Browser tests (text only) | `cd frontend; npx playwright test` | all pass (live tests need step 1) |

The API tests create throwaway `e2e-*` accounts and records each run; that is expected.

## 6. If something goes wrong

| Symptom | Fix |
|---|---|
| Start script says a service did not start | Read the log it names in `run-results\logs\`. Then run `-Stop`, then `-Start -Frontend` again. |
| `port ... already in use` / a service is "already running" but broken | `tools\run-local.ps1 -Stop` (also stops stray node/python on 8000/4000/5173), then start again. |
| Login page: "Cannot reach the FedHealth server" | The backend is not running: start FedHealth (step 1). |
| "The analysis service is not reachable" after *Analyze CBC* | The AI model service stopped: `-Stop` then `-Start -Frontend`; check `run-results\logs\inference.log`. |
| Database errors / backend exits at start | Services → `postgresql-x64-18` must be *Running* (Start it). |
| MFA code rejected | Codes change every 30 s (the key stays the same; keep the authenticator time-based, not counter-based). Use the code on screen now, or `npm run demo:code`. If fresh codes fail, turn on automatic date/time on the phone and laptop. |
| "Too many attempts" at login | Security rate limit (30 tries per 15 min). Wait 15 minutes. |
| Account locked after wrong passwords | Wait 15 minutes, or `npm run demo:users -- --reset` for the demo accounts. |
| Scores look random and a "Demo mode — mock API" badge shows | The site runs the mock: stop it and start with the script (not `npm run dev`). |
| PowerShell refuses to run the script | Always call it as `powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 ...` (as above). |

## 7. Setting up a fresh machine (only if you ever move the project)

1. Install PostgreSQL 18 with PostGIS (Stack Builder), Node.js 20+, Python 3.12, Tesseract (UB-Mannheim build).
2. In the project folder:
   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements-test.txt
   cd "Module 1-2 Merged Backend"; npm install; cd ..\frontend; npm install; cd ..
   ```
3. Create `Module 1-2 Merged Backend\.env` from `.env.example` (random `PGPASSWORD`, `JWT_SECRET`,
   `PATIENT_REF_HMAC_KEY`, `INFERENCE_API_KEY`) and a root `.env` with `PG_SUPERUSER=postgres` and
   `PG_SUPERUSER_PASSWORD=<your postgres password>`.
4. `powershell -ExecutionPolicy Bypass -File tools\run-local.ps1 -Setup` (creates the database,
   applies the migrations, registers the model, imports the federated runs), then
   `cd "Module 1-2 Merged Backend"; npm run demo:users; npm run demo:help`, then start as in step 1.
