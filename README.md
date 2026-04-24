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
- Backend: one Vercel serverless function (`/api/scan.js`)
- AI: Google Gemini 2.5 Flash (vision)
- Storage: IndexedDB (swappable to Supabase later)
- APK: GitHub Actions + PWA-to-APK pipeline

## Deploy

### 1. Vercel (hosting + serverless API)

1. Fork this repo on GitHub
2. Vercel → New Project → Import repo
3. Add env var in Vercel dashboard:
   - `GEMINI_API_KEY` — get one from https://aistudio.google.com/apikey
4. Deploy. That's it.

### 2. Android APK (optional)

Add these secrets to the GitHub repo (Settings → Secrets and variables → Actions):
- `KEYSTORE_BASE64` — base64-encoded keystore
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS` — e.g. `my-release-key`
- `KEY_PASSWORD`
- `PWA_URL` — your deployed Vercel URL

Push to `main` → workflow builds a signed APK → download from Actions artifacts.

## Usage

1. Open FooLab
2. Tap **Scan Label** — take a clear photo of the ingredients list (tap to focus, get close)
3. Drag the crop box tight around the label text, tap **Analyze**
4. Read the NutriScore + red flags
5. Tap **Save** to archive or **Share** for a PNG card

## Project Structure

```
foolab/
├── api/
│   ├── scan.js              # Vercel serverless — calls Gemini
│   └── prompt.js            # prompt template exported from PROMPT.md
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── icons/
│   ├── styles.css
│   └── js/
│       ├── app.js           # screen router + wiring
│       ├── camera.js        # capture + compress
│       ├── cropper.js       # drag-corner crop
│       ├── storage.js       # IndexedDB wrapper
│       ├── scorecard.js     # result card rendering
│       ├── archive.js       # list + detail
│       └── cardexport.js    # PNG export + share
├── .github/workflows/build-apk.yml
├── package.json
├── vercel.json
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
