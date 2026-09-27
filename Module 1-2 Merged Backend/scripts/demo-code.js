#!/usr/bin/env node
// backend/scripts/demo-code.js
// Print the current 6-digit sign-in code for the demo accounts created by
// scripts/create-demo-users.js (reads the git-ignored run-results/demo-accounts.txt).
//
//   node scripts/demo-code.js            # all demo accounts
//   node scripts/demo-code.js doctor     # one account: doctor | nih | admin
const fs = require('fs');
const path = require('path');
const speakeasy = require('speakeasy'); // TOTP (RFC 6238) library: computes the current 6-digit code

const FILE = path.resolve(__dirname, '../../run-results/demo-accounts.txt');
if (!fs.existsSync(FILE)) {
  console.error('No demo accounts yet. Run: npm run demo:users');
  process.exit(1);
}
const only = process.argv[2];
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
for (const line of fs.readFileSync(FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^(\w+)\s+(\S+@\S+)\s+password:\s+\S+\s+mfa-key:\s+([A-Z2-7]+)$/);
  if (!m || (only && m[1] !== only)) continue;
  console.log(`${m[1].padEnd(7)} ${m[2].padEnd(28)} code: ${speakeasy.totp({ secret: m[3], encoding: 'base32' })}`);
}
console.log(`(valid for about ${left} more seconds)`);
