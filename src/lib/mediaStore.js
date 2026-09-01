import { v2 as cloudinary } from 'cloudinary';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, HttpError } from '@/lib/firebaseAdmin';
import { COLLECTIONS, itemsFromData } from '@/lib/mediaSchema';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export { cloudinary };

/**
 * Validate the caller-supplied collection name and build the document
 * reference under the *authenticated* user's tree. Scoping the path to the
 * verified uid is what prevents a caller from touching another user's data.
 */
export function resolveDoc(uid, collection, documentId) {
  if (!COLLECTIONS[collection]) {
    throw new HttpError(400, 'Unknown collection');
  }
  if (typeof documentId !== 'string' || !documentId) {
    throw new HttpError(400, 'documentId is required');
  }

  return adminDb().doc(`users/${uid}/${collection}/${documentId}`);
}

/**
 * Read a snapshot's entries, transparently upgrading legacy records.
 */
export function readItems(snapshot, collection) {
  return snapshot.exists ? itemsFromData(snapshot.data(), collection) : [];
}

/**
 * Delete one asset from Cloudinary.
 *
 * A public ID that no longer exists is reported as `missing` rather than an
 * error: the caller still needs to drop the stale record, and treating "already
 * gone" as a failure is what previously left documents permanently unclearable.
 *
 * @returns {Promise<'deleted'|'missing'|'skipped'>}
 * @throws {HttpError} 502 when Cloudinary genuinely fails.
 */
export async function destroyAsset(publicId, resourceType) {
  // Legacy records whose public ID could not be derived from the URL. Nothing
  // to call Cloudinary with, but the record itself is still removable.
  if (!publicId) return 'skipped';

  let result;
  try {
    result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType || 'image',
      invalidate: true
    });
  } catch (error) {
    throw new HttpError(502, `Cloudinary delete failed: ${error.message}`);
  }

  if (result?.result === 'ok') return 'deleted';
  if (result?.result === 'not found') return 'missing';

  throw new HttpError(502, `Cloudinary delete failed: ${result?.result || 'unknown error'}`);
}

/**
 * Rewrite a document's entries, dropping everything matched by `shouldRemove`
 * and retiring the legacy field in the same write.
 *
 * Runs in a transaction so concurrent uploads or deletes cannot clobber each
 * other, which the previous read-then-write client code allowed.
 *
 * @returns {Promise<number>} How many entries were removed.
 */
export async function removeItems(docRef, collection, shouldRemove) {
  const { legacyField } = COLLECTIONS[collection];

  return adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const items = readItems(snapshot, collection);
    const remaining = items.filter((item) => !shouldRemove(item));

    transaction.set(
      docRef,
      { items: remaining, [legacyField]: FieldValue.delete() },
      { merge: true }
    );

    return items.length - remaining.length;
  });
}
