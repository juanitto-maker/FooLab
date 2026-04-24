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
| Storage v2 | Optional Supabase sync — must not break v1 |
| Sharing | PNG card via Web Share API + download fallback |
| Stack | Vanilla HTML/CSS/JS, no build, Vercel serverless, Gemini 2.5 Flash |
| Model ID | Exactly `gemini-2.5-flash` — never alter |
| APK | GitHub Actions, reuse existing keystore secrets |

## File Responsibilities

### Backend

**`api/scan.js`** — single Vercel serverless endpoint.
- `POST` with `{ images: [base64], language: "en" }`
- Calls Gemini 2.5 Flash with inline image parts + prompt imported from `api/prompt.js`
- Returns parsed JSON matching the schema in `PROMPT.md`
- Retries x2 on 429 / 503 with exponential backoff
- Rate-limit classification returns human-friendly message (reuse pattern from LMA `analyze.js`)
- Env: `GEMINI_API_KEY` (required)

**`api/prompt.js`** — exports the prompt string from `PROMPT.md` as a JS template literal. Keep these two files in sync: PROMPT.md is the source of truth, prompt.js mirrors it.

### Frontend

**`public/index.html`** — single-page app shell. All screens as `<section>` elements hidden/shown by `app.js`. Includes manifest link + SW registration.

**`public/js/app.js`** — screen router, global state, event wiring.
- Screens: `scan`, `crop`, `analyzing`, `result`, `archive`, `detail`
- Holds `currentScan = { photos: [], cropped: null, result: null }`
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

**`public/js/storage.js`** — IndexedDB wrapper, storage-agnostic.
- DB name: `foolab`, version: `1`, store: `scans` (keyPath: `id`)
- Record shape: `{ id, timestamp, photos:[Blob], thumbnail:Blob, result:{}, userNote:"" }`
- API: `save(record)`, `get(id)`, `list({limit, offset})`, `delete(id)`, `clear()`, `count()`
- On `save()`: if count > 50, delete oldest by timestamp
- All methods Promise-based
- Swap to Supabase later = rewrite this file only; interface stays identical

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

1. **scan** — hero camera button (📷 + label), secondary "🖼 Gallery", header links "📚 Archive (N)" + "ℹ About", tips card below
2. **crop** — photo with draggable crop box, "+ Add another photo" (max 3), **Analyze** (primary)
3. **analyzing** — centered spinner + rotating tip text ("Reading ingredients…", "Checking E-numbers…")
4. **result** — scorecard + action row Save / Share / Rescan
5. **archive** — grid of scan cards, empty state CTA, back button
6. **detail** — scorecard + Delete (with confirm) + back

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

## Known Gotchas

- **`capture="environment"` on Android Chrome**: opens camera reliably, but on some OEM browsers (Samsung Internet, MIUI) behaves like a gallery picker. Always provide an explicit separate "Gallery" input as fallback.
- **Canvas `toDataURL('image/jpeg', q)` on older Android**: some devices return PNG regardless. Use `toBlob` with explicit `image/jpeg` when available.
- **IndexedDB on Android Firefox Focus / Brave strict mode**: may be disabled. Wrap open in `try/catch` and surface a friendly message.
- **Gemini rate limits**: 15 req/min, 1500/day on free tier. Surface these clearly via the classifier.
- **Base64 payload size**: 1600 px JPEG @ 0.85 ≈ 200–400 KB base64. Three images ≈ 1 MB. Vercel body limit 4.5 MB → fine but watch it.

## Out of Scope for v1 (Roadmap)

- Supabase sync
- User accounts
- Additional UI languages
- Barcode lookup / OpenFoodFacts fallback
- Product comparison
- Personal diet profile filters
- Push notifications
- Meal history / trend analytics

## References

- Architecture precedent: `love_me_again-main` — specifically `api/analyze.js` (Gemini call pattern, error classifier), `public/js/app.js` (`compressImage`), `public/volunteer.html` (capture input)
- NutriScore official method: https://nutriscore.ca/
- Southampton six colors: E102, E104, E110, E122, E124, E129
- Gemini API docs: https://ai.google.dev/api
