// Netlify Functions adapter for /api/publish. Shares all logic with the
// Vercel handler via lib/catalog-core.js. netlify.toml rewrites /api/* to
// /.netlify/functions/* so the client URL stays /api/publish either way.

import { runPublish } from '../../lib/catalog-core.js';

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

  const out = await runPublish({
    result: payload.result,
    thumbnailBase64: payload.thumbnailBase64,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    publicAppUrl: process.env.PUBLIC_APP_URL
  });

  return {
    statusCode: out.status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(out.body)
  };
};
