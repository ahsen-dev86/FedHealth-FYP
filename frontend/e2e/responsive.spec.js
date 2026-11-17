// Responsive checks (mock mode): every page must fit a phone and a tablet with
// no horizontal page scroll, and its primary controls must be large enough to
// tap. Run with the mock project: npx playwright test --project=mock
import { test, expect } from '@playwright/test';
import { completeMfaSetup, fillExampleReport } from './helpers.js';

const SIZES = [
  { name: 'small phone', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
];

async function signIn(page, email) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', 'mock-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await completeMfaSetup(page);
}

// Elements wider than the viewport (the usual cause of sideways scrolling).
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // The signed-in shell scrolls inside its own container, so measure that as well as the page.
    const shell = document.querySelector('[data-testid="page-scroll"]');
    const shellExtra = shell ? shell.scrollWidth - shell.clientWidth : 0;
    const limit = shell && shellExtra > 1 ? shell.getBoundingClientRect().right : doc.clientWidth;
    const extra = Math.max(doc.scrollWidth - doc.clientWidth, shellExtra);
    if (extra <= 1) return null;
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= limit + 1) return false;
        // Content inside its own horizontal scroller (a table wrapper) is fine.
        for (let p = el.parentElement; p && p !== document.body && p !== shell; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return false;
        }
        return true;
      })
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (${Math.round(el.getBoundingClientRect().right)}px)`);
    return `${extra}px wider than the screen: ${wide.join(' | ')}`;
  });
}

async function checkAt(page, label) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(250);
    expect(await overflow(page), `${label} at ${size.name} (${size.width}px)`).toBeNull();
  }
}

test('public pages fit a phone and a tablet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing')).toBeVisible();
  await checkAt(page, 'landing');
  await page.goto('/login?role=doctor');
  await checkAt(page, 'sign in');
  await page.getByRole('button', { name: 'Register' }).click();
  await checkAt(page, 'register');
  await page.goto('/help');
  await expect(page.getByRole('tab', { name: 'NGO directory' })).toBeVisible();
  await checkAt(page, 'help portal');
  await page.getByRole('tab', { name: 'NGO directory' }).click();
  await checkAt(page, 'help portal directory');
});

test('doctor portal, result with explanation, and the guidance window fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'doctor7@fedhealth.demo');
  await expect(page.getByRole('heading', { name: 'Doctor Portal' })).toBeVisible();
  await checkAt(page, 'doctor portal (empty)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill('#patientRef', 'FH-0000-0000');
  await fillExampleReport(page);
  await page.getByRole('button', { name: 'Analyze CBC' }).click();
  await expect(page.getByTestId('explanation-panel')).toBeVisible();
  await checkAt(page, 'doctor portal (result, why tab)');
  await page.getByTestId('xai-tab-values').click();
  await checkAt(page, 'doctor portal (result, values tab)');
  // The primary action is comfortably tappable on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.getByRole('button', { name: 'Analyze CBC' }).boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(32);
  await page.goto('/recommendations/leukemia?ref=FH-0000-0000&top=leukemia&score=0.7');
  await expect(page.getByTestId('guidance-body')).toBeVisible();
  await checkAt(page, 'guidance window');
});

test('surveillance and model health fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'officer9@nih.org.pk');
  await expect(page.getByRole('heading', { name: 'Surveillance Dashboard' })).toBeVisible();
  await checkAt(page, 'surveillance');
  await page.goto('/model-health');
  await expect(page.getByRole('heading', { name: 'AI Model Health' })).toBeVisible();
  await expect(page.getByTestId('model-card')).toBeVisible();
  await checkAt(page, 'model health');
});

test('lab node and NGO pages fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'engineer9@lab.fedhealth.demo');
  await expect(page.getByTestId('lab-name')).toBeVisible();
  await checkAt(page, 'lab node');
});

test('NGO dashboard fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'contact9@testngo.org');
  await expect(page.getByRole('heading', { name: 'My NGO' })).toBeVisible();
  await checkAt(page, 'my NGO');
});

test('admin console and the admin NGO portal fit a phone; the sidebar opens as a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin9@fedhealth.demo');
  await expect(page.getByRole('heading', { name: 'Admin Console' })).toBeVisible();
  await expect(page.getByTestId('account-row').first()).toBeVisible();
  await checkAt(page, 'admin console');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('account-row').first().getByTestId('review-proof').click();
  await expect(page.getByTestId('proof-dialog')).toBeVisible();
  expect(await overflow(page), 'proof dialog').toBeNull();
  await page.keyboard.press('Escape');
  // Navigation on a phone: the sidebar is a drawer behind the menu button.
  await page.getByRole('button', { name: /Toggle Sidebar/i }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('NGO Portal')).toBeVisible();
  await drawer.getByText('NGO Portal').click();
  await expect(page.getByRole('heading', { name: 'NGO Portal' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // the drawer closed after navigating
  await checkAt(page, 'admin NGO portal');
});

test('Model Health live federated tab fits a phone, before and during a run', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin8@fedhealth.demo');
  // Navigate inside the app (the mock keeps its state in memory).
  await page.getByRole('button', { name: /Toggle Sidebar/i }).click();
  await page.getByRole('dialog').getByText('Model Health').click();
  await page.getByTestId('mh-tab-live').click();
  await expect(page.getByTestId('fl-controls')).toBeVisible();
  await checkAt(page, 'live federation (controls)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('fl-rounds').selectOption('1');
  await page.getByTestId('fl-start').click();
  await expect(page.getByTestId('fl-lab-lab-04')).toBeVisible({ timeout: 15000 });
  await checkAt(page, 'live federation (running)');
});
