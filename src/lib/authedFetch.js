import { auth } from '@/lib/firebase';

/**
 * Call one of our API routes with the signed-in user's Firebase ID token.
 *
 * Accepts either a plain object (sent as JSON) or a FormData instance (sent
 * as-is, so the browser sets its own multipart boundary).
 *
 * @param {string} url - API route path.
 * @param {Object|FormData} body - Request payload.
 * @returns {Promise<Object>} The parsed JSON response.
 * @throws {Error} When the user is signed out or the route responds with an error.
 */
export async function authedFetch(url, body) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('You are signed out. Please sign in again.');
  }

  const token = await currentUser.getIdToken();
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
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
