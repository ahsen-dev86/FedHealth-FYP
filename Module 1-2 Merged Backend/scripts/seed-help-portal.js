#!/usr/bin/env node
// backend/scripts/seed-help-portal.js
// ---------------------------------------------------------------------------
// Fills the public Help Portal with SAMPLE NGOs and supply requests so it can
// be demonstrated (the database starts empty). Every organisation is fictional:
// its description starts with "Sample listing", it is not marked verified, and
// websites/emails use example domains. Each NGO gets a login-less `ngo` user
// (no password), so nobody can sign in as it.
//
// Idempotent: an NGO that already exists is left as it is, and requests are
// only added to sample NGOs that have none yet.
//
//   node scripts/seed-help-portal.js
// ---------------------------------------------------------------------------
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const Users = require('../src/models/users');
const Roles = require('../src/models/roles');
const SupplyRequests = require('../src/models/supplyRequests');
const { query, pool } = require('../src/db/pool');

const SAMPLE = 'Sample listing for demonstration; not a real organisation.';
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const NGOS = [
  {
    slug: 'roshni', name: 'Roshni Thalassemia Care (sample)', district: 'Lahore', province: 'Punjab',
    mission: 'Free blood transfusions and iron-chelation support for thalassemia major patients.',
    description: 'Runs a dedicated transfusion ward and subsidises chelation therapy for registered children across Punjab.',
    website: 'https://roshni.example.org', phone: '+92 300 0000001',
    donation: { bank: 'Sample Bank - 0000-0000-0001 (sample account)', jazzcash: '0300-0000001' },
    requests: [
      { category: 'blood', bloodGroup: 'O-', title: 'O- units needed for the transfusion ward', quantity: '15 units', urgency: 'critical', neededBy: 3 },
      { category: 'medicine', title: 'Deferasirox (iron chelation) stock running low', quantity: '200 tablets', urgency: 'high', neededBy: 10 },
    ],
  },
  {
    slug: 'sindh-blood', name: 'Sindh Blood Relief Network (sample)', district: 'Karachi', province: 'Sindh',
    mission: 'Mobile blood donation drives and an emergency donor registry across Sindh.',
    description: 'A donor-matching hotline plus monthly donation camps in Karachi, Hyderabad and Sukkur.',
    website: 'https://sindh-blood.example.org', phone: '+92 321 0000002',
    donation: { bank: 'Sample Bank - 0000-0000-0002 (sample account)', easypaisa: '0321-0000002' },
    requests: [
      { category: 'blood', bloodGroup: 'B+', title: 'Weekly B+ donor shortfall', quantity: '8 units', urgency: 'high', neededBy: 7 },
      { category: 'equipment', title: 'Centrifuge for blood component separation', quantity: '1 unit', urgency: 'low', neededBy: 45 },
    ],
  },
  {
    slug: 'kpk-anemia', name: 'KPK Anemia & Nutrition Alliance (sample)', district: 'Peshawar', province: 'KPK',
    mission: 'Iron-deficiency screening and micronutrient supplementation for women and children.',
    description: 'School and clinic screening programmes with iron-folate supplements in underserved districts.',
    website: 'https://kpk-anemia.example.org', phone: '+92 333 0000003',
    donation: { easypaisa: '0333-0000003' },
    requests: [
      { category: 'medicine', title: 'Folic acid and iron supplements for a screening camp', quantity: '1000 packs', urgency: 'medium', neededBy: 21 },
      { category: 'equipment', title: 'Portable haemoglobinometers for field screening', quantity: '4 units', urgency: 'medium', neededBy: 30 },
    ],
  },
  {
    slug: 'hope-leukemia', name: 'Hope for Leukemia Children (sample)', district: 'Islamabad', province: 'Islamabad',
    mission: 'Helps low-income families with diagnostic and chemotherapy costs for children with leukemia.',
    description: 'Partners with tertiary hospitals to fast-track diagnosis and funds a small family lodging facility.',
    website: 'https://hope-leukemia.example.org', phone: '+92 345 0000004',
    donation: { bank: 'Sample Bank - 0000-0000-0004 (sample account)' },
    requests: [
      { category: 'funds', title: 'Chemotherapy cost support for this quarter', quantity: 'PKR 850,000', urgency: 'high', neededBy: 14 },
      { category: 'blood', bloodGroup: 'A+', title: 'Platelet donors for children in treatment', quantity: '6 donors', urgency: 'critical', neededBy: 2 },
    ],
  },
  {
    slug: 'balochistan-health', name: 'Balochistan Rural Health Circle (sample)', district: 'Quetta', province: 'Balochistan',
    mission: 'Basic haematology testing and referral transport for remote districts.',
    description: 'A volunteer-run mobile lab van covering Quetta and surrounding rural union councils.',
    website: '', phone: '+92 331 0000005',
    donation: { jazzcash: '0331-0000005' },
    requests: [
      { category: 'funds', title: 'Mobile lab van fuel and maintenance', quantity: 'PKR 120,000', urgency: 'medium', neededBy: 20 },
      { category: 'other', title: 'Volunteer drivers for referral transport', quantity: '3 volunteers', urgency: 'low', neededBy: 40 },
    ],
  },
];

async function main() {
  const role = await Roles.getByName('ngo');
  if (!role) throw new Error('No "ngo" role: apply init/007_help_portal.sql first (node scripts/db-setup.js)');
  let createdNgos = 0;
  let createdRequests = 0;
  for (const n of NGOS) {
    const email = `ngo-${n.slug}@sample.fedhealth.test`;
    let user = await Users.findByEmail(email);
    if (!user) user = await Users.create({ email, fullName: n.name, roleId: role.id, organization: n.name });
    let { rows: [ngo] } = await query('SELECT id FROM ngos WHERE user_id = $1', [user.id]);
    if (!ngo) {
      ({ rows: [ngo] } = await query(
        `INSERT INTO ngos (user_id, name, mission, description, website, contact_email, contact_phone,
                           district, province, donation_info, verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE) RETURNING id`,
        [user.id, n.name, n.mission, `${SAMPLE} ${n.description}`, n.website || null,
          `contact@${n.slug}.example.org`, n.phone, n.district, n.province, JSON.stringify(n.donation)]));
      createdNgos += 1;
    }
    const { rows: [{ count }] } = await query('SELECT count(*)::int AS count FROM supply_requests WHERE ngo_id = $1', [ngo.id]);
    if (count === 0) {
      for (const r of n.requests) {
        await SupplyRequests.create(ngo.id, {
          ...r, neededBy: inDays(r.neededBy), district: n.district, province: n.province,
          description: `${SAMPLE} Contact the organisation through its profile before donating.`,
        });
        createdRequests += 1;
      }
    }
  }
  console.log(`[seed-help-portal] sample NGOs created: ${createdNgos}; sample requests created: ${createdRequests}`
    + ` (existing ones left unchanged)`);
}

main().catch((e) => { console.error(`[seed-help-portal] ${e.message}`); process.exitCode = 1; }).finally(() => pool.end());
