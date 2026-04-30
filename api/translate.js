// Vercel adapter for /api/translate. Logic lives in lib/translate-core.js.

import { runTranslate } from '../lib/translate-core.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { targetLanguage, strings } = req.body || {};
  const result = await runTranslate({
    targetLanguage,
    strings,
    geminiApiKey: process.env.GEMINI_API_KEY,
    publicAppUrl: process.env.PUBLIC_APP_URL
  });

  return res.status(result.status).json(result.body);
}
