// Screen router, global state, event wiring. Feature logic lives in the
// sibling modules.

import { openCamera, openGallery, compressImage } from './camera.js';
import { initCropper } from './cropper.js';
import { renderScorecard } from './scorecard.js';
import { renderArchiveGrid, clearArchiveGrid } from './archive.js';
import { exportCard } from './cardexport.js';
import * as storage from './storage.js';

const SCREENS = ['scan', 'crop', 'analyzing', 'result', 'archive', 'detail', 'about'];
const TIPS = [
  'Reading ingredients…',
  'Checking E-numbers…',
  'Counting the sugar…',
  'Grading the NutriScore…',
  'Looking for red flags…'
];

const state = {
  currentScan: { photos: [], cropped: null, result: null },
  detailId: null,
  cropper: null,
  tipTimer: null
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireNav();
  wireScan();
  wireCrop();
  wireResult();
  wireArchive();
  wireDetail();
  await refreshArchiveCount();
  show('scan');
  registerSW();
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
  byId('aboutBtn').addEventListener('click', () => show('about'));
  byId('aboutBackBtn').addEventListener('click', () => show('scan'));
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
    const photo = { base64, blob, width, height };

    if (first) {
      state.currentScan = { photos: [photo], cropped: null, result: null };
    } else {
      if (state.currentScan.photos.length >= 3) {
        toast('Max 3 photos. Remove one first.', { error: true });
        return;
      }
      // Commit the current photo's crop before moving on so earlier shots
      // aren't discarded when a new one is added.
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
      photos[i] = {
        base64: cropped.base64,
        blob: cropped.blob,
        width: cropped.width,
        height: cropped.height
      };
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
  state.cropper = initCropper(byId('cropCanvas'), active.base64);
  await state.cropper.ready;
}

function renderPhotoStrip() {
  const strip = byId('photoStrip');
  strip.innerHTML = '';
  state.currentScan.photos.forEach((p, i) => {
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${p.base64}`;
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

  let cropped;
  try {
    cropped = await state.cropper.getCrop();
  } catch (err) {
    return toast(err.message || 'Could not crop photo.', { error: true });
  }

  // Replace the last photo with its cropped version for archive display.
  photos[photos.length - 1] = {
    base64: cropped.base64,
    blob: cropped.blob,
    width: cropped.width,
    height: cropped.height
  };
  destroyCropper();

  show('analyzing');
  startTipRotation();

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: photos.map((p) => p.base64),
        language: 'en'
      })
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
    // Rebuild cropper on the last photo so user can retry.
    const active = photos[photos.length - 1];
    state.cropper = initCropper(byId('cropCanvas'), active.base64);
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
    state.currentScan = { photos: [], cropped: null, result: null };
    show('scan');
  });
}

function showResult() {
  stopTipRotation();
  const { photos, result } = state.currentScan;
  renderScorecard(result, photos[0]?.blob, byId('resultMount'));
  show('result');
}

async function saveCurrent() {
  const { photos, result } = state.currentScan;
  if (!result) return;
  try {
    const record = {
      timestamp: Date.now(),
      photos: photos.map((p) => p.blob),
      thumbnail: photos[0]?.blob || null,
      result,
      userNote: ''
    };
    await storage.save(record);
    await refreshArchiveCount();
    toast('Saved to archive.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not save.', { error: true });
  }
}

async function shareCurrent() {
  const { photos, result } = state.currentScan;
  if (!result) return;
  try {
    await exportCard({
      photos: photos.map((p) => p.blob),
      thumbnail: photos[0]?.blob,
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
  try {
    const n = await storage.count();
    byId('archiveCount').textContent = String(n);
  } catch {
    byId('archiveCount').textContent = '0';
  }
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
