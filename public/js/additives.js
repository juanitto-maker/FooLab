// Client-side helpers for the additive traffic light, chronic-condition
// warnings, and read-more E-number details. Pure functions + a tiny cached
// fetch of /data/enumbers.json — no API calls, no storage.

let _dbPromise = null;
let _dbIndex = null;

export async function loadEnumbersDB() {
  if (_dbIndex) return _dbIndex;
  if (!_dbPromise) {
    _dbPromise = fetch('/data/enumbers.json')
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        const index = { byCode: new Map(), conditions: {}, raw: json };
        if (json?.additives) {
          for (const item of json.additives) {
            if (item.code) index.byCode.set(normalizeCode(item.code), item);
          }
        }
        if (json?.conditions) index.conditions = json.conditions;
        _dbIndex = index;
        return index;
      })
      .catch(() => {
        _dbIndex = { byCode: new Map(), conditions: {}, raw: null };
        return _dbIndex;
      });
  }
  return _dbPromise;
}

export function lookupAdditive(db, code) {
  if (!db || !code) return null;
  return db.byCode.get(normalizeCode(code)) || null;
}

function normalizeCode(code) {
  return String(code).trim().toUpperCase().replace(/\s+/g, '');
}

// Traffic-light rating of the additive LOAD of a product. Deliberately
// independent of NutriScore — a product can be nutritionally poor but
// additive-clean (e.g. butter), or nutritionally fine but additive-heavy
// (e.g. diet soda).
//
// red    — at least one high-concern additive, or a Southampton-six color,
//          or trans fat, or titanium dioxide
// yellow — any medium-concern additive, or ultraProcessed flag,
//          or 4+ additives regardless of concern
// green  — otherwise (including: no additives, or only low-concern ones)
export function computeAdditiveRating(result, db = null) {
  if (!result || result.notReadable) return null;

  const eNumbers = Array.isArray(result.eNumbers) ? result.eNumbers : [];
  const redFlags = Array.isArray(result.redFlags) ? result.redFlags : [];

  const hasConcern = (level) =>
    eNumbers.some((e) => (e.concern || '').toLowerCase() === level) ||
    (db && eNumbers.some((e) => {
      const ref = lookupAdditive(db, e.code);
      return ref && ref.concern === level;
    }));

  const hasHighFlag = redFlags.some((f) =>
    (f.severity || '').toLowerCase() === 'high' &&
    ['artificialColor', 'transFat', 'bhaBht'].includes(f.type)
  );

  const hasUltraProcessed = redFlags.some((f) => f.type === 'ultraProcessed');

  if (hasConcern('high') || hasHighFlag) {
    return {
      level: 'red',
      label: 'High additive load',
      detail: 'Contains additives rated as higher-risk. Best treated as an occasional product.'
    };
  }
  if (hasConcern('medium') || hasUltraProcessed || eNumbers.length >= 4) {
    return {
      level: 'yellow',
      label: 'Moderate additive load',
      detail: eNumbers.length >= 4
        ? 'Four or more additives — fine occasionally, not ideal as a daily staple.'
        : 'Contains additives that are tolerated but worth not eating daily.'
    };
  }
  return {
    level: 'green',
    label: 'Clean additive profile',
    detail: eNumbers.length === 0
      ? 'No additives flagged.'
      : 'Only low-concern additives detected.'
  };
}

// Condition-specific warnings derived entirely from fields already in the
// scan result (+ the enumbers DB for per-additive condition tags). No user
// profile required — these are information chips the user can read and
// decide what applies to them.
export function getConditionWarnings(result, db = null) {
  if (!result || result.notReadable) return [];

  const nutrition = result.nutrition || {};
  const redFlags = Array.isArray(result.redFlags) ? result.redFlags : [];
  const eNumbers = Array.isArray(result.eNumbers) ? result.eNumbers : [];
  const allergens = Array.isArray(result.allergens) ? result.allergens : [];
  const ingredients = (Array.isArray(result.ingredients) ? result.ingredients : [])
    .join(' ').toLowerCase();

  const warnings = [];
  const add = (key, label, severity, reason) => {
    warnings.push({ key, label, severity, reason });
  };

  // Diabetes
  const sugar = numOrNull(nutrition.sugar);
  if (hasFlag(redFlags, 'highSugar')) {
    const sev = severityOf(redFlags, 'highSugar');
    add('diabetes', 'Diabetes', sev,
      sugar != null ? `${round1(sugar)} g sugar per 100 ${nutrition.per === '100ml' ? 'ml' : 'g'} — impacts blood sugar.`
                    : 'High sugar content — impacts blood sugar.');
  } else if (sugar != null && sugar >= 10) {
    add('diabetes', 'Diabetes', 'medium', `${round1(sugar)} g sugar per 100 g — moderate blood-sugar impact.`);
  }

  // Hypertension
  const salt = numOrNull(nutrition.salt);
  if (hasFlag(redFlags, 'highSalt')) {
    const sev = severityOf(redFlags, 'highSalt');
    add('hypertension', 'High blood pressure', sev,
      salt != null ? `${round1(salt)} g salt per 100 g — contributes significantly to daily sodium.`
                   : 'High salt content — raises sodium intake.');
  } else if (salt != null && salt >= 0.75) {
    add('hypertension', 'High blood pressure', 'medium', `${round1(salt)} g salt per 100 g — not low.`);
  }

  // Hypotension — opposite caution: very low salt + caffeine-free not directly detectable from label,
  // but flag if the product is explicitly "low sodium" with 0 g salt (skipped: rarely harmful).

  // Allergies — surface declared allergens as condition-style chips
  for (const a of allergens) {
    add(`allergen:${a}`, `Allergy: ${a}`, 'low', `Contains ${a}.`);
  }

  // PKU — aspartame
  const hasAspartame = eNumbers.some((e) => normalizeCode(e.code || '') === 'E951') ||
    /aspartame/.test(ingredients);
  if (hasAspartame) {
    add('pku', 'Phenylketonuria (PKU)', 'high',
      'Contains aspartame (E951) — a source of phenylalanine. Must be avoided with PKU.');
  }

  // Sulfite sensitivity
  const sulfiteCodes = ['E220', 'E221', 'E222', 'E223', 'E224', 'E226', 'E227', 'E228'];
  const hasSulfites = eNumbers.some((e) => sulfiteCodes.includes(normalizeCode(e.code || ''))) ||
    allergens.some((a) => /sulfite|sulphite/i.test(a));
  if (hasSulfites) {
    add('sulfite_sensitivity', 'Sulfite sensitivity / asthma', 'high',
      'Contains sulfites — can trigger asthma attacks in sulfite-sensitive people.');
  }

  // ADHD-sensitive children — Southampton six
  if (hasFlag(redFlags, 'artificialColor')) {
    add('adhd_children', 'Children sensitive to colors', 'high',
      'Contains a Southampton-six food coloring linked to hyperactivity in sensitive children.');
  }

  // Kidney disease — added phosphates
  const phosphateCodes = ['E338', 'E339', 'E340', 'E341', 'E450', 'E451', 'E452'];
  const hasAddedPhosphate = eNumbers.some((e) => phosphateCodes.includes(normalizeCode(e.code || '')));
  if (hasAddedPhosphate) {
    add('kidney', 'Kidney disease', 'medium',
      'Contains added phosphates — absorbed more readily than natural phosphorus. Limit if advised.');
  }

  // IBS / sensitive gut — emulsifiers and polyols
  const gutCodes = ['E407', 'E433', 'E466', 'E471', 'E472e', 'E420', 'E421', 'E965', 'E966', 'E967', 'E171'];
  const gutTrigger = eNumbers.find((e) => gutCodes.includes(normalizeCode(e.code || '')));
  if (gutTrigger) {
    add('ibs', 'Sensitive gut / IBS', 'low',
      `Contains ${gutTrigger.code} — may aggravate symptoms in sensitive guts with regular intake.`);
  }

  // Additional condition tags pulled from enumbers.json where present
  if (db) {
    const collectedKeys = new Set(warnings.map((w) => w.key));
    for (const e of eNumbers) {
      const ref = lookupAdditive(db, e.code);
      if (!ref?.conditions?.length) continue;
      for (const cond of ref.conditions) {
        const key = cond;
        if (collectedKeys.has(key) || key.startsWith('allergen:')) continue;
        const label = db.conditions[cond] || cond;
        const severity = ref.concern === 'high' ? 'high' : ref.concern === 'medium' ? 'medium' : 'low';
        add(key, label, severity, `Note for this group: ${ref.code} ${ref.name}.`);
        collectedKeys.add(key);
      }
    }
  }

  return warnings;
}

// Frequency guidance helper — turns concern + additive category into a
// plain-English line the read-more card shows below the dose paragraphs.
export function frequencyGuidance(concern) {
  switch ((concern || '').toLowerCase()) {
    case 'high':
      return 'Best kept to rare or special-occasion consumption, not a weekly habit.';
    case 'medium':
      return 'Fine now and then; try to avoid making it a daily staple.';
    default:
      return 'Fine at typical daily food intakes.';
  }
}

// --- small utils ---

function hasFlag(flags, type) {
  return flags.some((f) => f.type === type);
}

function severityOf(flags, type) {
  const f = flags.find((x) => x.type === type);
  return (f?.severity || 'medium').toLowerCase();
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}
