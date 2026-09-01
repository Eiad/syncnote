import { auth } from '@/lib/firebase';

/**
 * Call one of our API routes as the current caller.
 *
 * Email and Google users present a Firebase ID token. The main 'ash' account
 * has no Firebase session, so it authenticates with the httpOnly session cookie
 * /api/ash-login set — which the browser attaches to same-origin requests on
 * its own, and which JavaScript deliberately cannot read.
 *
 * Accepts either a plain object (sent as JSON) or a FormData instance (sent
 * as-is, so the browser sets its own multipart boundary).
 *
 * @param {string} url - API route path.
 * @param {Object|FormData} body - Request payload.
 * @returns {Promise<Object>} The parsed JSON response.
 * @throws {Error} When the route responds with an error.
 */
export async function authedFetch(url, body) {
  const token = await auth.currentUser?.getIdToken();
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isFormData ? {} : { 'Content-Type': 'application/json' })
    },
    body: isFormData ? body : JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}
