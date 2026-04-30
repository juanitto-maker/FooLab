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

export async function searchCatalog({ q = '', kind = null, nutriScore = [],
  avoidFlags = [], sort = 'recent', limit = PAGE_SIZE, offset = 0 } = {}) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl) return { rows: [], total: 0 };

  // PostgREST takes repeated keys as AND, so we hand-build the query string
  // to allow multiple `red_flags=not.cs.<...>` clauses.
  const parts = [];
  parts.push('select=id,product_name,brand,kind,nutri_score,health_score,summary,red_flags,thumbnail_path,scan_count,updated_at,region');

  if (q.trim()) {
    const term = q.trim().replace(/[(),]/g, ' ');
    parts.push(`or=(product_name.ilike.*${encodeURIComponent(term)}*,brand.ilike.*${encodeURIComponent(term)}*)`);
  }
  if (kind === 'food' || kind === 'drink') {
    parts.push(`kind=eq.${kind}`);
  }
  if (Array.isArray(nutriScore) && nutriScore.length > 0) {
    parts.push(`nutri_score=in.(${nutriScore.join(',')})`);
  }
  if (Array.isArray(avoidFlags)) {
    for (const flag of avoidFlags) {
      // jsonb not contains — exclude rows whose red_flags array contains this type.
      parts.push(`red_flags=not.cs.${encodeURIComponent(`[{"type":"${flag}"}]`)}`);
    }
  }

  if (sort === 'popular') parts.push('order=scan_count.desc,updated_at.desc');
  else if (sort === 'best') parts.push('order=nutri_score.asc,scan_count.desc');
  else parts.push('order=updated_at.desc');

  const url = `${cfg.supabaseUrl}/rest/v1/${TABLE}?${parts.join('&')}`;
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
    throw new Error(friendlyRestError(res.status, text));
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

function friendlyRestError(status, body) {
  // PGRST205 = relation not found. Most likely the schema SQL hasn't been
  // run yet, or PostgREST hasn't reloaded its schema cache after the table
  // was created.
  const looksLikeMissingTable = /PGRST205|catalog_scans|schema cache/i.test(body || '');
  if (status === 404 && looksLikeMissingTable) {
    return 'Catalog isn\'t set up yet. In Supabase: run supabase/schema.sql, then Project Settings → Data API → Reload schema cache.';
  }
  if (status === 401 || status === 403) {
    return 'Catalog auth failed — check that SUPABASE_ANON_KEY matches the project URL.';
  }
  if (status >= 500) {
    return 'Catalog is unreachable right now. Try again in a moment.';
  }
  return `Catalog search failed (${status}).`;
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
