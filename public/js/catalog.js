// Public-catalog client. Reads run directly against Supabase PostgREST with
// the anon key (public read is the only allowed operation by RLS). Writes
// always go through /api/publish so the AI dedup step can run server-side
// with the service-role key.

const PAGE_SIZE = 24;
const TABLE = 'catalog_scans';

let configPromise = null;

async function getConfig() {
  if (configPromise) return configPromise;
  configPromise = fetch('/api/config')
    .then((r) => (r.ok ? r.json() : { supabaseUrl: null, supabaseAnonKey: null }))
    .catch(() => ({ supabaseUrl: null, supabaseAnonKey: null }));
  return configPromise;
}

export async function isCatalogEnabled() {
  const c = await getConfig();
  return Boolean(c.supabaseUrl && c.supabaseAnonKey);
}

// ---- Read --------------------------------------------------------------

export async function searchCatalog({ q = '', nutriScore = [], flag = null,
  sort = 'recent', limit = PAGE_SIZE, offset = 0 } = {}) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl) return { rows: [], total: 0 };

  const params = new URLSearchParams();
  params.set('select', 'id,product_name,brand,nutri_score,health_score,summary,red_flags,thumbnail_path,scan_count,updated_at,region');

  if (q.trim()) {
    const term = q.trim().replace(/[(),]/g, ' ');
    params.set('or', `(product_name.ilike.*${term}*,brand.ilike.*${term}*)`);
  }
  if (Array.isArray(nutriScore) && nutriScore.length > 0) {
    params.set('nutri_score', `in.(${nutriScore.join(',')})`);
  }
  if (flag) {
    // jsonb contains: red_flags @> '[{"type": "palmOil"}]'
    params.set('red_flags', `cs.[{"type":"${flag}"}]`);
  }

  if (sort === 'popular') params.set('order', 'scan_count.desc,updated_at.desc');
  else if (sort === 'best') params.set('order', 'nutri_score.asc,scan_count.desc');
  else params.set('order', 'updated_at.desc');

  const url = `${cfg.supabaseUrl}/rest/v1/${TABLE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      Range: `${offset}-${offset + limit - 1}`,
      'Range-Unit': 'items',
      Prefer: 'count=exact'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Catalog search failed (${res.status}): ${text}`);
  }

  const rows = await res.json();
  const total = parseTotalFromContentRange(res.headers.get('Content-Range'));
  return { rows: rows.map(rowToCard), total };
}

export async function getCatalogEntry(id) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl) return null;
  const url = `${cfg.supabaseUrl}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`
    }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  if (!rows || rows.length === 0) return null;
  return rowToCard(rows[0]);
}

export function thumbnailUrl(path) {
  // Public storage URL pattern. Supabase exposes objects in public buckets
  // at /storage/v1/object/public/<bucket>/<path>.
  if (!path) return null;
  // We may be called before getConfig resolves — return a function-like
  // promise-resolving accessor to keep callers simple by always going async.
  return getConfig().then((cfg) => {
    if (!cfg.supabaseUrl) return null;
    return `${cfg.supabaseUrl}/storage/v1/object/public/catalog-thumbnails/${encodeURIComponent(path)}`;
  });
}

function rowToCard(row) {
  return {
    id: row.id,
    productName: row.product_name,
    brand: row.brand,
    nutriScore: row.nutri_score,
    healthScore: row.health_score,
    summary: row.summary,
    ingredients: row.ingredients || [],
    eNumbers: row.e_numbers || [],
    redFlags: row.red_flags || [],
    nutrition: row.nutrition || null,
    allergens: row.allergens || [],
    confidence: row.confidence,
    thumbnailPath: row.thumbnail_path,
    region: row.region,
    scanCount: row.scan_count,
    updatedAt: row.updated_at
  };
}

function parseTotalFromContentRange(header) {
  // Format: "0-23/142"
  if (!header) return null;
  const m = /\/(\d+)$/.exec(header);
  return m ? Number(m[1]) : null;
}

// ---- Write -------------------------------------------------------------

export async function publishScan({ result, thumbnailBlob }) {
  if (!(await isCatalogEnabled())) return { action: 'skipped', reason: 'no_config' };

  let thumbnailBase64 = null;
  if (thumbnailBlob instanceof Blob) {
    try {
      thumbnailBase64 = await blobToCatalogThumb(thumbnailBlob);
    } catch (err) {
      console.warn('Could not prepare thumbnail:', err);
    }
  }

  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ result, thumbnailBase64 })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Publish failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Downscale + crop to a 480px square JPEG. Keeps payload small (~30-50 KB)
// and matches the catalog grid display ratio.
async function blobToCatalogThumb(blob) {
  const bitmap = await createImageBitmap(blob);
  const SIZE = 480;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);

  const out = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.82);
  });
  const buf = await out.arrayBuffer();
  // base64 without the data: prefix — matches /api/scan convention.
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
