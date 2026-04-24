// Export a scan as a 1080×1350 PNG (Instagram portrait) and share via Web Share,
// with a download fallback.

const W = 1080;
const H = 1350;

const NS_COLORS = {
  A: '#2e7d32',
  B: '#66bb6a',
  C: '#fdd835',
  D: '#fb8c00',
  E: '#c62828'
};
const SEV_COLORS = {
  low: '#fbc02d',
  medium: '#f57c00',
  high: '#c62828'
};
const RED_FLAG_LABELS = {
  palmOil: 'Palm oil',
  transFat: 'Trans fat',
  highSugar: 'High sugar',
  highSalt: 'High salt',
  highSatFat: 'High sat fat',
  artificialColor: 'Artificial color',
  preservative: 'Preservative',
  sweetener: 'Sweetener',
  msg: 'MSG',
  bhaBht: 'BHA/BHT',
  ultraProcessed: 'Ultra-processed',
  allergen: 'Allergen'
};

export async function exportCard(scan) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fafaf7';
  ctx.fillRect(0, 0, W, H);

  // Photo — 1080×540 top block, cover fit.
  const photo = scan.photos?.[0] || scan.thumbnail;
  if (photo instanceof Blob) {
    const bmp = await blobToImage(photo);
    drawCover(ctx, bmp, 0, 0, W, 540);
  } else {
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, W, 540);
  }

  // NutriScore block
  const letter = (scan.result?.nutriScore || 'C').toUpperCase();
  const ns = NS_COLORS[letter] || NS_COLORS.C;
  ctx.fillStyle = ns;
  ctx.fillRect(60, 580, 240, 240);
  ctx.fillStyle = (letter === 'C') ? '#1a1a1a' : '#fff';
  ctx.font = '800 180px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 180, 700);

  // Product name + brand
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 48px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  wrapText(ctx, scan.result?.productName || 'Unknown product', 340, 600, W - 400, 56, 2);

  if (scan.result?.brand) {
    ctx.fillStyle = '#555';
    ctx.font = '400 32px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.fillText(scan.result.brand, 340, 720);
  }

  // Health score
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '600 34px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  const score = clamp(scan.result?.healthScore);
  ctx.fillText(`Health score: ${score} / 100`, 340, 770);

  // Red flags — up to 4 chips stacked
  const flags = (scan.result?.redFlags || []).slice(0, 4);
  let y = 880;
  ctx.font = '600 28px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  for (const f of flags) {
    const label = RED_FLAG_LABELS[f.type] || f.type;
    const color = SEV_COLORS[f.severity] || SEV_COLORS.medium;
    drawChip(ctx, label, 60, y, color, f.severity === 'low' ? '#1a1a1a' : '#fff');
    y += 72;
  }

  // Footer
  ctx.fillStyle = '#888';
  ctx.font = '400 26px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Scanned with FooLab', W / 2, H - 64);

  const blob = await canvasToBlob(canvas);
  await shareOrDownload(blob, scan);
  return blob;
}

async function shareOrDownload(blob, scan) {
  const filename = `foolab-${(scan.result?.productName || 'scan').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'FooLab scan',
        text: scan.result?.summary || 'A food label scan'
      });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function drawChip(ctx, text, x, y, bg, fg) {
  ctx.font = '600 28px -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';
  const padX = 20;
  const padY = 10;
  const metrics = ctx.measureText(text);
  const w = metrics.width + padX * 2;
  const h = 48;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + h / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const sw = img.width;
  const sh = img.height;
  const sr = sw / sh;
  const dr = dw / dh;
  let sx = 0, sy = 0, cw = sw, ch = sh;
  if (sr > dr) {
    cw = sh * dr;
    sx = (sw - cw) / 2;
  } else {
    ch = sw / dr;
    sy = (sh - ch) / 2;
  }
  ctx.drawImage(img, sx, sy, cw, ch, dx, dy, dw, dh);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + '…';
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image.')); };
    img.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Could not export PNG.'));
    }, 'image/png');
  });
}
