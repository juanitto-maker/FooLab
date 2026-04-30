// Framework-neutral translate pipeline. Both api/translate.js (Vercel) and
// netlify/functions/translate.js call runTranslate and adapt its
// { status, body } result to their platform's response shape.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export async function runTranslate({ targetLanguage, strings, geminiApiKey, publicAppUrl }) {
  if (!targetLanguage || typeof targetLanguage !== 'string') {
    return { status: 400, body: { error: 'targetLanguage is required.' } };
  }
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) {
    return { status: 400, body: { error: 'strings object is required.' } };
  }
  if (!geminiApiKey) {
    return { status: 500, body: { error: 'Server missing GEMINI_API_KEY.' } };
  }

  const keys = Object.keys(strings);
  if (keys.length === 0) {
    return { status: 200, body: { translations: {} } };
  }

  try {
    const prompt =
      'Translate the JSON values into ' + targetLanguage + '. ' +
      'Maintain the JSON structure and keys exactly. Only translate the string values. ' +
      'Brand and product names (NutriScore, FooLab, etc.) and units (g, kcal, %, €, mg) must stay unchanged. ' +
      'Keep placeholders like {n}, {total}, {max} intact. ' +
      'Return ONLY a valid JSON object, no markdown, no code fences, no explanation.\n\n' +
      JSON.stringify(strings, null, 2);

    const raw = await callGemini(prompt, geminiApiKey, publicAppUrl);
    const translations = JSON.parse(cleanJson(raw));
    if (!translations || typeof translations !== 'object') {
      throw new Error('AI returned an invalid response.');
    }
    return { status: 200, body: { translations } };
  } catch (err) {
    console.error('Translate error:', err.message || err);
    const status = err.status || 500;
    const msg = err.message || '';

    if (status === 429 || /429|quota|rate|exhausted/i.test(msg)) {
      return { status: 429, body: { error: 'Translation service temporarily unavailable. Please try again later.' } };
    }
    if (/timeout|timed out|abort/i.test(msg)) {
      return { status: 504, body: { error: 'Translation timed out. Please try again.' } };
    }
    if (/invalid response/i.test(msg)) {
      return { status: 500, body: { error: 'AI returned an invalid response, please retry.' } };
    }
    return { status, body: { error: 'Translation failed: ' + (msg || 'unknown error') } };
  }
}

async function callGemini(prompt, geminiApiKey, publicAppUrl) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
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
        const err = new Error(data?.error?.message || `Gemini ${response.status}`);
        err.status = response.status;
        if ((response.status === 429 || response.status === 503 || response.status === 500) && attempt < maxRetries) {
          await sleep(1500 * (attempt + 1));
          lastError = err;
          continue;
        }
        throw err;
      }

      const parts = data?.candidates?.[0]?.content?.parts;
      if (!parts || !Array.isArray(parts)) throw new Error('Gemini returned no content.');
      return parts.filter((p) => p.text).map((p) => p.text).join('');
    } catch (err) {
      lastError = err;
      if (err.status) throw err;
      if (attempt < maxRetries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError || new Error('Gemini translate failed.');
}

function cleanJson(text) {
  return String(text).replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
