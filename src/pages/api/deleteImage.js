import { requireUser, HttpError, sendError } from '@/lib/firebaseAdmin';
import { resolveDoc, readItems, destroyAsset, removeItems } from '@/lib/mediaStore';
import { matchesTarget } from '@/lib/mediaSchema';

/**
 * Delete a single Cloudinary-backed entry from a user's media or files
 * document.
 *
 * Order matters: Cloudinary first, Firestore second. A hard Cloudinary failure
 * leaves both sides untouched and the request safely retryable, while an asset
 * that is already gone still lets the stale record be cleared.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { uid } = await requireUser(req);
    const { collection, documentId, publicId, url } = req.body || {};

    if (!publicId && !url) {
      throw new HttpError(400, 'publicId or url is required');
    }

    const docRef = resolveDoc(uid, collection, documentId);
    const snapshot = await docRef.get();
    const items = readItems(snapshot, collection);

    // Authorization: the entry must exist in this user's own document. The
    // document path is already scoped to the verified uid, so a caller cannot
    // name someone else's asset.
    const target = items.find((item) => matchesTarget(item, { publicId, url }));

    if (!target) {
      throw new HttpError(404, 'Item not found in this document');
    }

    const outcome = await destroyAsset(target.publicId, target.resourceType);

    const removed = await removeItems(docRef, collection, (item) =>
      matchesTarget(item, { publicId: target.publicId, url: target.url })
    );

    return res.status(200).json({
      message: 'Item deleted',
      removed,
      cloudinary: outcome
    });
  } catch (error) {
    return sendError(res, error, 'Delete error');
  }
}
