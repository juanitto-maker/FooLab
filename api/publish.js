// Vercel adapter for /api/publish — mirrors the /api/scan pattern.

import { runPublish } from '../lib/catalog-core.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '5mb' }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { result, thumbnailBase64 } = req.body || {};
  const out = await runPublish({
    result,
    thumbnailBase64,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    publicAppUrl: process.env.PUBLIC_APP_URL
  });

  return res.status(out.status).json(out.body);
}
