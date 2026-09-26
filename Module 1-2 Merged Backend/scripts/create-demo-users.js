#!/usr/bin/env node
// backend/scripts/create-demo-users.js
// ---------------------------------------------------------------------------
// Creates ready-to-use demo accounts for a local demonstration, with MFA
// already enrolled, and writes their credentials to the git-ignored file
// run-results/demo-accounts.txt (never commit or share it):
//   doctor   doctor.demo@fedhealth.test   Doctor Portal
//   nih      nih.demo@nih.org.pk          Surveillance + Model Health
//   admin    admin.demo@fedhealth.test    everything, incl. audit log
// Passwords and TOTP keys are random. Sign-in codes: `npm run demo:code`, or
// add the key to an authenticator app (Google/Microsoft Authenticator).
//
//   node scripts/create-demo-users.js           # create missing accounts (keeps existing)
//   node scripts/create-demo-users.js --reset   # new password + MFA key for all demo accounts
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const Users = require('../src/models/users');
const Roles = require('../src/models/roles');
const password = require('../src/auth/password');
const { pool } = require('../src/db/pool');

const OUT = path.resolve(__dirname, '../../run-results/demo-accounts.txt');
const ACCOUNTS = [
  { key: 'doctor', email: 'doctor.demo@fedhealth.test', name: 'Dr Demo Doctor', role: 'doctor', org: 'Demo Clinic' },
  { key: 'nih', email: 'nih.demo@nih.org.pk', name: 'Demo Health Official', role: 'nih_official', org: 'NIH (demo)' },
  { key: 'admin', email: 'admin.demo@fedhealth.test', name: 'Demo Admin', role: 'admin', org: 'FedHealth' },
];

function readSaved() {
  if (!fs.existsSync(OUT)) return {};
  const saved = {};
  for (const line of fs.readFileSync(OUT, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s+(\S+@\S+)\s+password:\s+(\S+)\s+mfa-key:\s+([A-Z2-7]+)$/);
    if (m) saved[m[1]] = { email: m[2], password: m[3], secret: m[4] };
  }
  return saved;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const saved = readSaved();
  const lines = [];
  for (const a of ACCOUNTS) {
    let user = await Users.findByEmail(a.email);
    if (user && !reset) {
      if (!saved[a.key]) {
        console.log(`${a.key}: ${a.email} exists but its credentials are not in ${path.basename(OUT)}; rerun with --reset`);
        continue;
      }
      lines.push({ ...a, ...saved[a.key] });
      console.log(`${a.key}: ${a.email} already set up`);
      continue;
    }
    const pw = `Demo-${crypto.randomBytes(9).toString('base64url')}`;
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const hash = await password.hash(pw);
    if (!user) {
      const role = await Roles.getByName(a.role);
      user = await Users.create({ email: a.email, fullName: a.name, roleId: role.id, organization: a.org, passwordHash: hash });
    } else {
      await Users.setPasswordHash(user.id, hash);
    }
    await Users.setMfaSecret(user.id, secret);
    await Users.confirmMfa(user.id);
    await Users.setStatus(user.id, 'active');
    await Users.resetFailedLogins(user.id);
    lines.push({ ...a, password: pw, secret });
    console.log(`${a.key}: ${a.email} ${reset ? 'reset' : 'created'}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, [
    'FedHealth demo accounts (local only; git-ignored; do not share).',
    'Sign in at http://localhost:5173 with email + password, then the 6-digit code from',
    '`npm run demo:code` (in "Module 1-2 Merged Backend") or from an authenticator app',
    'where you added the mfa-key (Google/Microsoft Authenticator: "enter a setup key").',
    '',
    ...lines.map((l) => `${l.key.padEnd(7)} ${l.email.padEnd(28)} password: ${l.password}  mfa-key: ${l.secret}`),
    '',
  ].join('\n'), { mode: 0o600 });
  console.log(`credentials written to ${path.relative(path.resolve(__dirname, '../..'), OUT)}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
