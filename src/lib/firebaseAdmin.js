import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Server-side Firebase Admin singleton.
 *
 * Next.js re-evaluates modules on hot reload, so initialising unconditionally
 * throws "The default Firebase app already exists". Reuse the existing app
 * whenever one is present.
 */
function getAdminApp() {
  if (getApps().length) return getApp();

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_ADMIN_PROJECT_ID, ' +
      'FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.'
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // Environment variables store the key with literal "\n" sequences.
      privateKey: privateKey.replace(/\\n/g, '\n')
    })
  });
}

export const adminAuth = () => getAuth(getAdminApp());
export const adminDb = () => getFirestore(getAdminApp());

/**
 * An error carrying the HTTP status an API route should respond with.
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Verify the caller's Firebase ID token.
 *
 * @param {import('next').NextApiRequest} req
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken>}
 * @throws {HttpError} 401 when the token is missing, malformed or invalid.
 */
export async function requireUser(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Missing authentication token');
  }

  // Resolve the Admin SDK outside the try: a misconfigured service account must
  // surface as a server error, not be reported to the caller as a bad token.
  const auth = adminAuth();

  try {
    return await auth.verifyIdToken(token);
  } catch {
    throw new HttpError(401, 'Invalid authentication token');
  }
}

/**
 * Send an error response, mapping HttpError to its status and anything else to
 * a 500 without leaking internals to the client.
 */
export function sendError(res, error, context) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }

  console.error(`${context}:`, error);
  return res.status(500).json({ message: 'Internal server error' });
}
