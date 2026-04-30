// Screen router, global state, event wiring. Feature logic lives in the
// sibling modules.

import { openCamera, openGallery, compressImage } from './camera.js';
import { initCropper } from './cropper.js';
import { renderScorecard } from './scorecard.js';
import { renderArchiveGrid, clearArchiveGrid } from './archive.js';
import { exportCard } from './cardexport.js';
import * as storage from './storage.js';
import * as catalog from './catalog.js';

const SCREENS = ['scan', 'crop', 'analyzing', 'result', 'archive', 'detail', 'catalog', 'catalog-detail', 'about'];
const PUBLISH_PREF_KEY = 'foolab.publishToCatalog';
const TIPS = [
  'Reading ingredients…',
  'Checking E-numbers…',
  'Counting the sugar…',
  'Grading the NutriScore…',
  'Looking for red flags…'
];

const state = {
  currentScan: { photos: [], result: null },
  detailId: null,
  cropper: null,
  tipTimer: null,
  installPrompt: null,
  catalog: {
    enabled: false,
    query: '',
    kind: '',
    nutriScore: [],
    avoidFlags: [],
    sort: 'recent',
    offset: 0,
    rows: [],
    total: 0,
    loading: false,
    searchDebounce: null
  },
  catalogDetailId: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireNav();
  wireScan();
  wireCrop();
  wireResult();
  wireArchive();
  wireDetail();
  wireCatalog();
  wireCatalogDetail();
  wireInstall();
  await refreshArchiveCount();
  show('scan');
  registerSW();
  initCatalogAvailability();
}

async function initCatalogAvailability() {
  try {
    state.catalog.enabled = await catalog.isCatalogEnabled();
  } catch {
    state.catalog.enabled = false;
  }
  byId('catalogCta').hidden = !state.catalog.enabled;
}

// --- Navigation -----------------------------------------------------------

function show(screen) {
  for (const s of SCREENS) {
    const el = document.getElementById(`screen-${s}`);
    if (el) el.hidden = (s !== screen);
  }
  window.scrollTo(0, 0);
}

function wireNav() {
  byId('archiveBtn').addEventListener('click', openArchive);
  byId('catalogCta').addEventListener('click', (e) => { e.preventDefault(); openCatalog(); });
  byId('aboutBtn').addEventListener('click', () => show('about'));
  byId('aboutBackBtn').addEventListener('click', () => show('scan'));
  byId('shareAppBtn').addEventListener('click', shareApp);
}

async function shareApp() {
  const shareData = {
    title: 'FooLab — food label scanner',
    text: 'Scan any food label, get a NutriScore and red-flag alerts.',
    url: location.origin || 'https://foolab.vercel.app'
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareData.url);
      toast('Link copied to clipboard.');
    } else {
      toast('Sharing not supported on this device.', { error: true });
    }
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('Share failed:', err);
  }
}

function wireInstall() {
  const btn = byId('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    btn.disabled = true;
    try {
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
    } finally {
      state.installPrompt = null;
      btn.disabled = false;
      btn.hidden = true;
    }
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    btn.hidden = true;
    toast('FooLab installed. Find it on your home screen.');
  });
}

// --- Scan screen ----------------------------------------------------------

function wireScan() {
  byId('cameraBtn').addEventListener('click', () => {
    openCamera((file) => ingestPhoto(file, { first: true }));
  });
  byId('galleryBtn').addEventListener('click', () => {
    openGallery((file) => ingestPhoto(file, { first: true }));
  });
}

async function ingestPhoto(file, { first }) {
  try {
    const { base64, blob, width, height } = await compressImage(file);
    // Each photo keeps the compressed original always, plus an optional
    // crop. The original is what shows in the archive card and the share
    // PNG; the crop is what we send to Gemini.
    const photo = {
      originalBase64: base64,
      originalBlob: blob,
      originalWidth: width,
      originalHeight: height,
      cropBase64: null,
      cropBlob: null
    };

    if (first) {
      state.currentScan = { photos: [photo], result: null };
    } else {
      if (state.currentScan.photos.length >= 3) {
        toast('Max 3 photos. Remove one first.', { error: true });
        return;
      }
      // Freeze the previous photo's crop before moving on, otherwise
      // earlier shots would be sent uncropped.
      await commitCurrentCrop();
      state.currentScan.photos.push(photo);
    }
    await enterCrop();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not process photo.', { error: true });
  }
}

async function commitCurrentCrop() {
  if (!state.cropper) return;
  try {
    const cropped = await state.cropper.getCrop();
    const photos = state.currentScan.photos;
    const i = photos.length - 1;
    if (i >= 0) {
      photos[i].cropBase64 = cropped.base64;
      photos[i].cropBlob = cropped.blob;
    }
  } catch (err) {
    console.warn('Could not commit crop:', err);
  }
}

// --- Crop screen ----------------------------------------------------------

function wireCrop() {
  byId('cropBackBtn').addEventListener('click', () => {
    destroyCropper();
    show('scan');
  });
  byId('addPhotoBtn').addEventListener('click', () => {
    const input = byId('addPhotoInput');
    const handler = (e) => {
      input.removeEventListener('change', handler);
      const file = e.target.files?.[0];
      input.value = '';
      if (file) ingestPhoto(file, { first: false });
    };
    input.addEventListener('change', handler);
    input.click();
  });
  byId('analyzeBtn').addEventListener('click', runAnalysis);
}

async function enterCrop() {
  show('crop');
  await Promise.resolve(); // let the section become visible for getBoundingClientRect
  const photos = state.currentScan.photos;
  const active = photos[photos.length - 1];
  byId('photoMeta').textContent = `Photo ${photos.length} of ${photos.length}`;
  renderPhotoStrip();

  destroyCropper();
  state.cropper = initCropper(byId('cropCanvas'), active.originalBase64);
  await state.cropper.ready;
}

function renderPhotoStrip() {
  const strip = byId('photoStrip');
  strip.innerHTML = '';
  state.currentScan.photos.forEach((p, i) => {
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${p.originalBase64}`;
    if (i === state.currentScan.photos.length - 1) img.classList.add('active');
    strip.appendChild(img);
  });
}

function destroyCropper() {
  if (state.cropper?.destroy) state.cropper.destroy();
  state.cropper = null;
}

// --- Analysis -------------------------------------------------------------

async function runAnalysis() {
  const photos = state.currentScan.photos;
  if (photos.length === 0) return toast('Take a photo first.', { error: true });

  await commitCurrentCrop();
  destroyCropper();

  // Send the crop if one was committed, else fall back to the original.
  const images = photos.map((p) => p.cropBase64 || p.originalBase64);

  show('analyzing');
  startTipRotation();

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, language: 'en' })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || 'Something went wrong. Please try again.');
    }

    state.currentScan.result = data;
    showResult();
  } catch (err) {
    stopTipRotation();
    console.error('Analyze failed:', err);
    toast(err.message || 'Analysis failed.', { error: true });
    show('crop');
    // Rebuild the cropper so the user can retry without losing the photo.
    const active = photos[photos.length - 1];
    state.cropper = initCropper(byId('cropCanvas'), active.originalBase64);
  }
}

function startTipRotation() {
  stopTipRotation();
  let i = 0;
  const tipEl = byId('analyzingTip');
  tipEl.textContent = TIPS[0];
  state.tipTimer = setInterval(() => {
    i = (i + 1) % TIPS.length;
    tipEl.textContent = TIPS[i];
  }, 2500);
}

function stopTipRotation() {
  if (state.tipTimer) clearInterval(state.tipTimer);
  state.tipTimer = null;
}

// --- Result screen --------------------------------------------------------

function wireResult() {
  byId('saveBtn').addEventListener('click', saveCurrent);
  byId('shareBtn').addEventListener('click', shareCurrent);
  byId('rescanBtn').addEventListener('click', () => {
    state.currentScan = { photos: [], result: null };
    show('scan');
  });
}

function showResult() {
  stopTipRotation();
  const { photos, result } = state.currentScan;
  renderScorecard(result, photos[0]?.originalBlob, byId('resultMount'));

  // Show the publish toggle only when the catalog is configured AND the scan
  // is plausibly publishable (readable, has a product name).
  const eligible = state.catalog.enabled && !result?.notReadable && !!result?.productName;
  const wrap = byId('publishToggle');
  wrap.hidden = !eligible;
  if (eligible) {
    const cb = byId('publishCheckbox');
    cb.checked = readPublishPref();
    cb.onchange = () => writePublishPref(cb.checked);
  }
  show('result');
}

async function saveCurrent() {
  const { photos, result } = state.currentScan;
  if (!result) return;
  try {
    // Persist the originals. The thumbnail is always the first photo's
    // full (uncropped) shot so the archive card shows the whole product.
    const record = {
      timestamp: Date.now(),
      photos: photos.map((p) => p.originalBlob),
      thumbnail: photos[0]?.originalBlob || null,
      result,
      userNote: ''
    };
    await storage.save(record);
    await refreshArchiveCount();

    const wantPublish = state.catalog.enabled
      && !byId('publishToggle').hidden
      && byId('publishCheckbox').checked;

    if (wantPublish) {
      toast('Saved. Publishing to catalog…');
      // Fire-and-forget: a flaky network shouldn't block the local save.
      catalog.publishScan({ result, thumbnailBlob: record.thumbnail })
        .then((res) => {
          if (res?.action === 'inserted' || res?.action === 'merged') {
            toast('Saved to archive and shared with the catalog.');
          } else if (res?.action === 'incremented') {
            toast('Saved. Existing catalog entry got a +1.');
          } else if (res?.action === 'skipped') {
            toast('Saved to archive.');
          }
        })
        .catch((err) => {
          console.warn('Catalog publish failed:', err);
          toast('Saved locally — publishing to catalog failed.', { error: true });
        });
    } else {
      toast('Saved to archive.');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not save.', { error: true });
  }
}

function readPublishPref() {
  try {
    const v = localStorage.getItem(PUBLISH_PREF_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}

function writePublishPref(on) {
  try { localStorage.setItem(PUBLISH_PREF_KEY, on ? '1' : '0'); } catch {}
}

async function shareCurrent() {
  const { photos, result } = state.currentScan;
  if (!result) return;
  try {
    await exportCard({
      photos: photos.map((p) => p.originalBlob),
      thumbnail: photos[0]?.originalBlob,
      result
    });
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not share.', { error: true });
  }
}

// --- Archive --------------------------------------------------------------

function wireArchive() {
  byId('archiveBackBtn').addEventListener('click', () => show('scan'));
  byId('archiveScanBtn').addEventListener('click', () => show('scan'));
}

async function openArchive() {
  const grid = byId('archiveGrid');
  const empty = byId('archiveEmpty');
  clearArchiveGrid(grid);
  try {
    await renderArchiveGrid(grid, empty, openDetail);
  } catch (err) {
    toast(err.message || 'Could not open archive.', { error: true });
    return;
  }
  show('archive');
}

async function refreshArchiveCount() {
  const el = byId('archiveCount');
  let n = 0;
  try { n = await storage.count(); } catch {}
  el.textContent = n > 0 ? String(n) : '';
  el.dataset.zero = n === 0 ? 'true' : 'false';
}

// --- Detail ---------------------------------------------------------------

function wireDetail() {
  byId('detailBackBtn').addEventListener('click', openArchive);
  byId('detailShareBtn').addEventListener('click', shareDetail);
  byId('deleteBtn').addEventListener('click', deleteDetail);
}

async function openDetail(id) {
  const scan = await storage.get(id);
  if (!scan) return toast('Scan not found.', { error: true });
  state.detailId = id;
  renderScorecard(scan.result, scan.thumbnail, byId('detailMount'));
  show('detail');
}

async function shareDetail() {
  if (!state.detailId) return;
  const scan = await storage.get(state.detailId);
  if (!scan) return;
  try {
    await exportCard(scan);
  } catch (err) {
    toast(err.message || 'Could not share.', { error: true });
  }
}

async function deleteDetail() {
  if (!state.detailId) return;
  if (!window.confirm('Delete this scan?')) return;
  try {
    await storage.remove(state.detailId);
    state.detailId = null;
    await refreshArchiveCount();
    openArchive();
  } catch (err) {
    toast(err.message || 'Could not delete.', { error: true });
  }
}

// --- Catalog (public) -----------------------------------------------------

function wireCatalog() {
  byId('catalogBackBtn').addEventListener('click', () => show('scan'));

  const input = byId('catalogSearchInput');
  input.addEventListener('input', () => {
    clearTimeout(state.catalog.searchDebounce);
    state.catalog.searchDebounce = setTimeout(() => {
      state.catalog.query = input.value;
      reloadCatalog({ reset: true });
    }, 250);
  });

  // Food / All / Drinks tabs.
  for (const tab of document.querySelectorAll('#screen-catalog [data-kind]')) {
    tab.addEventListener('click', () => {
      state.catalog.kind = tab.dataset.kind;
      for (const t of document.querySelectorAll('#screen-catalog [data-kind]')) {
        t.classList.toggle('is-active', t === tab);
      }
      // Reset the search input placeholder so the user knows the scope.
      input.placeholder = state.catalog.kind === 'food'
        ? 'Search foods…'
        : state.catalog.kind === 'drink'
          ? 'Search drinks…'
          : 'Search by product or brand…';
      reloadCatalog({ reset: true });
    });
  }

  for (const chip of document.querySelectorAll('#screen-catalog [data-ns]')) {
    chip.addEventListener('click', () => {
      const v = chip.dataset.ns;
      const i = state.catalog.nutriScore.indexOf(v);
      if (i >= 0) state.catalog.nutriScore.splice(i, 1);
      else state.catalog.nutriScore.push(v);
      chip.classList.toggle('is-active');
      reloadCatalog({ reset: true });
    });
  }

  for (const chip of document.querySelectorAll('#screen-catalog [data-avoid]')) {
    chip.addEventListener('click', () => {
      const v = chip.dataset.avoid;
      const i = state.catalog.avoidFlags.indexOf(v);
      if (i >= 0) state.catalog.avoidFlags.splice(i, 1);
      else state.catalog.avoidFlags.push(v);
      chip.classList.toggle('is-active');
      reloadCatalog({ reset: true });
    });
  }

  for (const chip of document.querySelectorAll('#screen-catalog [data-sort]')) {
    chip.addEventListener('click', () => {
      state.catalog.sort = chip.dataset.sort;
      for (const c of document.querySelectorAll('#screen-catalog [data-sort]')) {
        c.classList.toggle('is-active', c === chip);
      }
      reloadCatalog({ reset: true });
    });
  }

  byId('catalogMoreBtn').addEventListener('click', () => reloadCatalog({ reset: false }));
}

async function openCatalog() {
  show('catalog');
  if (state.catalog.rows.length === 0) {
    await reloadCatalog({ reset: true });
  }
}

async function reloadCatalog({ reset }) {
  if (state.catalog.loading) return;
  state.catalog.loading = true;

  if (reset) {
    state.catalog.offset = 0;
    state.catalog.rows = [];
    state.catalog.total = 0;
  }

  try {
    const { rows, total } = await catalog.searchCatalog({
      q: state.catalog.query,
      kind: state.catalog.kind || null,
      nutriScore: state.catalog.nutriScore,
      avoidFlags: state.catalog.avoidFlags,
      sort: state.catalog.sort,
      offset: state.catalog.offset,
      limit: 24
    });
    state.catalog.rows.push(...rows);
    state.catalog.offset += rows.length;
    if (typeof total === 'number') state.catalog.total = total;
    renderCatalog();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not load catalog.', { error: true });
  } finally {
    state.catalog.loading = false;
  }
}

function renderCatalog() {
  const grid = byId('catalogGrid');
  const empty = byId('catalogEmpty');
  const meta = byId('catalogMeta');
  const more = document.querySelector('.catalog-loadmore');

  grid.innerHTML = '';

  if (state.catalog.rows.length === 0) {
    empty.hidden = false;
    meta.textContent = '';
    more.hidden = true;
    return;
  }
  empty.hidden = true;

  const total = state.catalog.total;
  meta.textContent = total ? `${total} product${total === 1 ? '' : 's'}` : '';

  Promise.all(state.catalog.rows.map((r) =>
    r.thumbnailPath ? catalog.thumbnailUrl(r.thumbnailPath) : Promise.resolve(null)
  )).then((urls) => {
    state.catalog.rows.forEach((r, i) => {
      grid.appendChild(buildCatalogCard(r, urls[i]));
    });
  });

  more.hidden = state.catalog.offset >= state.catalog.total;
}

function buildCatalogCard(row, thumbUrl) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'archive-card catalog-card';

  const thumb = document.createElement('div');
  thumb.className = 'archive-card-thumb';
  if (thumbUrl) thumb.style.backgroundImage = `url(${thumbUrl})`;

  const letter = (row.nutriScore || 'C').toUpperCase();
  const lbl = document.createElement('span');
  lbl.className = `archive-card-letter ns-${letter}`;
  lbl.textContent = letter;
  thumb.appendChild(lbl);

  if (row.scanCount > 1) {
    const badge = document.createElement('span');
    badge.className = 'catalog-card-badge';
    badge.textContent = `×${row.scanCount}`;
    thumb.appendChild(badge);
  }

  const body = document.createElement('div');
  body.className = 'archive-card-body';
  const name = document.createElement('div');
  name.className = 'archive-card-name';
  name.textContent = row.productName || 'Unknown';
  const metaLine = document.createElement('div');
  metaLine.className = 'archive-card-meta';
  metaLine.textContent = [row.brand, row.region].filter(Boolean).join(' · ') || '—';
  body.appendChild(name);
  body.appendChild(metaLine);

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener('click', () => openCatalogDetail(row.id));
  return card;
}

function wireCatalogDetail() {
  byId('catalogDetailBackBtn').addEventListener('click', () => show('catalog'));
}

async function openCatalogDetail(id) {
  state.catalogDetailId = id;
  const entry = await catalog.getCatalogEntry(id);
  if (!entry) {
    toast('Could not load product.', { error: true });
    return;
  }
  // Map back to the result-shape that renderScorecard expects.
  const resultShape = {
    productName: entry.productName,
    brand: entry.brand,
    nutriScore: entry.nutriScore,
    healthScore: entry.healthScore,
    summary: entry.summary,
    ingredients: entry.ingredients,
    eNumbers: entry.eNumbers,
    redFlags: entry.redFlags,
    nutrition: entry.nutrition,
    allergens: entry.allergens,
    confidence: entry.confidence,
    notReadable: false
  };

  const meta = byId('catalogDetailMeta');
  meta.innerHTML = '';
  if (entry.scanCount > 1 || entry.region) {
    const bits = [];
    if (entry.scanCount > 1) bits.push(`Scanned ${entry.scanCount} times`);
    if (entry.region) bits.push(`Region: ${entry.region}`);
    meta.textContent = bits.join(' · ');
  }

  // scorecard.renderScorecard ignores the photo blob argument today, so we
  // just pass null. If it ever starts using it, swap to the public storage
  // URL and fetch a Blob there.
  renderScorecard(resultShape, null, byId('catalogDetailMount'));
  show('catalog-detail');
}

// --- Utilities ------------------------------------------------------------

function toast(message, { error = false } = {}) {
  const t = byId('toast');
  t.textContent = message;
  t.className = 'toast' + (error ? ' toast-error' : '');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3500);
}

function byId(id) { return document.getElementById(id); }

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
