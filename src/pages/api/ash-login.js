import { timingSafeEqual } from 'crypto';
import { adminAuth, HttpError, sendError } from '@/lib/firebaseAdmin';

// The uid the Ash account has always used. Minting the custom token with this
// exact uid keeps every existing document under users/ash/** reachable.
const ASH_UID = 'ash';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Best-effort throttle. Serverless instances are not shared, so this slows a
// casual guesser rather than acting as a hard rate limit.
const attempts = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const expected = process.env.ASH_PASSWORD;
    if (!expected) {
      throw new Error('ASH_PASSWORD is not configured');
    }

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    if (isThrottled(ip)) {
      throw new HttpError(429, 'Too many attempts. Try again later.');
    }

    const { password } = req.body || {};

    if (typeof password !== 'string' || !constantTimeEqual(password, expected)) {
      recordFailure(ip);
      throw new HttpError(401, 'Invalid password');
    }

    attempts.delete(ip);

    const token = await adminAuth().createCustomToken(ASH_UID);
    return res.status(200).json({ token });
  } catch (error) {
    return sendError(res, error, 'Ash login error');
  }
}

function constantTimeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  // The length of the configured password is not itself a useful secret.
  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

function isThrottled(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;

  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }

  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const entry = attempts.get(ip);

  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: Date.now() });
    return;
  }

  entry.count += 1;
}
