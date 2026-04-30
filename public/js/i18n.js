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
  showOverlay();
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

  try {
    const translations = await fetchTranslations(lang.englishName || lang.name, sourceStrings);
    if (translations) {
      currentTranslations = mergeWithSource(translations);
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          version: TRANSLATION_VERSION,
          strings: translations
        }));
      } catch {}
    } else {
      currentTranslations = sourceStrings;
    }
  } catch (err) {
    console.warn('Translation fetch failed:', err);
    currentTranslations = sourceStrings;
    if (/429|busy|overload|unavailable/i.test(err.message || '')) {
      showOverloadToast();
    }
  }
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
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetLanguage, strings })
  });
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

function showOverlay() {
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
  el.querySelector('.translation-overlay-text').textContent = t('translating');
  el.classList.add('is-visible');
}

function hideOverlay() {
  const el = document.getElementById('translationOverlay');
  if (el) el.classList.remove('is-visible');
}

function showOverloadToast() {
  const existing = document.getElementById('translateOverloadToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'translateOverloadToast';
  toast.className = 'toast toast-error';
  toast.textContent = t('toastTranslateOverloaded');
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 6000);
}
