// Netlify Functions adapter. Shares all logic with the Vercel handler via
// lib/scan-core.js. Client calls /api/scan either way — netlify.toml
// rewrites /api/* to /.netlify/functions/*.

import { runScan } from '../../lib/scan-core.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const result = await runScan({
    images: payload.images,
    language: payload.language,
    geminiApiKey: process.env.GEMINI_API_KEY,
    publicAppUrl: process.env.PUBLIC_APP_URL
  });

  return {
    statusCode: result.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body)
  };
};
