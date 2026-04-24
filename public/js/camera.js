// Photo capture pipeline — camera + gallery + JPEG compression.
// Based on LMA's compressImage, bumped to 1600px so Gemini can read
// ingredient text clearly.

const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 0.85;

export function openCamera(onFile) {
  const input = document.getElementById('cameraInput');
  const handler = (e) => {
    const file = e.target.files?.[0];
    input.value = '';
    input.removeEventListener('change', handler);
    if (file) onFile(file);
  };
  input.addEventListener('change', handler);
  input.click();
}

export function openGallery(onFile) {
  const input = document.getElementById('galleryInput');
  const handler = (e) => {
    const file = e.target.files?.[0];
    input.value = '';
    input.removeEventListener('change', handler);
    if (file) onFile(file);
  };
  input.addEventListener('change', handler);
  input.click();
}

// Compress a File to a base64 JPEG string (no data: prefix) plus its Blob.
// Returns { base64, blob, width, height }.
export function compressImage(file, maxWidth = DEFAULT_MAX_WIDTH, quality = DEFAULT_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read photo file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode photo.'));
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Prefer toBlob — some older Android browsers ignore toDataURL mime hints.
        if (canvas.toBlob) {
          canvas.toBlob(async (blob) => {
            if (!blob) return reject(new Error('Could not compress photo.'));
            const base64 = await blobToBase64(blob);
            resolve({ base64, blob, width: w, height: h });
          }, 'image/jpeg', quality);
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const base64 = dataUrl.split(',')[1];
          const blob = dataUrlToBlob(dataUrl);
          resolve({ base64, blob, width: w, height: h });
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Reads a Blob and returns its base64 (no data: prefix).
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not encode image.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve(String(dataUrl).split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
