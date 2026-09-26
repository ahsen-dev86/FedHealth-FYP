// Shared Playwright helpers. Text assertions only: no screenshots, video or traces.
import crypto from 'node:crypto';
import { expect } from '@playwright/test';

export const EXAMPLE = { WBC: '9,010', RBC: '4.47', HGB: '12.4', HCT: '38', MCV: '85', MCH: '28', MCHC: '33', RDW: '13', PLT: '147,000', NEUTp: '69' };
// Unit option values of the CBC form (see tools/export_contract.py UNIT_OPTIONS).
export const EXAMPLE_UNITS = { WBC: '/mm3', RBC: 'mil/mm3', HGB: 'g/dL', HCT: '%', MCV: 'fL', MCH: 'pg', MCHC: 'g/dL', RDW: '%', PLT: '/mm3', NEUTp: '%' };
export const OLD_LABELS = /iron deficiency anemia|thrombocytopenia|beta-thalassemia trait|macrocytic anemia|CBC-Net/i;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(text) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of text.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as the backend's speakeasy and the mock use. */
export function totp(secretBase32, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

/** On the MFA setup page: read the manual key, enter the current code, continue. */
export async function completeMfaSetup(page) {
  const key = page.locator('p:has-text("Enter this key manually") + div');
  await expect(key).toBeVisible();
  const secret = (await key.textContent()).replace(/\s/g, '');
  await page.fill('#mfa-code', totp(secret));
  await page.getByRole('button', { name: /Activate & continue/ }).click();
  return secret;
}

export async function fillExampleReport(page, values = EXAMPLE, units = EXAMPLE_UNITS) {
  for (const [f, v] of Object.entries(values)) {
    await page.fill(`#cbc-${f}`, v);
    await page.selectOption(`[data-testid="unit-${f}"]`, units[f]);
  }
}
