// Returns the *public* runtime config the client needs to talk to Supabase.
// Both values are designed to be public — RLS protects the data — but we
// expose them via an endpoint instead of inlining so they aren't baked into
// the static HTML and can be rotated without a redeploy.

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
}
