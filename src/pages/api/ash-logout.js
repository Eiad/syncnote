import { buildClearedSessionCookie } from '@/lib/serverAuth';

/**
 * Clear the ash session cookie. Called on logout so the browser stops
 * presenting a credential the user has signed out of.
 */
export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  res.setHeader('Set-Cookie', buildClearedSessionCookie());
  return res.status(200).json({ ok: true });
}
