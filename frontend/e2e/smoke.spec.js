import { test, expect } from '@playwright/test';

test('app loads and shows the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/FedHealth/);
});
