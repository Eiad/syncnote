import { requireCaller, HttpError, sendError } from '@/lib/serverAuth';
import { destroyAsset } from '@/lib/mediaStore';

const MAX_ITEMS = 200;

/**
 * Destroy a batch of Cloudinary assets on behalf of an authenticated caller.
 *
 * Each asset is attempted independently and reported on individually, so one
 * failing asset can no longer abort the batch. The client clears the records
 * that succeeded and keeps the rest, which is what stops a single bad asset
 * from leaving a document nothing can clear.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await requireCaller(req);

    const { items } = req.body || {};

    if (!Array.isArray(items)) {
      throw new HttpError(400, 'items must be an array');
    }
    if (items.length > MAX_ITEMS) {
      throw new HttpError(400, `Too many items (limit ${MAX_ITEMS})`);
    }

    const outcomes = await Promise.allSettled(
      items.map((item) => destroyAsset(item?.publicId, item?.resourceType))
    );

    const results = outcomes.map((outcome, index) => ({
      publicId: items[index]?.publicId ?? null,
      url: items[index]?.url ?? null,
      status: outcome.status === 'fulfilled' ? outcome.value : 'failed',
      reason: outcome.status === 'rejected' ? outcome.reason?.message : undefined
    }));

    return res.status(200).json({ results });
  } catch (error) {
    return sendError(res, error, 'Delete all error');
  }
}
