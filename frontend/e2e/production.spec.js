// Mock-mode UI checks for the production-readiness flows (VITE_USE_MOCK=true,
// no backend): landing page, proof-of-role sign-up and administrator approval,
// explanation + guideline window + dataset de-duplication, voice dictation,
// administrator reach (every portal, any NGO) and the failover drill.
// Text assertions only.
import { test, expect } from '@playwright/test';
import { completeMfaSetup, fillExampleReport, totp } from './helpers.js';

const REF = 'FH-0000-0000'; // a valid FedHealth patient ID (check character 0)
// A minimal PNG, enough for the proof-document field.
const PROOF = {
  name: 'licence.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
};

// First sign-in of a mock account enrols MFA; returns the TOTP secret.
async function signIn(page, email) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', 'mock-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  return completeMfaSetup(page);
}

// Later sign-ins in the same browser only ask for a code.
async function signInAgain(page, email, secret, password = 'mock-password-123') {
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.fill('#mfa-code', totp(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
}

test('landing: every visitor starts on the landing page and picks a portal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Catch blood disorders early');
  for (const role of ['doctor', 'lab_tech', 'nih_official', 'ngo', 'admin']) {
    await expect(page.getByTestId(`portal-${role}`)).toBeVisible();
  }
  await page.getByTestId('portal-nih_official').click();
  await expect(page).toHaveURL(/\/login\?role=nih_official$/);
  await expect(page.getByTestId('login-subtitle')).toContainText('Sign in to the Surveillance');
  await page.getByTestId('back-home').click();
  await expect(page.getByTestId('landing')).toBeVisible();
  // Administrators cannot self-register.
  await page.getByTestId('portal-admin').click();
  await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
});

test('landing: no horizontal overflow on a phone and the menu opens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('sign-up needs a proof document and stays locked until an administrator approves it', async ({ page }) => {
  await page.goto('/login?role=doctor');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.fill('#fullName', 'Dr New Doctor');
  await page.fill('#email', 'new.doctor@clinic.pk');
  await page.fill('#password', 'long-enough-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('Upload your proof document');

  await page.getByTestId('proof-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toContainText('must be a PDF, PNG, JPEG or WebP');
  await page.getByTestId('proof-input').setInputFiles(PROOF);
  await expect(page.getByTestId('proof-chosen')).toContainText('licence.png');
  await page.getByRole('button', { name: 'Create account' }).click();
  const secret = await completeMfaSetup(page);
  await expect(page.getByTestId('awaiting-verification')).toContainText('awaiting verification');

  // Signing in before approval is refused with an explanation.
  await page.getByText('Back to home').click();
  await page.getByTestId('portal-doctor').click();
  await page.fill('#email', 'new.doctor@clinic.pk');
  await page.fill('#password', 'long-enough-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('verification-notice')).toContainText('awaiting verification');

  // An administrator reviews the proof and approves the account.
  await signInAgain(page, 'admin@fedhealth.demo', secret);
  await expect(page.getByRole('heading', { name: 'Admin Console' })).toBeVisible();
  const row = page.getByTestId('account-row').filter({ hasText: 'new.doctor@clinic.pk' });
  await expect(row).toContainText('pending');
  await row.getByTestId('review-proof').click();
  await expect(page.getByTestId('proof-dialog')).toContainText('Dr New Doctor');
  await expect(page.getByTestId('proof-dialog').locator('img')).toBeVisible();
  await page.getByTestId('approve-proof').click();
  await expect(page.getByTestId('account-row').filter({ hasText: 'new.doctor@clinic.pk' })).toHaveCount(0); // left the pending list

  // The approved doctor can now sign in.
  await page.getByRole('button', { name: 'Log out' }).first().click();
  await signInAgain(page, 'new.doctor@clinic.pk', secret, 'long-enough-1');
  await expect(page.getByRole('heading', { name: 'Doctor Portal' })).toBeVisible();
});

test('doctor: explanation, guideline next steps in a separate window, and dataset de-duplication', async ({ page }) => {
  await signIn(page, 'doctor5@fedhealth.demo');
  for (let round = 0; round < 2; round += 1) {
    await page.fill('#patientRef', REF);
    await fillExampleReport(page);
    await page.getByRole('button', { name: 'Analyze CBC' }).click();
    await expect(page.getByTestId('explanation-panel')).toBeVisible();
    if (round === 0) {
      // Why this score: one bar per measured value, for any of the four classes.
      await expect(page.locator('[data-testid^="xai-row-"]')).toHaveCount(10);
      await page.getByTestId('xai-class-leukemia').click();
      await expect(page.getByTestId('xai-summary')).toContainText('Leukemia');
      // What each value tells us: the reading against a reference interval.
      await page.getByTestId('xai-tab-values').click();
      await expect(page.getByTestId('xai-readings')).toContainText('Reference');

      // Recommendations: summary in place, full text in its own window.
      const card = page.getByTestId('recommendations-card');
      await expect(card).toContainText('Recommended next steps');
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('open-guidance').click()]);
      await expect(popup.getByTestId('guidance-body')).toContainText('Tests to confirm or exclude');
      await expect(popup.getByTestId('guidance-body')).toContainText('Sources');
      await expect(popup.locator('body')).toContainText(REF);
      await popup.getByTestId('guidance-tab-leukemia').click();
      await expect(popup.getByRole('heading', { level: 1 })).toContainText('leukaemia');
      await expect(popup.getByTestId('guidance-urgency')).toContainText('Urgent');
      await popup.close();
    }
    await page.getByRole('combobox', { name: 'Confirmed condition' }).click();
    await page.getByRole('option', { name: 'Anemia' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByTestId('dataset-note')).toContainText(round === 0
      ? 'Added to the confirmed-case dataset'
      : 'already in the dataset, so it was not added again');
  }
});

test('doctor: voice dictation in mixed English-Urdu fills the symptom box and tags', async ({ page }) => {
  await signIn(page, 'doctor6@fedhealth.demo');
  await expect(page.getByTestId('dictation-language')).toContainText('mixed');
  await page.getByTestId('dictate').click();
  await expect(page.getByTestId('dictate')).toContainText('Stop');
  await page.waitForTimeout(1500);
  await page.getByTestId('dictate').click();
  await expect(page.getByTestId('dictation-note')).toContainText('Transcribed');
  await expect(page.locator('textarea').first()).toHaveValue(/fever/);
  await expect(page.getByText('bone pain', { exact: true })).toBeVisible();
});

test('admin: reaches every portal, manages any NGO, and the backup model takes over in a drill', async ({ page }) => {
  await signIn(page, 'admin@fedhealth.demo');
  await expect(page).toHaveURL(/\/admin$/);
  for (const link of ['Admin Console', 'Doctor Portal', 'Surveillance', 'Model Health', 'Lab Node', 'NGO Portal', 'Help Portal']) {
    await expect(page.getByRole('link', { name: link }).first()).toBeVisible();
  }
  await expect(page.getByTestId('admin-stats')).toContainText('awaiting verification');
  // Rejecting needs a reason.
  await page.getByTestId('account-row').filter({ hasText: 'Sehat Foundation' }).getByTestId('review-proof').click();
  await page.getByTestId('reject-proof').click();
  await expect(page.getByTestId('proof-dialog')).toContainText('Give the reason for rejecting');
  await page.getByLabel('Review note').fill('Certificate has expired.');
  await page.getByTestId('reject-proof').click();
  await page.getByTestId('filter-rejected').click();
  await expect(page.getByTestId('account-list')).toContainText('Certificate has expired.');

  // NGO portal: pick any NGO, post a request for it, set the verified badge.
  await page.getByRole('link', { name: 'NGO Portal' }).first().click();
  await expect(page.getByRole('heading', { name: 'NGO Portal' })).toBeVisible();
  await expect(page.getByTestId('admin-ngo-picker')).toContainText('Managing as administrator');
  await expect(page.locator('#ngo-name')).not.toHaveValue('');
  await page.getByRole('button', { name: /New request/ }).click();
  await page.fill('#req-title', 'O+ blood for transfusion day');
  await page.getByRole('button', { name: 'Post request' }).click();
  await expect(page.getByText('O+ blood for transfusion day')).toBeVisible();
  const badge = page.getByTestId('toggle-verified');
  const before = await badge.textContent();
  await badge.click();
  await expect(badge).not.toHaveText(before);

  // Failover drill: primary marked down, predictions continue on the backup model.
  await page.getByRole('link', { name: 'Admin Console' }).first().click();
  await expect(page.getByTestId('serving-state')).toContainText('Primary model is serving');
  await page.getByTestId('failover-drill').click();
  await expect(page.getByTestId('serving-state')).toContainText('Backup model is serving');
  await page.getByRole('link', { name: 'Doctor Portal' }).first().click();
  await page.fill('#patientRef', REF);
  await fillExampleReport(page);
  await page.getByRole('button', { name: 'Analyze CBC' }).click();
  await expect(page.getByTestId('backup-served')).toContainText('Scored by the backup model');
  await expect(page.getByTestId('confidence-scores')).toBeVisible();
  await page.getByRole('link', { name: 'Admin Console' }).first().click();
  await page.getByTestId('failover-drill').click();
  await expect(page.getByTestId('serving-state')).toContainText('Primary model is serving');
});

test('Model Health shows primary and backup model availability', async ({ page }) => {
  await signIn(page, 'officer7@nih.org.pk');
  await page.getByRole('link', { name: 'Model Health' }).click();
  const card = page.getByTestId('model-serving');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('serving-state')).toContainText('Primary model is serving');
  await expect(page.getByTestId('serving-primary')).toContainText('seed42');
  await expect(page.getByTestId('serving-primary')).toContainText('Available');
  await expect(page.getByTestId('serving-backup')).toContainText('seed52');
  await expect(page.getByTestId('serving-backup')).toContainText('Test accuracy 89.4%');
  await expect(page.getByTestId('serving-backup')).toContainText('Separate replica: ready');
  await expect(page.getByTestId('serving-usage')).toContainText('served by the backup');
  // Read-only here: the drill switch lives in the Admin Console.
  await expect(page.getByTestId('failover-drill')).toHaveCount(0);
});

test('Help Portal has a way back to the landing page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Help Portal' }).first().click();
  await expect(page).toHaveURL(/\/help$/);
  await page.getByTestId('help-home').click();
  await expect(page.getByTestId('landing')).toBeVisible();
  // Also from an NGO profile page.
  await page.goto('/help');
  await page.getByRole('tab', { name: 'NGO directory' }).click();
  await page.getByRole('link', { name: /View profile/ }).first().click();
  await expect(page).toHaveURL(/\/help\/ngos\//);
  await page.getByTestId('help-home').click();
  await expect(page.getByTestId('landing')).toBeVisible();
});
