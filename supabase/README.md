# Catalog setup (one-time)

The public catalog is backed by a fresh Supabase project. The whole setup is
done from the Supabase dashboard on your phone — no terminal needed.

## 1. Create the project

1. Go to https://supabase.com → **New project**.
2. Pick a region close to your users, set a strong DB password, free tier.
3. Wait for provisioning to finish.

## 2. Create the storage bucket

1. **Storage** → **New bucket**.
2. Name: `catalog-thumbnails`
3. Toggle **Public bucket** ON.
4. Save.

## 3. Run the schema

1. **SQL editor** → **New query**.
2. Paste the contents of `supabase/schema.sql` from this repo.
3. Run.

This creates the `catalog_scans` table, indexes, RLS policies, and the read
policy on the storage bucket.

## 4. Grab the keys

1. **Project settings** → **API**.
2. Copy:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **`anon` public key** (long JWT)
   - **`service_role` secret key** (long JWT) — **never expose this client-side**

## 5. Add the keys to Vercel

In the Vercel dashboard for FooLab → **Settings → Environment Variables** add:

| Name | Value | Scope |
|---|---|---|
| `SUPABASE_URL` | the Project URL | Production + Preview |
| `SUPABASE_ANON_KEY` | the anon JWT | Production + Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role JWT | Production + Preview |

Redeploy. That's it — `/api/config` will surface the URL + anon key to the
client, and `/api/publish` will use the service-role key server-side to write
on behalf of users.

## 6. (Optional) Mirror to Netlify

If you also deploy on Netlify, set the same three env vars there.

## How dedup works

When a user opts in to publish a scan:

1. Server normalises a `product_key` from `brand` + `productName`.
2. Server queries existing rows with the same `product_key`.
3. If none → insert.
4. If one or more → ask Gemini whether the new scan is:
   - the **same regional variant** (same recipe) → keep the higher-confidence
     row, bump `scan_count`;
   - a **different regional variant** (e.g. EU vs US recipe) → insert as a new
     row with the same `product_key` but different `region`;
   - a **different product** → insert as a new row.

Scans with `notReadable: true` or `confidence < 0.5` are dropped before the
dedup step.

## Resetting

To wipe the catalog without recreating the project:

```sql
truncate table catalog_scans;
```

To also drop thumbnails: in Storage UI, select all in `catalog-thumbnails` and
delete.
