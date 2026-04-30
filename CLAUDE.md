# FooLab — Developer Brief

Context document for Claude Code sessions working on this repo. Read this before touching any code.

## Purpose

FooLab is an AI-powered food/drink label scanner. A user photographs a product label in a supermarket; the app returns a NutriScore A–E grade plus red-flag alerts (palm oil, high sugar, artificial colors, controversial E-numbers, etc.).

Target user: health-conscious shopper. Target device: **Android phone**. Developer works Android-only with no terminal — all edits come through Claude Code sessions.

## Design Decisions (locked — do not change without confirmation)

| Item | Decision |
|---|---|
| App name | FooLab |
| Scoring | NutriScore A–E + 0–100 score + red-flag chips |
| Languages v1 | EN only (prompt supports ES/DE/IT easily later) |
| Capture | Native camera (`<input capture="environment">`) + post-capture crop |
| Storage v1 | IndexedDB only, rolling cap 50 scans (no Supabase) |
| Storage v2 | IndexedDB stays primary. **Public catalog** mirrors saved scans to Supabase only when the user opts in via the "Let the world know about your finding" toggle. App must work fully when Supabase env vars are absent. |
| Sharing | PNG card via Web Share API + download fallback |
| Stack | Vanilla HTML/CSS/JS, no build, Vercel serverless, Gemini 2.5 Flash |
| Model ID | Exactly `gemini-2.5-flash` — never alter |
| APK | GitHub Actions, reuse existing keystore secrets |

## File Responsibilities

### Backend

**`lib/scan-core.js`** — framework-neutral scan pipeline. Exports `runScan({ images, language, geminiApiKey, publicAppUrl })` returning `{ status, body }`.
- Validates `images` (1–3 accepted, empty → 400) and env (`GEMINI_API_KEY` missing → 500)
- Calls Gemini 2.5 Flash with inline image parts + prompt imported from `api/prompt.js`
- Retries x2 on 429 / 503 with exponential backoff (2 s, 4 s)
- Parses + validates the JSON response; missing required keys → 500 with "AI returned an invalid response, please retry."
- Rate-limit classifier distinguishes per-minute vs per-day quota from Gemini error details
- `PUBLIC_APP_URL` (optional) is sent as `Referer` to Gemini

**`api/scan.js`** — thin Vercel adapter. `POST` only. Reads `req.body`, delegates to `runScan`, returns `res.status(...).json(...)`. Body limit 5 MB via `config.api.bodyParser`.

**`netlify/functions/scan.js`** — thin Netlify Functions adapter. Same contract; parses `event.body` as JSON and returns `{ statusCode, headers, body: JSON.stringify(...) }`. `netlify.toml` rewrites `/api/*` → `/.netlify/functions/:splat`, so the client URL is `/api/scan` on either host.

**`api/prompt.js`** — exports the prompt string from `PROMPT.md` as a JS template literal. Keep these two files in sync: PROMPT.md is the source of truth, prompt.js mirrors it.

**`lib/catalog-core.js`** — framework-neutral publish pipeline for the public catalog. Exports `runPublish({ result, thumbnailBase64, supabaseUrl, supabaseServiceKey, geminiApiKey, publicAppUrl })` returning `{ status, body }`.
- Drops scans with `notReadable: true`, `confidence` not in {medium, high}, or empty product name (returns 200 with `{ action: 'skipped', reason }`).
- Computes `product_key = normalise(brand + productName)`: lowercase, strip diacritics, hyphenate.
- Looks up existing rows with the same `product_key` via the Supabase wrapper.
- If none → insert new row + upload thumbnail.
- If some → asks Gemini 2.5 Flash to choose `merge_into | increment | insert_new`, accounting for regional recipe variants (EU vs US, etc.). On any Gemini error/timeout → falls back to `insert_new`.
- Returns `{ action: 'inserted' | 'merged' | 'incremented' | 'skipped', id }`.

**`lib/supabase.js`** — minimal `fetch`-based Supabase REST + Storage wrapper for server use. Always called with the service-role key (writes bypass RLS). Exports `makeSupabase({ url, serviceKey })` with `.select()`, `.insert()`, `.update()`, `.uploadThumbnail(bucket, path, base64Jpeg)`. Browser-side reads do NOT use this — they hit PostgREST directly with the anon key from `public/js/catalog.js`.

**`api/publish.js`** + **`netlify/functions/publish.js`** — thin adapters for `/api/publish`, mirroring the `scan.js` pattern. Body shape: `{ result: <scan JSON>, thumbnailBase64: <string|null> }`. Read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` from env.

**`api/config.js`** + **`netlify/functions/config.js`** — `GET /api/config` returns `{ supabaseUrl, supabaseAnonKey }` for the browser. Both values are public; surfacing them via an endpoint avoids hardcoding into `index.html` and lets keys be rotated without a redeploy. Cached `max-age=300`.

### Frontend

**`public/index.html`** — single-page app shell. All screens as `<section>` elements hidden/shown by `app.js`. Includes manifest link + SW registration.

**`public/js/app.js`** — screen router, global state, event wiring.
- Screens: `scan`, `crop`, `analyzing`, `result`, `archive`, `detail`, `catalog`, `catalog-detail`, `about`
- Holds `currentScan = { photos: [], cropped: null, result: null }` and `state.catalog = { enabled, query, nutriScore[], flag, sort, offset, rows, total }`
- On boot calls `catalog.isCatalogEnabled()` to show/hide the Catalog topbar button + landing CTA.
- On Save, if the publish toggle is on, fires `catalog.publishScan({ result, thumbnailBlob })` after the local IndexedDB write — failures only toast, never block the local save.
- Persists the publish toggle via `localStorage[foolab.publishToCatalog]` (default on).
- Delegates to module files — does not contain feature logic itself.

**`public/js/camera.js`** — photo capture pipeline.
- Wraps `<input type="file" accept="image/*" capture="environment">`
- Also `<input type="file" accept="image/*">` for gallery fallback
- `compressImage(file, maxWidth=1600, quality=0.85)` → base64 (no `data:` prefix)
- Higher maxWidth than LMA (1600 vs 800) because Gemini needs ingredient text readable
- Exports: `openCamera()`, `openGallery()`, `compressImage()`

**`public/js/cropper.js`** — drag-corner crop on HTML canvas.
- Loads base64 photo into canvas with 4 corner handles + draggable body
- Touch events (`touchstart/move/end`) primary for Android, mouse events as fallback
- Default crop starts at center 70% of image
- Exports: `initCropper(base64)` → `Promise<base64 of cropped region>`
- DPR-aware rendering so crops are crisp on high-DPI phones

**`public/js/catalog.js`** — public catalog client. Lazy-fetches `/api/config`, caches the result.
- Reads (`searchCatalog`, `getCatalogEntry`) hit Supabase PostgREST directly with the anon key — RLS allows public SELECT.
- `searchCatalog({ q, kind, nutriScore[], avoidFlags[], sort, limit, offset })` → `{ rows, total }`. `kind` is `'food'` | `'drink'` | `null` (all). `avoidFlags` is a list of `red_flags[].type` values to **exclude** (translates to repeated `red_flags=not.cs.<...>` PostgREST clauses, AND'd). Sort options: `recent` | `popular` | `best`. Uses `Range` + `Prefer: count=exact` for pagination + total.
- Translates PostgREST errors into actionable user copy — e.g. PGRST205 says "run supabase/schema.sql, then reload the schema cache".
- Writes (`publishScan({ result, thumbnailBlob })`) always go through `/api/publish` so the AI dedup runs server-side with the service-role key.
- Builds a 480×480 JPEG thumbnail (~30–50 KB) by centre-cropping the original photo before sending — keeps payload small and matches the catalog grid ratio.
- If `/api/config` is absent or returns nulls, `isCatalogEnabled()` returns false and the UI hides every catalog affordance.

**`public/js/storage.js`** — IndexedDB wrapper, storage-agnostic.
- DB name: `foolab`, version: `1`, store: `scans` (keyPath: `id`)
- Record shape: `{ id, timestamp, photos:[Blob], thumbnail:Blob, result:{}, userNote:"" }`
- API: `save(record)`, `get(id)`, `list({limit, offset})`, `delete(id)`, `clear()`, `count()`
- On `save()`: if count > 50, delete oldest by timestamp
- All methods Promise-based
- Swap to Supabase later = rewrite this file only; interface stays identical

**`public/js/additives.js`** — client-side E-number helpers. Lazy-loads `public/data/enumbers.json` once, caches the index, exposes `loadEnumbersDB()` and `lookupAdditive(db, code)`. Also surfaces chronic-condition warnings (diabetes, hypertension, PKU, sulfite sensitivity, etc.) via the `conditions` map. Pure functions, no storage, no API calls.

**`public/data/enumbers.json`** — curated E-number reference database. Entries follow the same `low/medium/high` concern rubric used elsewhere. Bump the `updated` field when adding entries.

**`public/js/scorecard.js`** — render result view.
- `renderScorecard(resultJSON, photoBlob, containerEl)`
- Giant NutriScore letter block, color-coded: A `#2e7d32`, B `#66bb6a`, C `#fdd835`, D `#fb8c00`, E `#c62828`
- Product name, brand, summary line
- Red-flag chip list with severity color (low `#fbc02d`, medium `#f57c00`, high `#c62828`)
- Expandable E-numbers list (tap each for details)
- Full ingredients section
- Nutrition table if data present
- Allergens list
- Confidence badge
- Save / Share / Rescan buttons wired by caller

**`public/js/archive.js`** — archive list + detail.
- Grid view: 2 columns on narrow screens, 3 on wider
- Each card: thumbnail + NutriScore letter + product name (truncated)
- Tap → detail screen (reuses `scorecard.renderScorecard` + delete button)
- Empty state when count = 0

**`public/js/cardexport.js`** — PNG card for sharing.
- `exportCard(scanRecord)` → `Promise<Blob>`
- 1080×1350 canvas (Instagram portrait friendly):
  - Top: product photo (cropped square)
  - Big NutriScore letter block with color
  - Product name + brand
  - Score line
  - Up to 4 red-flag chips
  - Footer: "Scanned with FooLab"
- Then `navigator.share({ files:[file] })` if available, else download via blob URL

## Visual Style

- Palette: off-white `#fafaf7` background, ink `#1a1a1a` text
- NutriScore: A `#2e7d32`, B `#66bb6a`, C `#fdd835`, D `#fb8c00`, E `#c62828`
- Red-flag severity: low `#fbc02d`, medium `#f57c00`, high `#c62828`
- Sans-serif system stack (`-apple-system, Segoe UI, Roboto, sans-serif`)
- Big type: min 16px body, 18px lists, 28px headings, NutriScore letter 120px
- Rounded corners 12px, shadows subtle, no gradients
- "Clinical but warm" — think Apple Health × a good pharmacy aisle. Explicitly NOT the psychedelic style of Love Me Again.

## UI Screens

1. **scan** — hero "Scan a label" camera button + secondary "Choose from gallery". Top bar carries the brand and icon buttons: Catalog (only when configured), Archive (with unread count badge), Share app, Install (shown only when `beforeinstallprompt` fires), About. Feature row, "Browse the public catalog" tile (only when configured), and tips card below.
2. **crop** — photo with draggable crop box, "+ Add another photo" (max 3), **Analyze** (primary)
3. **analyzing** — centered spinner + rotating tip text ("Reading ingredients…", "Checking E-numbers…")
4. **result** — scorecard + "Let the world know about your finding" toggle (only when catalog is configured + scan is publishable) + action row Save / Share / Rescan
5. **archive** — grid of scan cards, empty state CTA, back button
6. **detail** — scorecard + Delete (with confirm) + back
7. **catalog** — Food / All / Drinks segmented control, search input (placeholder narrows to the active tab), collapsible Filters disclosure (NutriScore "Keep" chips, multi-select "Avoid" chips for red-flag types, sort), public scan grid (reuses `.archive-card`), Load more button, empty state. Hidden entirely when Supabase env vars aren't set.
8. **catalog-detail** — shared scorecard rendering + meta line (`Scanned N times · Region: …`) + back to catalog.

All transitions: just show/hide sections. No animations in v1 (snappy on low-end Android).

## API Contract

### Request
```
POST /api/scan
Content-Type: application/json

{
  "images": ["base64str1", "base64str2"],   // 1-3 images, no data: prefix
  "language": "en"                           // v1 always "en"
}
```

### Success (200)
Full schema in `PROMPT.md`. Brief:
```
{ productName, brand, nutriScore, healthScore, summary,
  ingredients, eNumbers, redFlags, nutrition, allergens,
  confidence, notReadable, tips }
```

### Errors
- 400 — bad input / unprocessable image. Body `{error:"..."}`
- 429 — Gemini rate limit. Body `{error:"Daily AI quota exhausted..."}`
- 500 — unexpected. Body `{error:"..."}`

Client surfaces `error` message directly to user.

### Catalog endpoints

```
POST /api/publish
Content-Type: application/json

{
  "result": { /* the same JSON shape that /api/scan returns */ },
  "thumbnailBase64": "..."   // optional, ~480px square JPEG, no data: prefix
}

→ 200 { action: "inserted" | "merged" | "incremented" | "skipped", id?, reason? }
→ 400 { error: "Missing scan result." }
→ 500 { error: "..." }
```

```
GET /api/config
→ 200 { supabaseUrl: string|null, supabaseAnonKey: string|null }
```

Browser reads of the catalog go directly to `${supabaseUrl}/rest/v1/catalog_scans` with the anon key — no FooLab endpoint involved. RLS policy allows anon SELECT only.

### Supabase schema

`supabase/schema.sql` is the source of truth. Setup steps live in `supabase/README.md`. Key fields on `catalog_scans`:

- `product_key` — normalised brand+name, used for dedup grouping
- `region` — optional ISO-style hint when AI dedup detects a regional variant
- `kind` — `'food'` | `'drink'`, derived server-side from the AI's `category` field (PROMPT.md enum: `drink|solid|snack|dairy|meat|baked|frozen|condiment|other`) plus a productName keyword fallback. Drives the catalog tabs.
- `scan_count` — bumped each time a duplicate is detected
- `thumbnail_path` — object key in the `catalog-thumbnails` public bucket
- `red_flags`, `e_numbers`, `ingredients`, `nutrition`, `allergens` — `jsonb`, mirror the scan JSON

Required env vars (all three needed for the catalog to be active):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only — never returned by `/api/config`)

## Gemini Integration

- Model ID: **exactly** `gemini-2.5-flash` (never `gemini-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`, etc.)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$KEY`
- Inline image format: `{ inlineData: { mimeType: "image/jpeg", data: base64 } }`
- Prompt text imported from `api/prompt.js` — never inline in `scan.js`
- Response parsing: strip ```` ```json ```` fences, `JSON.parse`, validate required keys, return
- On parse failure: log raw response first 500 chars, return 500 with "AI returned invalid response, please retry."

## Conventions

- **No build step.** All JS runs directly in browser. ES modules OK (`<script type="module">`) — modern Android Chrome supports it.
- **Vanilla JS only.** No React/Vue/frameworks in v1. Total payload target < 500 KB.
- **Server-side**: ESM or CJS — pick one consistently via `package.json` `"type"` and stick with it across `api/*.js`.
- **Env vars**: never in `.env` committed to the repo. Vercel dashboard only.
- **Zero npm deps** for client side. Server side: zero deps in v1 (plain `fetch` only).
- **Error messages** are user-facing; keep them friendly and actionable.

## Mobile / Android Constraints

- Developer is Android-only, no terminal. All edits via Claude Code sessions (on VPS or Termux).
- Prefer small focused files so scoped edits ("fix the cropper") touch one file.
- When generating code chunks for find-and-replace, prefer anchored snippets over full-file replacements. Full-file only when changes are scattered.
- APK built remotely via GitHub Actions, never locally.
- Reference existing developer skills: `here-now`, `pwa-to-android-apk`, `api-protocol`, `visualization`.

## Testing

Manual only in v1 (no test framework). Verify before each deploy:

1. Clear front-of-pack photo → product name + nutrition extracted
2. Close-up of ingredients list → E-numbers flagged correctly
3. Blurry / dark photo → returns `notReadable:true` with retry suggestion
4. Non-food photo (e.g. a cat) → returns `notReadable:true`
5. Archive → save 51 items → oldest auto-deleted
6. Share button → PNG generated, share sheet opens on Android
7. Offline → archive still loads, scan shows offline error
8. Catalog opt-in (Supabase configured): save with toggle on → row appears in catalog grid; second user scanning the same product → existing row's scan count goes up (or AI splits into a regional variant)
9. Catalog opt-in (Supabase env vars empty): topbar Catalog button hidden, landing CTA hidden, publish toggle hidden — app behaves exactly as v1

## Known Gotchas

- **`capture="environment"` on Android Chrome**: opens camera reliably, but on some OEM browsers (Samsung Internet, MIUI) behaves like a gallery picker. Always provide an explicit separate "Gallery" input as fallback.
- **Canvas `toDataURL('image/jpeg', q)` on older Android**: some devices return PNG regardless. Use `toBlob` with explicit `image/jpeg` when available.
- **IndexedDB on Android Firefox Focus / Brave strict mode**: may be disabled. Wrap open in `try/catch` and surface a friendly message.
- **Gemini rate limits**: 15 req/min, 1500/day on free tier. Surface these clearly via the classifier.
- **Base64 payload size**: 1600 px JPEG @ 0.85 ≈ 200–400 KB base64. Three images ≈ 1 MB. Vercel body limit 4.5 MB → fine but watch it.

## Out of Scope for v1 (Roadmap)

- Per-user Supabase sync (private archive in the cloud) — the public catalog is shared, but private scans stay in IndexedDB
- User accounts
- Additional UI languages
- Barcode lookup / OpenFoodFacts fallback
- Product comparison
- Personal diet profile filters
- Push notifications
- Meal history / trend analytics
- Catalog moderation queue / report-flag UI for inappropriate entries
- **Bring-your-own Gemini API key**: each user gets a small quota of trial scans on the shared app key, then is prompted to paste their own Gemini API key (🔑 icon in header) to keep using the app. Key stored in `localStorage` on-device only, sent per-request to `api/scan.js`, which prefers it over the shared env key. Modal includes a "How to get a key" link to Google AI Studio (`https://aistudio.google.com/apikey`) and a short tutorial for AI newcomers. Trial counter tracked in `localStorage` (cheat-able, but acceptable for honor-system beta).

## References

- Architecture precedent: `love_me_again-main` — specifically `api/analyze.js` (Gemini call pattern, error classifier), `public/js/app.js` (`compressImage`), `public/volunteer.html` (capture input)
- NutriScore official method: https://nutriscore.ca/
- Southampton six colors: E102, E104, E110, E122, E124, E129
- Gemini API docs: https://ai.google.dev/api
