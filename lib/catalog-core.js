// Framework-neutral publish pipeline for the public catalog. Both the Vercel
// handler (api/publish.js) and the Netlify function call runPublish and
// adapt its { status, body } result to their platform's response shape.
//
// Flow:
//  1. Validate the scan (notReadable / low confidence / no name → drop).
//  2. Compute a normalised product_key from brand + name.
//  3. Look up existing rows with that product_key.
//  4. If none → insert directly.
//  5. If some → ask Gemini whether the new scan is the same regional variant
//     (and, if so, whether it's a better card than what's stored). Apply the
//     decision: merge_into / increment / insert_new.

import { makeSupabase } from './supabase.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const TABLE = 'catalog_scans';
const BUCKET = 'catalog-thumbnails';
const MAX_DEDUP_CANDIDATES = 10;
const MIN_CONFIDENCE = 'medium'; // accept medium or high; "low" / unset → drop

export async function runPublish({
  result, thumbnailBase64, supabaseUrl, supabaseServiceKey, geminiApiKey, publicAppUrl
}) {
  if (!result || typeof result !== 'object') {
    return { status: 400, body: { error: 'Missing scan result.' } };
  }
  if (result.notReadable) {
    return { status: 200, body: { action: 'skipped', reason: 'notReadable' } };
  }
  if (!confidenceOk(result.confidence)) {
    return { status: 200, body: { action: 'skipped', reason: 'low_confidence' } };
  }
  const productName = String(result.productName || '').trim();
  if (!productName) {
    return { status: 200, body: { action: 'skipped', reason: 'no_product_name' } };
  }

  let sb;
  try {
    sb = makeSupabase({ url: supabaseUrl, serviceKey: supabaseServiceKey });
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }

  const productKey = normaliseKey(result.brand, productName);

  try {
    const candidates = await sb.select(TABLE, {
      product_key: `eq.${productKey}`,
      select: 'id,region,product_name,brand,nutri_score,confidence,ingredients,scan_count',
      order: 'scan_count.desc',
      limit: String(MAX_DEDUP_CANDIDATES)
    });

    let decision;
    if (!candidates || candidates.length === 0) {
      decision = { decision: 'insert_new', match_id: null, region: null, reason: 'no_existing' };
    } else {
      decision = await decideWithGemini({
        candidate: compactScan(result),
        existing: candidates.map(compactRow),
        geminiApiKey,
        publicAppUrl
      });
    }

    return await applyDecision({
      sb, decision, result, productKey, thumbnailBase64, candidates: candidates || []
    });
  } catch (err) {
    console.error('Publish error:', err);
    return { status: 500, body: { error: err.message || 'Publish failed.' } };
  }
}

async function applyDecision({ sb, decision, result, productKey, thumbnailBase64, candidates }) {
  const action = decision?.decision || 'insert_new';
  const match = decision?.match_id
    ? candidates.find((c) => c.id === decision.match_id)
    : null;

  if (action === 'increment' && match) {
    await sb.update(TABLE, { id: `eq.${match.id}` }, {
      scan_count: (match.scan_count || 1) + 1
    });
    return { status: 200, body: { action: 'incremented', id: match.id } };
  }

  if (action === 'merge_into' && match) {
    const path = thumbnailBase64
      ? await safeUploadThumb(sb, match.id, thumbnailBase64)
      : null;
    const patch = toRow(result, productKey, decision.region || match.region);
    patch.scan_count = (match.scan_count || 1) + 1;
    if (path) patch.thumbnail_path = path;
    await sb.update(TABLE, { id: `eq.${match.id}` }, patch);
    return { status: 200, body: { action: 'merged', id: match.id } };
  }

  // insert_new — also the fallback if Gemini answered something unexpected.
  const row = toRow(result, productKey, decision?.region || null);
  const inserted = await sb.insert(TABLE, row);
  const id = inserted?.[0]?.id;
  if (id && thumbnailBase64) {
    const path = await safeUploadThumb(sb, id, thumbnailBase64);
    if (path) await sb.update(TABLE, { id: `eq.${id}` }, { thumbnail_path: path });
  }
  return { status: 200, body: { action: 'inserted', id } };
}

async function safeUploadThumb(sb, id, base64) {
  try {
    return await sb.uploadThumbnail(BUCKET, `${id}.jpg`, base64);
  } catch (err) {
    console.warn('Thumbnail upload failed:', err.message);
    return null;
  }
}

function toRow(result, productKey, region) {
  return {
    product_key: productKey,
    region,
    product_name: String(result.productName || '').trim(),
    brand: result.brand ? String(result.brand).trim() : null,
    category: result.category ? String(result.category).trim() : null,
    nutri_score: /^[A-E]$/.test(result.nutriScore) ? result.nutriScore : 'C',
    health_score: numOrNull(result.healthScore),
    summary: result.summary || null,
    ingredients: Array.isArray(result.ingredients) ? result.ingredients : [],
    e_numbers: Array.isArray(result.eNumbers) ? result.eNumbers : [],
    red_flags: Array.isArray(result.redFlags) ? result.redFlags : [],
    nutrition: result.nutrition || null,
    allergens: Array.isArray(result.allergens) ? result.allergens : [],
    confidence: result.confidence || 'medium'
  };
}

function compactScan(r) {
  return {
    product_name: r.productName,
    brand: r.brand || null,
    nutri_score: r.nutriScore,
    confidence: r.confidence,
    top_ingredients: (r.ingredients || []).slice(0, 8),
    e_numbers: (r.eNumbers || []).map((e) => e.code).filter(Boolean).slice(0, 8)
  };
}

function compactRow(row) {
  return {
    id: row.id,
    region: row.region,
    product_name: row.product_name,
    brand: row.brand,
    nutri_score: row.nutri_score,
    confidence: row.confidence,
    top_ingredients: Array.isArray(row.ingredients) ? row.ingredients.slice(0, 8) : [],
    scan_count: row.scan_count
  };
}

const DEDUP_PROMPT = `You are deduplicating user-submitted food product scans for a public catalog.
You are given ONE candidate scan and a small list of existing catalog rows that share the same normalised product key.
Decide which of these three applies:

- "merge_into": same product, same regional recipe as one existing row, AND the candidate is clearly a better card (higher confidence, more complete ingredient list, valid NutriScore). Return that row's id.
- "increment": same product and same regional recipe as one existing row, but the existing row is equal or better quality. Return that row's id; the catalog will just bump its scan count.
- "insert_new": the candidate is a different regional variant (e.g. EU vs US recipe — different sweeteners, additives, oils) OR a genuinely different product that just shares a name. Return null for match_id.

When you choose "insert_new" because of a regional variant, set "region" to a short ISO-style hint if obvious from the ingredients (e.g. "EU", "US", "UK", "FR"). Otherwise leave region null.

Respond ONLY with JSON of this shape:
{ "decision": "merge_into" | "increment" | "insert_new", "match_id": "<uuid or null>", "region": "<short string or null>", "reason": "<one short sentence>" }`;

async function decideWithGemini({ candidate, existing, geminiApiKey, publicAppUrl }) {
  if (!geminiApiKey) {
    // No key configured — safest fallback is to insert as new variant.
    return { decision: 'insert_new', match_id: null, region: null, reason: 'no_gemini_key' };
  }

  const body = {
    contents: [{
      parts: [
        { text: DEDUP_PROMPT },
        { text: 'CANDIDATE:\n' + JSON.stringify(candidate, null, 2) },
        { text: 'EXISTING:\n' + JSON.stringify(existing, null, 2) }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0
    }
  };

  try {
    const res = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: publicAppUrl || 'https://foolab.vercel.app'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('Gemini dedup error', res.status, data?.error?.message);
      return { decision: 'insert_new', match_id: null, region: null, reason: 'gemini_error' };
    }
    const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!['merge_into', 'increment', 'insert_new'].includes(parsed.decision)) {
      return { decision: 'insert_new', match_id: null, region: null, reason: 'bad_decision' };
    }
    return parsed;
  } catch (err) {
    console.warn('Gemini dedup failed:', err.message);
    return { decision: 'insert_new', match_id: null, region: null, reason: 'exception' };
  }
}

function normaliseKey(brand, name) {
  const s = `${brand || ''} ${name}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return s.slice(0, 120);
}

function confidenceOk(c) {
  return c === 'medium' || c === 'high';
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
