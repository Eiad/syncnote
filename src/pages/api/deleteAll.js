import { requireUser, sendError } from '@/lib/firebaseAdmin';
import { resolveDoc, readItems, destroyAsset, removeItems } from '@/lib/mediaStore';

const entryKey = (item) => item.publicId || item.url;

/**
 * Delete every Cloudinary-backed entry in a user's media or files document.
 *
 * Each asset is attempted independently and the survivors are always written
 * back, so one failing asset can no longer abort the batch and strand the
 * document in a state the UI cannot clear.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { uid } = await requireUser(req);
    const { collection, documentId } = req.body || {};

    const docRef = resolveDoc(uid, collection, documentId);
    const snapshot = await docRef.get();
    const items = readItems(snapshot, collection);

    if (items.length === 0) {
      return res.status(200).json({ deleted: 0, failed: [] });
    }

    const outcomes = await Promise.allSettled(
      items.map((item) => destroyAsset(item.publicId, item.resourceType))
    );

    const clearable = new Set();
    const failed = [];

    outcomes.forEach((outcome, index) => {
      const item = items[index];

      if (outcome.status === 'fulfilled') {
        clearable.add(entryKey(item));
      } else {
        failed.push({
          publicId: item.publicId,
          url: item.url,
          reason: outcome.reason?.message || 'Unknown error'
        });
      }
    });

    const removed = await removeItems(docRef, collection, (item) =>
      clearable.has(entryKey(item))
    );

    return res.status(200).json({ deleted: removed, failed });
  } catch (error) {
    return sendError(res, error, 'Delete all error');
  }
}
