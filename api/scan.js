// Vercel serverless adapter. All logic lives in lib/scan-core.js so the
// Netlify function can reuse it.

import { runScan } from '../lib/scan-core.js';

export const config = {
  api: {
    bodyParser: { sizeLimit: '5mb' }
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { images, language } = req.body || {};
  const result = await runScan({
    images,
    language,
    geminiApiKey: process.env.GEMINI_API_KEY,
    publicAppUrl: process.env.PUBLIC_APP_URL
  });

  return res.status(result.status).json(result.body);
}
