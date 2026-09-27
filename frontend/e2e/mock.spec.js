// Mock-mode UI checks (VITE_USE_MOCK=true, no backend): the four-class contract,
// the 10-field form with units, disclaimer, and the Model Health page showing
// the real registry snapshot with sample-data labels. Text assertions only.
import { test, expect } from '@playwright/test';
import { completeMfaSetup, fillExampleReport, OLD_LABELS } from './helpers.js';

// The mock keeps its session in memory, so navigate inside the SPA (sidebar),
// never with page.goto() after signing in.
// Logs in and completes MFA setup (mock accounts always need enrolment on
// first sign-in); password is unchecked by the mock, so any value works.
async function signIn(page, email) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', 'mock-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await completeMfaSetup(page);
}

test('login: clearing the email also clears the password', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'doctor@fedhealth.demo');
  await page.fill('#password', 'mock-password-123');
  await page.fill('#email', 'doctor2@fedhealth.demo'); // editing keeps it
  await expect(page.locator('#password')).toHaveValue('mock-password-123');
  await page.fill('#email', '');
  await expect(page.locator('#password')).toHaveValue('');
});

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

test('doctor: nonsense input is caught in the form with a specific message', async ({ page }) => {
  await signIn(page, 'doctor3@fedhealth.demo');
  await page.fill('#patientRef', '35202-1234567-1');
  await expect(page.getByTestId('patient-ref-error')).toContainText('looks like a CNIC number');
  await page.fill('#patientRef', 'pt-<script>');
  await expect(page.getByTestId('patient-ref-error')).toContainText('only letters, digits');
  await page.fill('#ageYears', 'abc');
  await expect(page.getByTestId('age-error')).toContainText('whole number');
  await page.fill('#patientRef', 'pt-mock-bad');
  await page.fill('#ageYears', '34');

  await page.fill('#cbc-HGB', 'abc');
  await page.fill('#cbc-WBC', '9010'); // count typed while the unit is ×10³/µL
  await page.fill('#cbc-HCT', '0.38'); // fraction typed while the unit is %
  await page.getByRole('button', { name: 'Analyze CBC' }).click();
  await expect(page.getByText('Fix the highlighted CBC values or units first.')).toBeVisible();
  await expect(page.getByTestId('cbc-field-HGB')).toContainText('HGB must be a number');
  await expect(page.getByTestId('cbc-field-WBC')).toContainText('9010 would fit if the unit is /mm³ (count)');
  await expect(page.getByTestId('cbc-field-HCT')).toContainText('would fit if the unit is L/L');
  await expect(page.getByTestId('confidence-scores')).toHaveCount(0); // nothing was sent

  await fillExampleReport(page, { HGB: '2.4' }, { HGB: 'g/dL' });
  await fillExampleReport(page, { WBC: '9,010', HCT: '38', RBC: '4.47', MCHC: '33', MCH: '28', MCV: '85' },
    { WBC: '/mm3', HCT: '%', RBC: 'mil/mm3', MCHC: 'g/dL', MCH: 'pg', MCV: 'fL' });
  await expect(page.getByTestId('cbc-warnings')).toContainText('MCHC is 33 but HGB / HCT x 100 gives 6.3');

  await page.getByTestId('ocr-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('Choose a PNG, JPEG, WebP or TIFF photo/scan of the report')).toBeVisible();
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

test('NIH: Model Health shows the registered model and labelled sample data', async ({ page }) => {
  await signIn(page, 'officer@nih.org.pk');
  await expect(page.getByRole('heading', { name: 'Surveillance Dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'Model Health' }).click();
  await expect(page.getByRole('heading', { name: 'AI Model Health' })).toBeVisible();
  await expect(page.getByTestId('model-card')).toContainText('v2-four-class-seed42-b24108b19482');
  await expect(page.getByTestId('model-card')).toContainText('temperature scaling');
  await expect(page.getByTestId('stat-accuracy')).toHaveText('88.8%');
  // Limitations are documented on paper; the panel is intentionally not on this page.
  await expect(page.getByText('Known limitations')).toHaveCount(0);
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
  const flags = page.getByTestId('stat-flags');
  // 145 non-healthy results + 1 leukemia risk flag on a healthy-top result.
  await expect(page.getByTestId('stat-cases')).toContainText('145');
  await expect(flags).toContainText('Total disease flags');
  await expect(flags).toContainText('146');

  // The filter dropdowns open above the map: Playwright fails a click that the
  // Leaflet map would intercept, so this guards the earlier overlap bug.
  await expect(page.getByTestId('cluster-map')).toBeVisible();
  await page.getByRole('combobox').filter({ hasText: 'All provinces' }).click();
  await page.getByRole('option', { name: 'Sindh' }).click();
  await expect(table).toContainText('Karachi');
  await expect(table).not.toContainText('Lahore');
  await page.getByRole('combobox').filter({ hasText: 'All conditions' }).click();
  await page.getByRole('option', { name: 'Thalassemia' }).click();
  await expect(table).toContainText('Thalassemia');
  await expect(table).not.toContainText('Anemia');
  await expect(flags).toContainText('Thalassemia flags');
  await expect(flags).toContainText('30');

  // Leukemia flags = leukemia-top results (10) + the risk flag on another class.
  await page.getByRole('combobox').filter({ hasText: 'Sindh' }).click();
  await page.getByRole('option', { name: 'All provinces' }).click();
  await page.getByRole('combobox').filter({ hasText: 'Thalassemia' }).click();
  await page.getByRole('option', { name: 'Leukemia' }).click();
  await expect(page.getByTestId('stat-cases')).toContainText('10');
  await expect(flags).toContainText('Leukemia flags');
  await expect(flags).toContainText('11');
});
