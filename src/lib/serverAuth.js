import { createHmac, createPublicKey, createVerify, timingSafeEqual } from 'crypto';

/**
 * Server-side caller authentication, with no Firebase Admin SDK and therefore
 * no service account to provision.
 *
 * Two kinds of caller are recognised:
 *
 *   - The main 'ash' account, which signs in client-side and has no Firebase
 *     session. It presents a signed, httpOnly session cookie issued by
 *     /api/ash-login after the password is checked on the server.
 *   - Email and Google users, which present a Firebase ID token. The token is
 *     verified against Google's published certificates rather than through the
 *     Admin SDK.
 */

export const ASH_UID = 'ash';
export const SESSION_COOKIE = 'sn_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const GOOGLE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

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

/* -------------------------------------------------------------- ash session */

function sessionSecret() {
  // A dedicated secret is preferred, but deriving one from the password keeps
  // this working with no extra configuration. Changing the password then
  // invalidates existing sessions, which is the behaviour you want anyway.
  const secret = process.env.SESSION_SECRET || process.env.ASH_PASSWORD;

  if (!secret) {
    throw new Error('Neither SESSION_SECRET nor ASH_PASSWORD is configured');
  }

  return secret;
}

function sign(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

/**
 * Build the Set-Cookie header value for a freshly authenticated ash session.
 */
export function buildSessionCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${ASH_UID}.${expiresAt}`;
  const value = `${payload}.${sign(payload)}`;

  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE}`
  ];

  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

/**
 * Build the Set-Cookie header value that clears the session.
 */
export function buildClearedSessionCookie() {
  const attributes = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];

  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function readSessionCookie(req) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  const [uid, expiresAt, signature] = parts;
  const expected = sign(`${uid}.${expiresAt}`);

  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;

  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return null;

  return { uid };
}

/* --------------------------------------------------- firebase id token */

let certCache = { certs: null, expiresAt: 0 };

async function googleCerts() {
  if (certCache.certs && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }

  const response = await fetch(GOOGLE_CERT_URL);
  if (!response.ok) {
    throw new Error(`Could not fetch Google signing certificates (${response.status})`);
  }

  const certs = await response.json();
  // Respect Google's own cache lifetime; these keys rotate.
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 3600);
  certCache = { certs, expiresAt: Date.now() + maxAge * 1000 };

  return certs;
}

const decodeSegment = (segment) =>
  Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify a Firebase ID token without the Admin SDK: check the RS256 signature
 * against Google's published certificate for the token's key id, then the
 * issuer, audience and expiry.
 *
 * @returns {Promise<{ uid: string }>}
 */
async function verifyIdToken(token) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  let header;
  let payload;
  try {
    header = JSON.parse(decodeSegment(parts[0]).toString('utf8'));
    payload = JSON.parse(decodeSegment(parts[1]).toString('utf8'));
  } catch {
    throw new HttpError(401, 'Invalid authentication token');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  const certs = await googleCerts();
  const certificate = certs[header.kid];

  if (!certificate) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);

  if (!verifier.verify(createPublicKey(certificate), decodeSegment(parts[2]))) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    !payload.sub ||
    payload.exp <= now
  ) {
    throw new HttpError(401, 'Invalid authentication token');
  }

  return { uid: payload.sub };
}

/* ----------------------------------------------------------------- entry */

/**
 * Identify the caller from either the ash session cookie or a Firebase ID
 * token. Routes that mutate Cloudinary must call this first.
 *
 * @returns {Promise<{ uid: string }>}
 * @throws {HttpError} 401 when neither credential is present or valid.
 */
export async function requireCaller(req) {
  const session = readSessionCookie(req);
  if (session) return session;

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    return verifyIdToken(token);
  }

  throw new HttpError(401, 'Not authenticated');
}
