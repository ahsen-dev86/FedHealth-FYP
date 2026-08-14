// backend/src/services/nlp.js
// ---------------------------------------------------------------------------
// Module 6.2.1 — multilingual symptom intake (English / Urdu / Roman-Urdu).
//
// Pragmatic approach (per project guidance): a keyword/synonym lexicon that maps
// free text to canonical symptom tags relevant to anemia / thalassemia /
// leukemia. No custom transformer and no external translation API (which would
// need network + keys). Trade-off: it catches listed phrasings, not arbitrary
// paraphrase — noted for the supervisor. A translation step or a small intent
// model is the future upgrade.
//
// IMPORTANT: symptoms are decision-support CONTEXT shown to the doctor and
// stored on the report; they are NOT model inputs (the CBC model is CBC-only).
// ---------------------------------------------------------------------------

// canonical_tag -> { en:[...], ur:[...unicode...], roman:[...] }
const SYMPTOM_LEXICON = {
  fatigue:        { en: ['fatigue', 'tired', 'tiredness', 'exhausted', 'lethargy', 'no energy'],
                    ur: ['تھکن', 'تھکاوٹ', 'سستی'], roman: ['thakan', 'thakawat', 'thaka', 'susti'] },
  weakness:       { en: ['weak', 'weakness'], ur: ['کمزوری', 'کمزور'], roman: ['kamzori', 'kamzor'] },
  pallor:         { en: ['pale', 'pallor', 'paleness'], ur: ['پیلا', 'زردی', 'پیلاہٹ'], roman: ['peela', 'peelapan', 'zardi'] },
  breathlessness: { en: ['breathless', 'shortness of breath', 'short of breath', 'dyspnea', 'difficulty breathing'],
                    ur: ['سانس پھولنا', 'سانس کی تنگی'], roman: ['saans phoolna', 'saans ki tangi', 'saans'] },
  dizziness:      { en: ['dizzy', 'dizziness', 'lightheaded', 'vertigo'], ur: ['چکر', 'سر چکرانا'], roman: ['chakkar'] },
  palpitations:   { en: ['palpitation', 'heart racing', 'fast heartbeat'], ur: ['دھڑکن', 'دل کی دھڑکن'], roman: ['dharkan'] },
  jaundice:       { en: ['jaundice', 'yellow eyes', 'yellow skin'], ur: ['یرقان', 'پیلی آنکھیں'], roman: ['yarkan', 'yarqan'] },
  bruising:       { en: ['bruise', 'bruising', 'easy bruising'], ur: ['نیل', 'خراش'], roman: ['neel'] },
  bleeding:       { en: ['bleeding', 'nosebleed', 'gum bleeding', 'blood in'], ur: ['خون بہنا', 'ناک سے خون'], roman: ['khoon behna', 'naak se khoon'] },
  fever:          { en: ['fever', 'febrile', 'high temperature'], ur: ['بخار'], roman: ['bukhar', 'bukhaar'] },
  bone_pain:      { en: ['bone pain', 'joint pain', 'body ache', 'body pain'], ur: ['ہڈیوں میں درد', 'جوڑوں کا درد'], roman: ['haddi dard', 'joron ka dard', 'jism dard'] },
  weight_loss:    { en: ['weight loss', 'losing weight', 'lost weight'], ur: ['وزن کم', 'وزن میں کمی'], roman: ['wazan kam'] },
  night_sweats:   { en: ['night sweat', 'sweating at night'], ur: ['رات کو پسینہ'], roman: ['raat ko paseena', 'raat paseena'] },
  recurrent_infections: { en: ['recurrent infection', 'frequent infection', 'frequent illness', 'keep getting sick'],
                    ur: ['بار بار انفیکشن', 'بار بار بیمار'], roman: ['baar baar infection', 'baar baar bimar'] },
  poor_appetite:  { en: ['loss of appetite', 'poor appetite', 'no appetite'], ur: ['بھوک کی کمی', 'بھوک نہیں'], roman: ['bhook ki kami', 'bhook nahi'] },
  abdominal_fullness: { en: ['abdominal fullness', 'swollen abdomen', 'stomach swelling', 'enlarged spleen'],
                    ur: ['پیٹ میں سوجن', 'تلی بڑھنا'], roman: ['pet sujan', 'pet mein sujan', 'tilli'] },
};

function hasUrdu(text) {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Parse free-text symptoms (any of English / Urdu / Roman-Urdu).
 * @returns {
 *   language: 'en' | 'ur' | 'mixed',
 *   symptoms: [{ tag, matched }],   // canonical tags found
 *   tags: [string],                 // convenience list of tag names
 *   raw: string
 * }
 */
function parseSymptoms(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const urdu = hasUrdu(raw);
  const roman = /[a-z]/i.test(raw);
  const language = urdu && roman ? 'mixed' : urdu ? 'ur' : 'en';

  const found = [];
  for (const [tag, langs] of Object.entries(SYMPTOM_LEXICON)) {
    let matched = null;
    for (const kw of langs.en) if (lower.includes(kw)) { matched = kw; break; }
    if (!matched) for (const kw of langs.roman) if (lower.includes(kw)) { matched = kw; break; }
    if (!matched) for (const kw of langs.ur) if (raw.includes(kw)) { matched = kw; break; }
    if (matched) found.push({ tag, matched });
  }

  return { language, symptoms: found, tags: found.map((s) => s.tag), raw };
}

module.exports = { parseSymptoms, SYMPTOM_LEXICON };
