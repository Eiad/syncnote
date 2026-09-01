import { requireCaller, HttpError, sendError } from '@/lib/serverAuth';
import { destroyAsset } from '@/lib/mediaStore';

/**
 * Destroy a single Cloudinary asset on behalf of an authenticated caller.
 *
 * The client removes the matching Firestore record only after this succeeds.
 * Cloudinary first means a hard failure leaves both sides untouched and the
 * request safely retryable, while an asset that is already gone still reports
 * success so the stale record can be cleared.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await requireCaller(req);

    const { publicId, resourceType } = req.body || {};

    if (publicId !== null && typeof publicId !== 'string') {
      throw new HttpError(400, 'publicId must be a string or null');
    }

    const status = await destroyAsset(publicId, resourceType);

    return res.status(200).json({ status });
  } catch (error) {
    return sendError(res, error, 'Delete error');
  }
}
