// Minimal smoke test: the app boots and serves the login page (real client,
// see playwright.config.js "smoke" project). @playwright/test drives a real
// browser and provides test/expect.
import { test, expect } from '@playwright/test';

test('app loads and shows the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/FedHealth/);
});
