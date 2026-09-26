// Mock-mode UI checks (VITE_USE_MOCK=true, no backend): the four-class contract,
// the 10-field form with units, disclaimer, and the Model Health page showing
// the real registry snapshot with sample-data labels. Text assertions only.
import { test, expect } from '@playwright/test';
import { completeMfaSetup, fillExampleReport, OLD_LABELS } from './helpers.js';

// The mock keeps its session in memory, so navigate inside the SPA (sidebar),
// never with page.goto() after signing in.
async function signIn(page, email) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', 'mock-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await completeMfaSetup(page);
}

test('doctor: 10 CBC fields with units, four-class result and disclaimer', async ({ page }) => {
  await signIn(page, 'doctor@fedhealth.demo');
  await expect(page.getByRole('heading', { name: 'Doctor Portal' })).toBeVisible();
  await expect(page.getByTestId('mock-banner')).toBeVisible();
  await expect(page.locator('[data-testid^="cbc-field-"]')).toHaveCount(10);
  for (const f of ['WBC', 'RBC', 'HGB', 'HCT', 'MCV', 'MCH', 'MCHC', 'RDW', 'PLT', 'NEUTp']) {
    await expect(page.getByTestId(`cbc-field-${f}`)).toBeVisible();
  }
  await expect(page.getByText('(context, not used by the model)').first()).toBeVisible();

  await page.fill('#patientRef', 'pt-mock-001');
  await fillExampleReport(page, { HGB: '40' }, { HGB: 'g/dL' });
  await page.getByRole('button', { name: 'Analyze CBC' }).click();
  await expect(page.getByText(/HGB outside supported range 2\.\.24 g\/dL/)).toBeVisible();

  await fillExampleReport(page);
  await expect(page.getByTestId('cbc-field-WBC')).toContainText('= 9.01 10^3/uL');
  await page.getByRole('button', { name: 'Analyze CBC' }).click();
  const scores = page.getByTestId('confidence-scores');
  await expect(scores).toBeVisible();
  for (const label of ['Healthy', 'Anemia', 'Thalassemia', 'Leukemia']) await expect(scores).toContainText(label);
  await expect(page.locator('[data-testid^="score-"]')).toHaveCount(4);
  await expect(page.getByTestId('screening-disclaimer')).toContainText('not a diagnosis');
  await expect(page.getByTestId('screening-disclaimer')).toContainText('not produced by the model');
  await expect(page.getByTestId('model-version')).toContainText('cbc_multiclass');
  await expect(page.locator('body')).not.toContainText(OLD_LABELS);
});

test('doctor: OCR fills values and printed units for review', async ({ page }) => {
  await signIn(page, 'doctor2@fedhealth.demo');
  await page.getByRole('button', { name: /Paste text/ }).click();
  await page.getByLabel('Report text').fill('WBC 9,010 /mm3');
  await page.getByRole('button', { name: 'Read values' }).click();
  await expect(page.getByTestId('ocr-summary')).toContainText('Read 10 of 10 values');
  await expect(page.locator('#cbc-PLT')).toHaveValue('147000');
  await expect(page.getByTestId('cbc-field-PLT')).toContainText('Printed on report: /mm3');
});

test('NIH: Model Health shows the registered model, limitations and labelled sample data', async ({ page }) => {
  await signIn(page, 'officer@nih.org.pk');
  await expect(page.getByRole('heading', { name: 'Surveillance Dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'Model Health' }).click();
  await expect(page.getByRole('heading', { name: 'AI Model Health' })).toBeVisible();
  await expect(page.getByTestId('model-card')).toContainText('v2-four-class-seed42-b24108b19482');
  await expect(page.getByTestId('model-card')).toContainText('temperature scaling');
  await expect(page.getByTestId('stat-accuracy')).toHaveText('88.8%');
  const limits = page.getByTestId('limitations-panel');
  await expect(limits).toContainText('Unseen-source accuracy: 29%–87%');
  await expect(limits).toContainText('not been validated on data from unseen laboratories');
  await expect(limits).toContainText('did not beat the starting model in 9 of 12');
  const enc = page.getByTestId('encryption-card');
  await expect(enc).toContainText('12 plaintext runs');
  await expect(enc).toContainText('Paillier 2048-bit · 5 rounds');
  await expect(page.getByTestId('fl-nodes')).toContainText('lab-04');
  await expect(page.getByTestId('sample-node-status')).toContainText('Sample data');
  await expect(page.getByTestId('data-intake')).toContainText('Sample data');
  await expect(page.getByTestId('runs-table')).toContainText('Paillier 2048');
  await expect(page.locator('body')).not.toContainText(OLD_LABELS);
});

test('NIH: surveillance filters on the model classes only', async ({ page }) => {
  await signIn(page, 'officer2@nih.org.pk');
  await expect(page.getByRole('heading', { name: 'Surveillance Dashboard' })).toBeVisible();
  const table = page.locator('table').first();
  await expect(table).toContainText('Anemia');
  await expect(table).toContainText('Thalassemia');
  await expect(table).not.toContainText('Healthy');
  await expect(page.locator('body')).not.toContainText(OLD_LABELS);
});
