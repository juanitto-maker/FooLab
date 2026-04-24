// Framework-neutral scan logic. Both the Vercel handler (api/scan.js) and
// the Netlify function (netlify/functions/scan.js) call runScan and adapt
// its { status, body } result to their platform's response shape.

import { SYSTEM_PROMPT } from '../api/prompt.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const MAX_IMAGES = 3;
const REQUIRED_KEYS = [
  'productName', 'brand', 'category', 'nutriScore', 'healthScore', 'summary',
  'ingredients', 'eNumbers', 'redFlags', 'nutrition', 'allergens',
  'confidence', 'notReadable'
];

export async function runScan({ images, language = 'en', geminiApiKey, publicAppUrl }) {
  const imageList = Array.isArray(images) ? images.filter(Boolean).slice(0, MAX_IMAGES) : [];

  if (imageList.length === 0) {
    return { status: 400, body: { error: 'At least one image is required.' } };
  }

  if (!geminiApiKey) {
    return { status: 500, body: { error: 'Server missing GEMINI_API_KEY.' } };
  }

  try {
    const raw = await callGemini(imageList, geminiApiKey, publicAppUrl);
    const parsed = parseAndValidate(raw);
    return { status: 200, body: parsed };
  } catch (err) {
    console.error('Scan error:', err);
    const status = err.status || 500;
    const message = err.message || 'Failed to analyze label.';

    if (status === 429 || /429|quota|rate|exhausted/i.test(message)) {
      return { status: 429, body: { error: classifyRateLimit(message, err.geminiDetails) } };
    }
    if (status === 400 || /invalid|unsupported/i.test(message)) {
      return { status: 400, body: { error: 'Image could not be processed. Try a smaller or clearer photo.' } };
    }
    if (/invalid response/i.test(message)) {
      return { status: 500, body: { error: 'AI returned an invalid response, please retry.' } };
    }
    return { status, body: { error: message } };
  }
}

async function callGemini(base64Images, geminiApiKey, publicAppUrl) {
  const imageParts = base64Images.map((data) => ({
    inlineData: { mimeType: 'image/jpeg', data }
  }));

  const body = {
    contents: [{
      parts: [
        { text: SYSTEM_PROMPT },
        ...imageParts
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };

  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_URL}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': publicAppUrl || 'https://foolab.vercel.app'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.error?.message || JSON.stringify(data);
        const errDetails = data?.error?.details || [];
        console.error(`Gemini error (attempt ${attempt + 1}): ${response.status} — ${errMsg}`);
        const err = new Error(`Gemini API ${response.status}: ${errMsg}`);
        err.status = response.status;
        err.geminiDetails = errDetails;

        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          await sleep((attempt + 1) * 2000);
          lastError = err;
          continue;
        }
        throw err;
      }

      if (!data.candidates || !data.candidates[0]?.content?.parts) {
        const reason = data.candidates?.[0]?.finishReason || 'unknown';
        throw new Error(`Gemini returned no content (finishReason: ${reason})`);
      }

      return data.candidates[0].content.parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join('');
    } catch (fetchErr) {
      lastError = fetchErr;
      if (fetchErr.status) throw fetchErr;
      if (attempt < maxRetries) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
    }
  }

  throw lastError || new Error('Gemini API call failed after retries');
}

function parseAndValidate(rawText) {
  const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('JSON parse failed. Raw:', rawText.substring(0, 500));
    throw new Error('AI returned an invalid response, please retry.');
  }

  if (parsed.notReadable === true) {
    return {
      notReadable: true,
      reason: parsed.reason || 'Image could not be read. Please try a clearer photo.'
    };
  }

  const missing = REQUIRED_KEYS.filter((k) => !(k in parsed));
  if (missing.length > 0) {
    console.error('Missing keys in AI response:', missing);
    throw new Error('AI returned an invalid response, please retry.');
  }

  if (!/^[A-E]$/.test(parsed.nutriScore || '')) {
    parsed.nutriScore = 'C';
    parsed.confidence = 'low';
  }

  parsed.ingredients = Array.isArray(parsed.ingredients) ? parsed.ingredients : [];
  parsed.eNumbers = Array.isArray(parsed.eNumbers) ? parsed.eNumbers : [];
  parsed.redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags : [];
  parsed.allergens = Array.isArray(parsed.allergens) ? parsed.allergens : [];
  parsed.tips = parsed.tips || null;

  return parsed;
}

function classifyRateLimit(message, geminiDetails) {
  const msg = (message || '').toLowerCase();
  const details = Array.isArray(geminiDetails) ? JSON.stringify(geminiDetails).toLowerCase() : '';

  if (details.includes('per_minute') || msg.includes('per minute') || msg.includes('per_minute')) {
    return 'Too many requests (15/minute limit on the free tier). Wait a minute and try again.';
  }
  if (
    details.includes('per_day') || details.includes('daily') ||
    msg.includes('per day') || msg.includes('daily') ||
    msg.includes('quota') || msg.includes('exhausted')
  ) {
    return 'Daily AI quota exhausted (1,500 scans/day on the free tier). It resets at midnight Pacific time.';
  }
  return 'AI rate limit reached. Please try again later.';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
