// Tiny Supabase REST + Storage wrapper for server-side use. Avoids pulling in
// the supabase-js SDK so we keep the zero-deps rule from CLAUDE.md.
//
// Always called with the service-role key (writes bypass RLS). For reads
// from the client we let the browser hit PostgREST directly with the anon
// key — see public/js/catalog.js.

export function makeSupabase({ url, serviceKey }) {
  if (!url || !serviceKey) {
    throw new Error('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).');
  }
  const base = url.replace(/\/+$/, '');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };

  async function rest(path, init = {}) {
    const res = await fetch(`${base}/rest/v1${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) }
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const err = new Error(`Supabase ${res.status}: ${data?.message || text}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    select(table, params = {}) {
      const qs = new URLSearchParams(params).toString();
      return rest(`/${table}?${qs}`, { method: 'GET' });
    },
    insert(table, row, { returning = 'representation' } = {}) {
      return rest(`/${table}`, {
        method: 'POST',
        headers: { Prefer: `return=${returning}` },
        body: JSON.stringify(row)
      });
    },
    update(table, params, patch) {
      const qs = new URLSearchParams(params).toString();
      return rest(`/${table}?${qs}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(patch)
      });
    },
    async uploadThumbnail(bucket, path, base64Jpeg) {
      const buf = Uint8Array.from(atob(base64Jpeg), (c) => c.charCodeAt(0));
      const res = await fetch(
        `${base}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'image/jpeg',
            'x-upsert': 'true'
          },
          body: buf
        }
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Storage upload failed (${res.status}): ${t}`);
      }
      return path;
    }
  };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
