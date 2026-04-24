// Drag-corner crop on a canvas. Touch-first for Android, mouse as fallback.
// DPR-aware so crops are crisp on high-DPI phones.
//
// initCropper(canvas, base64) → { getCrop(quality=0.85): Promise<{base64, blob}> }

const HANDLE_SIZE = 28;
const MIN_CROP = 60;

export function initCropper(canvas, base64) {
  let image;
  let imgW = 0, imgH = 0;
  let stageW = 0, stageH = 0;
  let drawW = 0, drawH = 0, drawX = 0, drawY = 0;

  let crop = { x: 0, y: 0, w: 0, h: 0 };
  let drag = null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  const ctx = canvas.getContext('2d');

  const ready = new Promise((resolve, reject) => {
    image = new Image();
    image.onerror = () => reject(new Error('Could not load photo for cropping.'));
    image.onload = () => {
      imgW = image.naturalWidth;
      imgH = image.naturalHeight;
      layout();
      draw();
      resolve();
    };
    image.src = `data:image/jpeg;base64,${base64}`;
  });

  function layout() {
    const rect = canvas.getBoundingClientRect();
    stageW = rect.width;
    stageH = rect.height;
    canvas.width = Math.round(stageW * dpr);
    canvas.height = Math.round(stageH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = Math.min(stageW / imgW, stageH / imgH);
    drawW = imgW * scale;
    drawH = imgH * scale;
    drawX = (stageW - drawW) / 2;
    drawY = (stageH - drawH) / 2;

    // Default crop: centered 70%.
    const cw = drawW * 0.7;
    const ch = drawH * 0.7;
    crop = {
      x: drawX + (drawW - cw) / 2,
      y: drawY + (drawH - ch) / 2,
      w: cw,
      h: ch
    };
  }

  function draw() {
    ctx.clearRect(0, 0, stageW, stageH);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, stageW, stageH);
    ctx.drawImage(image, drawX, drawY, drawW, drawH);

    // Dim outside crop.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, stageW, crop.y);
    ctx.fillRect(0, crop.y, crop.x, crop.h);
    ctx.fillRect(crop.x + crop.w, crop.y, stageW - (crop.x + crop.w), crop.h);
    ctx.fillRect(0, crop.y + crop.h, stageW, stageH - (crop.y + crop.h));

    // Crop border.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

    // Rule-of-thirds guides.
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const vx = crop.x + (crop.w / 3) * i;
      const hy = crop.y + (crop.h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(vx, crop.y);
      ctx.lineTo(vx, crop.y + crop.h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(crop.x, hy);
      ctx.lineTo(crop.x + crop.w, hy);
      ctx.stroke();
    }

    // Corner handles.
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of corners()) {
      ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }
  }

  function corners() {
    return [
      [crop.x, crop.y],
      [crop.x + crop.w, crop.y],
      [crop.x, crop.y + crop.h],
      [crop.x + crop.w, crop.y + crop.h]
    ];
  }

  function hitHandle(px, py) {
    const cs = corners();
    const names = ['nw', 'ne', 'sw', 'se'];
    for (let i = 0; i < cs.length; i++) {
      const [cx, cy] = cs[i];
      if (Math.abs(px - cx) <= HANDLE_SIZE && Math.abs(py - cy) <= HANDLE_SIZE) {
        return names[i];
      }
    }
    return null;
  }

  function hitBody(px, py) {
    return px > crop.x && px < crop.x + crop.w && py > crop.y && py < crop.y + crop.h;
  }

  function clampCrop(c) {
    c.x = Math.max(drawX, Math.min(c.x, drawX + drawW - c.w));
    c.y = Math.max(drawY, Math.min(c.y, drawY + drawH - c.h));
    c.w = Math.max(MIN_CROP, Math.min(c.w, drawW));
    c.h = Math.max(MIN_CROP, Math.min(c.h, drawH));
    if (c.x + c.w > drawX + drawW) c.w = drawX + drawW - c.x;
    if (c.y + c.h > drawY + drawH) c.h = drawY + drawH - c.y;
    return c;
  }

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches?.[0] || e;
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top
    };
  }

  function onDown(e) {
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    const handle = hitHandle(x, y);
    if (handle) {
      drag = { kind: 'handle', handle, startX: x, startY: y, startCrop: { ...crop } };
    } else if (hitBody(x, y)) {
      drag = { kind: 'body', startX: x, startY: y, startCrop: { ...crop } };
    }
  }

  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const s = drag.startCrop;

    let next = { ...s };
    if (drag.kind === 'body') {
      next.x = s.x + dx;
      next.y = s.y + dy;
    } else {
      if (drag.handle.includes('n')) { next.y = s.y + dy; next.h = s.h - dy; }
      if (drag.handle.includes('s')) { next.h = s.h + dy; }
      if (drag.handle.includes('w')) { next.x = s.x + dx; next.w = s.w - dx; }
      if (drag.handle.includes('e')) { next.w = s.w + dx; }
    }
    crop = clampCrop(next);
    draw();
  }

  function onUp() {
    drag = null;
  }

  canvas.addEventListener('touchstart', onDown, { passive: false });
  canvas.addEventListener('touchmove', onMove, { passive: false });
  canvas.addEventListener('touchend', onUp);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  const resizeObs = new ResizeObserver(() => {
    if (!imgW) return;
    layout();
    draw();
  });
  resizeObs.observe(canvas);

  async function getCrop(quality = 0.85) {
    await ready;
    // Map crop rect (in display coords) back to image pixels.
    const scale = imgW / drawW;
    const sx = Math.max(0, Math.round((crop.x - drawX) * scale));
    const sy = Math.max(0, Math.round((crop.y - drawY) * scale));
    const sw = Math.min(imgW - sx, Math.round(crop.w * scale));
    const sh = Math.min(imgH - sy, Math.round(crop.h * scale));

    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const octx = out.getContext('2d');
    octx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

    return new Promise((resolve, reject) => {
      if (out.toBlob) {
        out.toBlob(async (blob) => {
          if (!blob) return reject(new Error('Could not export crop.'));
          const base64 = await blobToBase64(blob);
          resolve({ base64, blob, width: sw, height: sh });
        }, 'image/jpeg', quality);
      } else {
        const dataUrl = out.toDataURL('image/jpeg', quality);
        const b64 = dataUrl.split(',')[1];
        resolve({ base64: b64, blob: dataUrlToBlob(dataUrl), width: sw, height: sh });
      }
    });
  }

  function destroy() {
    canvas.removeEventListener('touchstart', onDown);
    canvas.removeEventListener('touchmove', onMove);
    canvas.removeEventListener('touchend', onUp);
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    resizeObs.disconnect();
  }

  return { ready, getCrop, destroy };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Encode failed.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
