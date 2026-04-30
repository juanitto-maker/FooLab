// Archive grid. Detail rendering is delegated to scorecard.js in app.js.

import { list } from './storage.js';
import { t, getCurrentLang, translateContent } from './i18n.js';

export async function renderArchiveGrid(gridEl, emptyEl, onOpen) {
  gridEl.innerHTML = '';
  const scans = await list({ limit: 50 });

  if (scans.length === 0) {
    gridEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  gridEl.hidden = false;
  emptyEl.hidden = true;

  // Batch-translate every product name in one go (cached per language).
  // EN short-circuits to identity inside translateContent.
  const names = scans
    .map((s) => s?.result?.productName)
    .filter((n) => n && String(n).trim());
  const nameMap = await translateContent(names);

  const urls = [];
  for (const scan of scans) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'archive-card';

    const thumb = document.createElement('div');
    thumb.className = 'archive-card-thumb';
    if (scan.thumbnail instanceof Blob) {
      const url = URL.createObjectURL(scan.thumbnail);
      urls.push(url);
      thumb.style.backgroundImage = `url(${url})`;
    }

    const letter = (scan.result?.nutriScore || 'C').toUpperCase();
    const lbl = document.createElement('span');
    lbl.className = `archive-card-letter ns-${letter}`;
    lbl.textContent = letter;
    thumb.appendChild(lbl);

    const body = document.createElement('div');
    body.className = 'archive-card-body';
    const name = document.createElement('div');
    name.className = 'archive-card-name';
    const rawName = scan.result?.productName;
    name.textContent = (rawName && nameMap[rawName]) || rawName || t('unknownProduct');
    const meta = document.createElement('div');
    meta.className = 'archive-card-meta';
    meta.textContent = formatDate(scan.timestamp);
    body.appendChild(name);
    body.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', () => onOpen(scan.id));
    gridEl.appendChild(card);
  }

  // Revoke object URLs when the grid is next rebuilt.
  gridEl._revoke = () => urls.forEach((u) => URL.revokeObjectURL(u));
}

export function clearArchiveGrid(gridEl) {
  if (typeof gridEl._revoke === 'function') gridEl._revoke();
  gridEl._revoke = null;
  gridEl.innerHTML = '';
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(getCurrentLang() || undefined, { month: 'short', day: 'numeric' });
}
