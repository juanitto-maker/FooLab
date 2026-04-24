# FooLab 🧪

AI-powered food & drink label scanner. Point your phone at a product's ingredients list in the supermarket — get an instant NutriScore grade plus red-flag alerts for palm oil, excess sugar, artificial colors, and controversial E-numbers.

## Features

- 📷 Native camera capture with post-capture crop for tiny label text
- 🔬 Gemini 2.5 Flash vision reads ingredients + nutrition facts
- 🏷️ NutriScore A–E letter grade + 0–100 health score
- 🚩 Red-flag chips: palm oil, trans fats, high sugar/salt, Southampton-six colors, controversial additives, allergens
- 📚 Local archive of last 50 scans (IndexedDB — private, no account)
- 🎴 One-tap share: exports result as a PNG card via Android share sheet
- 📱 PWA + APK — installable, works offline for archive browsing
- 🔒 Zero tracking. No backend database in v1. Only the photo being analyzed leaves your device.

## Tech Stack

- Frontend: vanilla HTML/CSS/JS (no build step)
- Backend: a single `/api/scan` endpoint. Core logic lives in `lib/scan-core.js` and is reused by thin adapters for Vercel (`api/scan.js`) and Netlify (`netlify/functions/scan.js`).
- AI: Google Gemini 2.5 Flash (vision)
- Storage: IndexedDB (swappable to Supabase later)
- APK: GitHub Actions + PWA-to-APK pipeline (Bubblewrap TWA)

## Deploy

Pick one host. Both use the same `/api/scan` URL from the client's perspective.

### Option A — Vercel

1. Fork this repo on GitHub
2. Vercel → New Project → Import repo
3. Add env vars in Vercel dashboard:
   - `GEMINI_API_KEY` (required) — get one from https://aistudio.google.com/apikey
   - `PUBLIC_APP_URL` (optional) — sent as `Referer` to Gemini, e.g. `https://foolab.vercel.app`
4. Deploy. `vercel.json` sets a 30 s function timeout.

### Option B — Netlify

1. Fork this repo on GitHub
2. Netlify → Add new site → Import from Git
3. Build settings come from `netlify.toml` (publish `public/`, functions in `netlify/functions`)
4. Add env vars in Site settings → Environment variables:
   - `GEMINI_API_KEY` (required)
   - `PUBLIC_APP_URL` (optional)
5. Deploy. `netlify.toml` rewrites `/api/*` → `/.netlify/functions/:splat`.

Note: sync Netlify Functions on the Free plan have a 10 s timeout. A Gemini call on three large photos can occasionally exceed that — shrink `MAX_IMAGES` in `lib/scan-core.js` or upgrade the plan if you see sporadic 502s.

### Android APK (optional)

The workflow at `.github/workflows/android-apk.yml` is a placeholder that wraps the deployed PWA as a TWA via [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). Before enabling it, add these secrets to the GitHub repo (Settings → Secrets and variables → Actions):
- `ANDROID_KEYSTORE_BASE64` — base64-encoded `.jks` file
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Then run the workflow manually (Actions → **Build Android APK** → Run workflow) and pass your deployed PWA URL as input. The signed APK is uploaded as an Actions artifact.

## Usage

1. Open FooLab
2. Tap **Scan a label** — take a clear photo of the ingredients list (tap to focus, get close)
3. Drag the crop box tight around the label text, tap **Analyze**
4. Read the NutriScore + red flags
5. Tap **Save** to archive or **Share** for a PNG card

## Project Structure

```
foolab/
├── api/
│   ├── scan.js              # Vercel serverless adapter → runScan()
│   └── prompt.js            # Gemini prompt exported from PROMPT.md
├── lib/
│   └── scan-core.js         # Framework-neutral scan pipeline (shared)
├── netlify/
│   └── functions/
│       └── scan.js          # Netlify Functions adapter → runScan()
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                # PWA service worker, cache-first
│   ├── css/styles.css
│   ├── icons/               # logo.svg + 192/512 PNG icons
│   ├── data/
│   │   └── enumbers.json    # Curated E-number reference DB
│   └── js/
│       ├── app.js           # screen router + wiring
│       ├── camera.js        # capture + compress
│       ├── cropper.js       # drag-corner crop
│       ├── storage.js       # IndexedDB wrapper
│       ├── scorecard.js     # result card rendering
│       ├── additives.js     # E-number lookup + chronic-condition helpers
│       ├── archive.js       # list + detail
│       └── cardexport.js    # PNG export + share
├── .github/workflows/android-apk.yml
├── netlify.toml             # Netlify build + /api/* rewrite
├── vercel.json              # Vercel function config (30 s timeout)
├── package.json
├── CLAUDE.md                # dev brief for Claude Code
├── PROMPT.md                # Gemini prompt (source of truth)
└── README.md
```

## Privacy

- Photos are sent to Google's Gemini API for analysis. Google's API terms apply to that single request.
- Everything else (archive, notes) stays on your device in IndexedDB.
- No analytics, no tracking, no account needed.

## Roadmap

- Optional Supabase sync for cross-device archive
- Multi-language UI (ES, DE, IT) — prompt already supports it
- Barcode fallback via OpenFoodFacts when a label is unreadable
- "Compare two products" side-by-side view
- Personal dietary filters (vegan, halal, gluten-free, allergen profile)

## Disclaimer

FooLab is an informational tool. Scores are based on visible label data and published guidelines (NutriScore, EFSA reviews). It is not medical advice. Consult a doctor or nutritionist for dietary decisions.

Built with [Claude](https://claude.com) by [digitalAIventures LLC](https://digitalaiventures.com).
