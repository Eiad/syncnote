import { v2 as cloudinary } from 'cloudinary';
import { HttpError } from '@/lib/serverAuth';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

export { cloudinary };

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
