// Sacred-Verse-style i18n, vanilla JS edition.
//
// Architecture: English source strings → /api/translate (Gemini) → cache.
// Sacred Verse caches per-tab in sessionStorage; we use localStorage so
// installed PWA users don't re-pay the translation cost on every launch
// (offline resilience). Cache is keyed by language + TRANSLATION_VERSION
// — bump the version when sourceStrings change to invalidate stale caches.
//
// All keys are listed in translations-data.js — DO NOT inline strings.
//
// DOM hookup:
//   data-i18n="key"             → element.textContent
//   data-i18n-placeholder="key" → element.placeholder
//   data-i18n-title="key"       → element.title
//   data-i18n-aria-label="key"  → element.aria-label
//   data-i18n-html="key"        → element.innerHTML (only for keys you trust)
//
// Page <title> is updated via document.documentElement[data-i18n-page-title].

import { languages, sourceStrings, RTL_CODES, TRANSLATION_VERSION } from './translations-data.js';

const STORAGE_KEY = 'foolab.lang';
const CACHE_PREFIX = 'foolab.translations.';
const CONTENT_CACHE_PREFIX = 'foolab.content.';
const CONTENT_CACHE_LIMIT = 4000; // entries; ~ a few hundred KB
const SUBSCRIBERS = new Set();

let currentLangCode = 'en';
let currentTranslations = sourceStrings;

// --- Public API -----------------------------------------------------------

export function getCurrentLang() {
  return currentLangCode;
}

export function getCurrentLanguage() {
  return languages.find((l) => l.code === currentLangCode) || languages[0];
}

export function getLanguages() {
  return languages.slice();
}

// Translate a key. Optional {placeholder: value} replacements support
// patterns like "Photo {n} of {total}".
export function t(key, replacements) {
  let s = currentTranslations[key];
  if (s == null || s === '') s = sourceStrings[key];
  if (s == null) return key;
  if (replacements) {
    for (const k of Object.keys(replacements)) {
      s = s.split('{' + k + '}').join(String(replacements[k]));
    }
  }
  return s;
}

// Subscribe to language changes — modules that render dynamic content
// (toasts, scorecard, archive) should re-render when the language flips.
export function onLanguageChange(fn) {
  SUBSCRIBERS.add(fn);
  return () => SUBSCRIBERS.delete(fn);
}

// Boot: read saved code, load translations, paint DOM, build switcher.
export async function initLanguage(switcherContainerId = 'langSelector') {
  const saved = readSavedLang();
  currentLangCode = saved || 'en';
  applyHtmlLang();
  await loadTranslations(currentLangCode);
  applyTranslations();
  buildLangSelector(switcherContainerId);
}

// Switch language: persist, fetch + cache (if needed), re-paint DOM.
export async function setLanguage(code) {
  if (!languages.some((l) => l.code === code)) return;
  if (code === currentLangCode) return;
  currentLangCode = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch {}
  applyHtmlLang();
  // Overlay text reflects the chosen language ("Translating into Greek…")
  // so the user knows what's happening when it takes a few seconds.
  const lang = languages.find((l) => l.code === code);
  showOverlay(lang ? lang.name : null);
  try {
    await loadTranslations(code);
  } finally {
    hideOverlay();
  }
  applyTranslations();
  for (const fn of SUBSCRIBERS) {
    try { fn(code); } catch (e) { console.warn(e); }
  }
}

// --- Translation loading --------------------------------------------------

async function loadTranslations(code) {
  if (code === 'en') {
    currentTranslations = sourceStrings;
    return;
  }

  const cacheKey = CACHE_PREFIX + code;
  let cached = null;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch {}
  if (cached && cached.version === TRANSLATION_VERSION && cached.strings) {
    currentTranslations = mergeWithSource(cached.strings);
    // Even when cached, fetch any keys that have been added since.
    backfillMissingKeys(code, cached.strings, cacheKey);
    return;
  }

  const lang = languages.find((l) => l.code === code);
  if (!lang) {
    currentTranslations = sourceStrings;
    return;
  }

  // Chunk the source dictionary into small batches and translate them
  // sequentially. One 156-key request can blow past Netlify Free's 10s
  // function ceiling; four ~50-key requests each comfortably fit. Partial
  // successes get cached so a retry only fetches the gaps. Sequential,
  // because parallel calls eat the per-minute Gemini quota.
  const partial = (cached && cached.strings) ? Object.assign({}, cached.strings) : {};
  const sourceCount = Object.keys(sourceStrings).length;
  const startCount = Object.keys(partial).length;

  const { merged, error } = await translateInBatches(
    lang.englishName || lang.name,
    sourceStrings,
    partial,
    (done, total) => {
      // Live progress in the overlay so a 20s wait doesn't feel infinite.
      updateOverlayProgress(lang.name, done, total);
    }
  );

  // Save whatever we managed (even partial). On the next switch the
  // backfill picks up the gaps without re-translating what's already cached.
  if (Object.keys(merged).length > 0) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        version: TRANSLATION_VERSION,
        strings: merged
      }));
    } catch {}
    currentTranslations = mergeWithSource(merged);
  } else {
    currentTranslations = sourceStrings;
  }

  if (!error) return;

  // Decide whether to bother the user. If most keys still came back
  // (≥ 70% of the source), the visible UI looks fully translated and
  // the warning is just noise — silently schedule a background retry
  // for the missing keys instead.
  const finalCount = Object.keys(merged).length;
  const fillRatio = sourceCount > 0 ? finalCount / sourceCount : 1;
  const successDuringRun = finalCount - startCount;

  if (fillRatio >= 0.7) {
    // Quietly retry the gaps a minute later, when the per-minute Gemini
    // quota window has reset. No toast.
    scheduleBackgroundBackfill(code, merged, cacheKey, 65000);
    return;
  }

  if (successDuringRun === 0) {
    // Nothing came back at all — show a clear, actionable toast.
    const msg = (error.message || '').toLowerCase();
    let key = 'toastTranslateOverloaded';
    if (/timeout|timed out|abort/.test(msg)) key = 'toastTranslateTimeout';
    else if (/missing.*gemini.*key|server missing/.test(msg)) key = 'toastTranslateNotConfigured';
    setTimeout(() => showFailureToast(key), 80);
    // Still try a silent retry later, in case it was a transient blip.
    scheduleBackgroundBackfill(code, merged, cacheKey, 65000);
  } else {
    // Partial success but below 70% — schedule silent backfill, no toast.
    scheduleBackgroundBackfill(code, merged, cacheKey, 65000);
  }
}

// Schedule a one-shot, silent retry of any keys still missing for the
// given language. Skips if the user has since switched to another
// language. Updates DOM via applyTranslations on success.
const BACKFILL_TIMERS = new Map();
function scheduleBackgroundBackfill(code, mergedNow, cacheKey, delayMs) {
  if (BACKFILL_TIMERS.has(code)) clearTimeout(BACKFILL_TIMERS.get(code));
  const timer = setTimeout(async () => {
    BACKFILL_TIMERS.delete(code);
    if (currentLangCode !== code) return;
    await backfillMissingKeys(code, mergedNow, cacheKey);
  }, delayMs);
  BACKFILL_TIMERS.set(code, timer);
}

const BATCH_SIZE = 50;
const PARALLEL_LIMIT = 1;
const FETCH_TIMEOUT_MS = 22000;

// Split sourceStrings into batches, translate them sequentially, merge
// results into `seed`, and call onProgress(done, total) after each batch.
// On a 429 we stop scheduling more batches — keep firing while the quota
// is empty just burns the rest of the per-minute window.
async function translateInBatches(targetLanguage, source, seed, onProgress) {
  const merged = Object.assign({}, seed);
  const allKeys = Object.keys(source).filter((k) => !merged[k]);
  if (allKeys.length === 0) return { merged, error: null };

  const batches = [];
  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const slice = allKeys.slice(i, i + BATCH_SIZE);
    const obj = {};
    for (const k of slice) obj[k] = source[k];
    batches.push(obj);
  }

  if (typeof onProgress === 'function') onProgress(0, batches.length);

  let stopErr = null;
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < batches.length && !stopErr) {
      const idx = cursor++;
      try {
        const part = await fetchTranslations(targetLanguage, batches[idx]);
        if (part) Object.assign(merged, part);
      } catch (err) {
        if (err.status === 429 || /429|quota|rate|exhausted/i.test(err.message || '')) {
          // Stop the world — siblings will hit the same limit. Save what
          // we have and surface the rate-limit error to the caller.
          stopErr = err;
          return;
        }
        // Keep going on transient single-batch failures (timeout, parse
        // glitch). Other batches may still succeed.
        console.warn('Batch translate failed (continuing):', err.message || err);
      } finally {
        done++;
        if (typeof onProgress === 'function') onProgress(done, batches.length);
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(PARALLEL_LIMIT, batches.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return { merged, error: stopErr };
}

async function backfillMissingKeys(code, cachedStrings, cacheKey) {
  const missing = Object.keys(sourceStrings).filter(
    (k) => !cachedStrings[k] || !String(cachedStrings[k]).trim()
  );
  if (missing.length === 0) return;

  const lang = languages.find((l) => l.code === code);
  if (!lang) return;

  const subset = {};
  for (const k of missing) subset[k] = sourceStrings[k];

  try {
    const translations = await fetchTranslations(lang.englishName || lang.name, subset);
    if (!translations) return;
    if (currentLangCode !== code) return; // user moved on
    const merged = Object.assign({}, cachedStrings, translations);
    currentTranslations = mergeWithSource(merged);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        version: TRANSLATION_VERSION,
        strings: merged
      }));
    } catch {}
    applyTranslations();
  } catch (e) {
    // silent — next session will retry
  }
}

async function fetchTranslations(targetLanguage, strings) {
  // Browser-side timeout — the Netlify/Vercel function can stall on a cold
  // Gemini call and we don't want the overlay to feel infinite.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage, strings }),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('Translation timed out — try again.');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || 'Translation failed.');
    err.status = response.status;
    throw err;
  }
  return data?.translations || null;
}

function mergeWithSource(translations) {
  // Always fall back to source for any key the AI dropped.
  const out = Object.assign({}, sourceStrings);
  for (const k of Object.keys(translations)) {
    const v = translations[k];
    if (v != null && String(v).trim()) out[k] = v;
  }
  return out;
}

function readSavedLang() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function applyHtmlLang() {
  document.documentElement.lang = currentLangCode;
  document.documentElement.dir = RTL_CODES.has(currentLangCode) ? 'rtl' : 'ltr';
}

// --- DOM application ------------------------------------------------------

export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });

  const titleKey = document.documentElement.getAttribute('data-i18n-page-title');
  if (titleKey) document.title = t(titleKey);
}

// --- Language switcher (flag bubble + dropdown, Sacred Verse style) ------

export function buildLangSelector(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const current = getCurrentLanguage();
  container.innerHTML = '';

  const backdrop = document.createElement('div');
  backdrop.className = 'lang-backdrop';
  container.appendChild(backdrop);

  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.className = 'lang-bubble';
  bubble.style.backgroundImage = flagBg(current.countryCode, 80);
  bubble.title = current.name;
  bubble.setAttribute('aria-label', t('selectLanguage'));
  bubble.setAttribute('aria-haspopup', 'true');
  bubble.setAttribute('aria-expanded', 'false');
  container.appendChild(bubble);

  const dropdown = document.createElement('div');
  dropdown.className = 'lang-dropdown';
  dropdown.setAttribute('role', 'listbox');

  for (const lang of languages) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'lang-dropdown-item' + (lang.code === current.code ? ' is-active' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', lang.code === current.code ? 'true' : 'false');
    item.dataset.code = lang.code;

    const img = document.createElement('img');
    img.className = 'lang-dropdown-flag';
    img.src = `https://flagcdn.com/w40/${lang.countryCode}.png`;
    img.alt = '';
    img.width = 28;
    img.loading = 'lazy';
    img.onerror = () => { img.style.visibility = 'hidden'; };

    const name = document.createElement('span');
    name.className = 'lang-dropdown-name';
    name.textContent = lang.name;

    item.appendChild(img);
    item.appendChild(name);

    item.addEventListener('click', async () => {
      closeDropdown();
      if (lang.code === currentLangCode) return;
      await setLanguage(lang.code);
      bubble.style.backgroundImage = flagBg(lang.countryCode, 80);
      bubble.title = lang.name;
      dropdown.querySelectorAll('.lang-dropdown-item').forEach((i) => {
        const active = i.dataset.code === lang.code;
        i.classList.toggle('is-active', active);
        i.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    });

    dropdown.appendChild(item);
  }

  container.appendChild(dropdown);

  function openDropdown() {
    dropdown.classList.add('is-open');
    backdrop.classList.add('is-open');
    bubble.setAttribute('aria-expanded', 'true');
  }
  function closeDropdown() {
    dropdown.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    bubble.setAttribute('aria-expanded', 'false');
  }

  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('is-open')) closeDropdown();
    else openDropdown();
  });
  backdrop.addEventListener('click', closeDropdown);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });
}

function flagBg(countryCode, w) {
  return `url(https://flagcdn.com/w${w}/${countryCode}.png)`;
}

// --- Translation overlay + overload toast --------------------------------

function showOverlay(languageName) {
  let el = document.getElementById('translationOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'translationOverlay';
    el.className = 'translation-overlay';
    el.innerHTML =
      '<div class="translation-overlay-card">' +
        '<div class="translation-overlay-spinner"></div>' +
        '<div class="translation-overlay-text"></div>' +
      '</div>';
    document.body.appendChild(el);
  }
  const base = t('translating');
  el.querySelector('.translation-overlay-text').textContent =
    languageName ? `${base} → ${languageName}` : base;
  el.classList.add('is-visible');
}

function updateOverlayProgress(languageName, done, total) {
  const el = document.getElementById('translationOverlay');
  if (!el) return;
  const text = el.querySelector('.translation-overlay-text');
  if (!text) return;
  const base = t('translating');
  if (total > 1) {
    text.textContent = languageName
      ? `${base} → ${languageName} (${done}/${total})`
      : `${base} (${done}/${total})`;
  }
}

function hideOverlay() {
  const el = document.getElementById('translationOverlay');
  if (el) el.classList.remove('is-visible');
}

function showFailureToast(key) {
  const existing = document.getElementById('translateOverloadToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'translateOverloadToast';
  toast.className = 'toast toast-error';
  toast.textContent = t(key);
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 6000);
}

// --- Dynamic content translation -----------------------------------------
//
// Catalog rows, archive entries, and fresh scan results contain free-form
// English text (productName, brand, summary, ingredients, redFlag details,
// eNumber names/notes, tips, allergens) that the static UI dictionary
// can't cover. translateContent batches the missing strings into a single
// /api/translate call and caches them keyed by the source string itself,
// so two products with the same brand only translate that brand once per
// language, ever.
//
// Cache layout: localStorage['foolab.content.<langCode>'] = { source: translated, ... }
// English is identity (no cache, no API call).
// Brand-name preservation is handled by the prompt in lib/translate-core.js.

function readContentCache(code) {
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_PREFIX + code);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function writeContentCache(code, cache) {
  try {
    // Soft cap — drop oldest half if we blow past the limit. Map entries
    // preserve insertion order so the oldest are at the front.
    const keys = Object.keys(cache);
    if (keys.length > CONTENT_CACHE_LIMIT) {
      const drop = keys.length - Math.floor(CONTENT_CACHE_LIMIT * 0.7);
      const trimmed = {};
      keys.slice(drop).forEach((k) => { trimmed[k] = cache[k]; });
      cache = trimmed;
    }
    localStorage.setItem(CONTENT_CACHE_PREFIX + code, JSON.stringify(cache));
  } catch {
    // quota exceeded — give up silently, next call will retry the API
  }
}

// Translate a list of source strings into the active language. Returns a
// { source: translated } map containing every input. Uses the per-language
// content cache; only un-cached strings hit /api/translate.
//
// Inputs are de-duplicated and trimmed; empty/whitespace strings map to
// themselves.
export async function translateContent(sources) {
  const code = currentLangCode;
  const out = {};

  if (!Array.isArray(sources) || sources.length === 0) return out;
  if (code === 'en') {
    for (const s of sources) out[s] = s;
    return out;
  }

  // Normalise + dedupe
  const unique = [];
  const seen = new Set();
  for (const s of sources) {
    if (s == null) continue;
    const str = String(s);
    if (!str.trim()) { out[str] = str; continue; }
    if (seen.has(str)) continue;
    seen.add(str);
    unique.push(str);
  }
  if (unique.length === 0) return out;

  const cache = readContentCache(code);
  const missing = [];
  for (const s of unique) {
    if (cache[s]) out[s] = cache[s];
    else missing.push(s);
  }

  if (missing.length === 0) return out;

  // Batch into one /api/translate call. Keys are stable s0..sN — values
  // come back in the same shape from translate-core.
  const strings = {};
  missing.forEach((s, i) => { strings['s' + i] = s; });

  const lang = languages.find((l) => l.code === code);
  if (!lang) {
    missing.forEach((s) => { out[s] = s; });
    return out;
  }

  try {
    const translations = await fetchTranslations(lang.englishName || lang.name, strings);
    if (translations) {
      missing.forEach((s, i) => {
        const v = translations['s' + i];
        if (v && String(v).trim()) {
          cache[s] = v;
          out[s] = v;
        } else {
          out[s] = s;
        }
      });
      writeContentCache(code, cache);
    } else {
      missing.forEach((s) => { out[s] = s; });
    }
  } catch (err) {
    console.warn('Content translate failed:', err.message || err);
    if (/429|busy|overload|unavailable|quota|rate/i.test(err.message || '')) {
      showFailureToast('toastTranslateOverloaded');
    }
    missing.forEach((s) => { out[s] = s; });
  }

  return out;
}

// Translate a scan result into the active language. Returns a new result
// object with productName / brand / summary / tips / ingredients /
// allergens / redFlags[].detail / eNumbers[].name / eNumbers[].note
// translated. Untouched fields (nutriScore, healthScore, nutrition table,
// confidence, severities, codes) stay canonical.
//
// English just returns the input unchanged.
export async function translateScanResult(result) {
  if (!result || currentLangCode === 'en' || result.notReadable) return result;

  const sources = [];
  const push = (v) => {
    if (v != null && String(v).trim()) sources.push(String(v));
  };
  push(result.productName);
  push(result.brand);
  push(result.summary);
  push(result.tips);
  push(result.reason);
  if (Array.isArray(result.ingredients)) result.ingredients.forEach(push);
  if (Array.isArray(result.allergens)) result.allergens.forEach(push);
  if (Array.isArray(result.redFlags)) {
    result.redFlags.forEach((f) => push(f && f.detail));
  }
  if (Array.isArray(result.eNumbers)) {
    result.eNumbers.forEach((e) => {
      if (!e) return;
      push(e.name);
      push(e.note);
    });
  }

  const map = await translateContent(sources);
  const tr = (v) => (v != null && map[String(v)]) ? map[String(v)] : v;

  return {
    ...result,
    productName: tr(result.productName),
    brand: tr(result.brand),
    summary: tr(result.summary),
    tips: tr(result.tips),
    reason: tr(result.reason),
    ingredients: Array.isArray(result.ingredients) ? result.ingredients.map(tr) : result.ingredients,
    allergens: Array.isArray(result.allergens) ? result.allergens.map(tr) : result.allergens,
    redFlags: Array.isArray(result.redFlags)
      ? result.redFlags.map((f) => f ? { ...f, detail: tr(f.detail) } : f)
      : result.redFlags,
    eNumbers: Array.isArray(result.eNumbers)
      ? result.eNumbers.map((e) => e ? { ...e, name: tr(e.name), note: tr(e.note) } : e)
      : result.eNumbers
  };
}

// Translate a list of catalog/archive grid rows in one batch. Returns a
// new array with productName / brand translated (all the grid card shows).
// Pass through unchanged when EN.
export async function translateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  if (currentLangCode === 'en') return rows;

  const sources = [];
  for (const r of rows) {
    if (r && r.productName) sources.push(String(r.productName));
    if (r && r.brand) sources.push(String(r.brand));
  }
  if (sources.length === 0) return rows;

  const map = await translateContent(sources);
  return rows.map((r) => {
    if (!r) return r;
    return {
      ...r,
      productName: r.productName && map[String(r.productName)] ? map[String(r.productName)] : r.productName,
      brand: r.brand && map[String(r.brand)] ? map[String(r.brand)] : r.brand
    };
  });
}
