// Live end-to-end UI checks against the real stack (Vite :5173 -> backend :4000
// -> inference :8000 with the seed-42 model -> PostgreSQL). Skipped when the
// backend is not running. Creates throwaway e2e-ui-* accounts and reports.
// Text assertions only.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { completeMfaSetup, fillExampleReport, totp, OLD_LABELS } from './helpers.js';

const BACKEND = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:4000';
const RUN = Date.now();
// Sign-up needs a proof document and an administrator's approval. The approval is done
// straight in the database here (scripts/lib/e2eAccounts.js); the admin UI path is
// covered by production.spec.js (mock) and scripts/e2e-production.js (API).
const backendRequire = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../Module 1-2 Merged Backend/scripts/e2e-acceptance.js'));
backendRequire('dotenv').config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Module 1-2 Merged Backend/.env') });
const { approveByEmail, PROOF_PDF } = backendRequire('./lib/e2eAccounts');
const PROOF = { name: 'e2e-licence.pdf', mimeType: 'application/pdf', buffer: PROOF_PDF };

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '../../Module 1-2 Merged Backend/test/fixtures/cbc_report.png');

test.beforeAll(async ({ request }) => {
  const up = await request.get(`${BACKEND}/health/inference`).then((r) => r.ok()).catch(() => false);
  test.skip(!up, 'live backend/inference not running (tools/run-local.ps1 -Start)');
});

// Registers a new doctor through the real UI flow (not the API) and completes
// MFA enrolment, ending on the Doctor Portal home.
async function registerDoctorViaUi(page, email) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.fill('#fullName', 'E2E UI Doctor');
  await page.fill('#email', email);
  await page.fill('#password', `Ui-${RUN}-pass`);
  await page.getByTestId('proof-input').setInputFiles(PROOF);
  await expect(page.getByTestId('proof-chosen')).toContainText('e2e-licence.pdf');
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = await completeMfaSetup(page);
  // No portal until the proof is approved.
  await expect(page.getByTestId('awaiting-verification')).toBeVisible();
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', `Ui-${RUN}-pass`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('verification-notice')).toContainText('awaiting verification');
  await approveByEmail(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.fill('#mfa-code', totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Doctor Portal' })).toBeVisible();
  await expect(page.getByTestId('mock-banner'), 'live run must not use the mock client').toHaveCount(0);
}

/** NIH officials are created through the API (the UI flow is the same as the doctor's). */
async function nihToken(request) {
  const email = `e2e-ui-nih-${RUN}@nih.org.pk`;
  const password = `Ui-${RUN}-pass`;
  const reg = await request.post('/api/auth/register', {
    multipart: { email, password, fullName: 'E2E UI NIH', role: 'nih_official', proof: PROOF },
  });
  expect(reg.status()).toBe(201);
  const { preAuthToken } = await reg.json();
  const headers = { Authorization: `Bearer ${preAuthToken}` };
  const setup = await (await request.post('/api/auth/mfa/setup', { headers, data: {} })).json();
  const enrolled = await request.post('/api/auth/mfa/verify-setup', { headers, data: { code: totp(setup.manualKey) } });
  expect((await enrolled.json()).pendingVerification).toBe(true);
  await approveByEmail(email);
  const login = await (await request.post('/api/auth/login', { data: { email, password } })).json();
  const verify = await request.post('/api/auth/mfa/verify', {
    headers: { Authorization: `Bearer ${login.preAuthToken}` }, data: { code: totp(setup.manualKey) },
  });
  return (await verify.json()).accessToken;
}

test.describe.serial('live stack', () => {
  let page;
  let baseURL;
  // browser.newPage() does not apply the project's `use` options, so pass baseURL.
  test.beforeAll(async ({ browser }, testInfo) => {
    baseURL = testInfo.project.use.baseURL;
    page = await browser.newPage({ baseURL });
    // Warm up: Vite optimizes dependencies on the first load and may reload once.
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });
  test.afterAll(async () => { await page.close(); });

  test('doctor registers with MFA and scores the example report with its printed units', async () => {
    await registerDoctorViaUi(page, `e2e-ui-doctor-${RUN}@fedhealth.test`);
    await page.getByTestId('new-patient-id').click();
    await expect(page.locator('#patientRef')).toHaveValue(/^FH-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    await page.selectOption('#district', 'Lahore');
    await fillExampleReport(page);
    await page.getByRole('button', { name: 'Analyze CBC' }).click();
    const scores = page.getByTestId('confidence-scores');
    await expect(page.getByTestId('score-anemia')).toContainText('59%', { timeout: 30000 });
    await expect(page.getByTestId('score-healthy')).toContainText('22%');
    await expect(page.getByTestId('score-thalassemia')).toContainText('17%');
    await expect(page.getByTestId('score-leukemia')).toContainText('2%');
    await expect(scores).toBeVisible();
    await expect(page.getByTestId('model-version')).toContainText('v2-four-class-seed42-b24108b19482');
    await expect(page.getByTestId('model-version')).toContainText('temperature scaling');
    await expect(page.getByTestId('screening-disclaimer')).toContainText('not a diagnosis');
    await expect(page.getByText('All 10 were provided.')).toBeVisible();
    await expect(page.getByTestId('visit-table')).toContainText('Anemia 59%');
    // Served by the primary model, with a real Shapley explanation and guideline next steps.
    await expect(page.getByTestId('backup-served')).toHaveCount(0);
    await expect(page.locator('[data-testid^="xai-row-"]')).toHaveCount(10);
    await expect(page.getByTestId('explanation-panel')).toContainText('exact Shapley values');
    await expect(page.getByTestId('recommendations-card')).toContainText('Anaemia');
    const [guide] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('open-guidance').click()]);
    await expect(guide.getByTestId('guidance-body')).toContainText('Serum ferritin', { timeout: 20000 });
    await expect(guide.getByTestId('guidance-body')).toContainText('World Health Organization');
    await guide.close();
    // Confirming adds the case to the dataset.
    await page.getByRole('combobox', { name: 'Confirmed condition' }).click();
    await page.getByRole('option', { name: 'Anemia' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByTestId('dataset-note')).toBeVisible();
  });

  test('image OCR (tesseract) fills the 10 values and printed units', async () => {
    await page.getByTestId('ocr-file').setInputFiles(FIXTURE);
    await expect(page.getByTestId('ocr-summary')).toContainText('Read 10 of 10 values', { timeout: 60000 });
    await expect(page.locator('#cbc-WBC')).toHaveValue('9010');
    await expect(page.locator('#cbc-RBC')).toHaveValue('4.47');
    await expect(page.getByTestId('cbc-field-RBC')).toContainText('Printed on report: mil/mm3');
  });

  test('invalid input is stopped in the form before the API', async () => {
    await page.fill('#cbc-HGB', '40');
    await page.getByRole('button', { name: 'Analyze CBC' }).click();
    await expect(page.getByText(/HGB outside supported range 2\.\.24 g\/dL/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(OLD_LABELS);
  });

  test('NIH official sees the real Model Health page and surveillance', async ({ request }) => {
    const token = await nihToken(request);
    const nih = await page.context().browser().newPage({ baseURL });
    await nih.goto('/login');
    await nih.evaluate((t) => localStorage.setItem('fedhealth_token', t), token);
    await nih.goto('/model-health');
    await expect(nih.getByTestId('model-card')).toContainText('v2-four-class-seed42-b24108b19482', { timeout: 20000 });
    await expect(nih.getByTestId('stat-accuracy')).toHaveText('88.8%');
    await expect(nih.getByText('Known limitations')).toHaveCount(0);
    await expect(nih.getByTestId('encryption-card')).toContainText('12 plaintext runs');
    await expect(nih.getByTestId('encryption-card')).toContainText('Paillier 2048-bit');
    await expect(nih.getByTestId('sample-node-status')).toContainText('Sample data');
    await nih.goto('/surveillance');
    await expect(nih.locator('table').first()).toContainText('Lahore', { timeout: 20000 });
    await expect(nih.locator('table').first()).toContainText('Anemia');
    await expect(nih.locator('body')).not.toContainText(OLD_LABELS);
    await nih.close();
  });

  test('public Help Portal lists the sample NGOs and supply requests', async () => {
    const visitor = await page.context().browser().newPage({ baseURL });
    await visitor.goto('/help');
    await expect(visitor.getByText('Roshni Thalassemia Care (sample)').first()).toBeVisible({ timeout: 20000 });
    await expect(visitor.getByText('O- units needed for the transfusion ward').first()).toBeVisible();
    await visitor.close();
  });
});
