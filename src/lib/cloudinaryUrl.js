/**
 * Cloudinary URL parsing helpers.
 *
 * Pure functions, safe to import from both client components and API routes.
 *
 * These exist for legacy records only. Every new upload persists the real
 * `public_id` returned by Cloudinary, because deriving it from a delivery URL
 * is lossy and cannot be made fully reliable.
 */

// Delivery types that can appear between the resource type and the asset path.
const DELIVERY_TYPES = new Set([
  'upload',
  'private',
  'authenticated',
  'fetch',
  'facebook',
  'twitter',
  'youtube',
  'vimeo',
  'sprite',
  'multi',
  'list'
]);

const RESOURCE_TYPES = new Set(['image', 'video', 'raw', 'auto']);

// A transformation segment looks like `w_500,c_fill` or `f_auto` or `e_blur:100`.
const TRANSFORMATION = /^[a-z]{1,3}_[^/,]+(,[a-z]{1,3}_[^/,]+)*$/;

const VERSION = /^v\d+$/;

/**
 * Extract the Cloudinary public ID and resource type from a delivery URL.
 *
 * Handles the shapes the previous regex (`/\/v\d+\/(.+)\./`) silently dropped:
 * URLs with no version segment, no file extension, transformation prefixes,
 * percent-encoded characters, and non-image resource types.
 *
 * @param {string} url - A Cloudinary secure_url.
 * @returns {{ publicId: string, resourceType: string } | null} Null when the
 *   URL is not a parseable Cloudinary delivery URL.
 */
export function parseCloudinaryUrl(url) {
  if (typeof url !== 'string' || !url) return null;

  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);

  // Locate the delivery type; the resource type is the segment before it.
  const typeIndex = segments.findIndex((segment) => DELIVERY_TYPES.has(segment));
  if (typeIndex === -1) return null;

  const previous = segments[typeIndex - 1];
  const resourceType = RESOURCE_TYPES.has(previous) && previous !== 'auto' ? previous : 'image';

  let rest = segments.slice(typeIndex + 1);

  // Drop any leading transformation segments (they precede the version).
  while (rest.length > 1 && TRANSFORMATION.test(rest[0]) && !VERSION.test(rest[0])) {
    rest = rest.slice(1);
  }

  // Drop the version segment when present.
  if (rest.length > 1 && VERSION.test(rest[0])) {
    rest = rest.slice(1);
  }

  if (rest.length === 0) return null;

  let publicId = rest.map(decodeSegment).join('/');

  // For image and video assets the public ID excludes the format. For raw
  // assets Cloudinary keeps the extension as part of the public ID, so
  // stripping it there would produce an ID that does not exist.
  if (resourceType !== 'raw') {
    publicId = stripExtension(publicId);
  }

  return publicId ? { publicId, resourceType } : null;
}

/**
 * Normalise a stored media/file record so callers always see the same shape.
 * Legacy records (plain URL strings, or `{ url, date }` file entries) get their
 * public ID derived on a best-effort basis; `publicId` is null when the URL
 * cannot be parsed, which the UI treats as "removable, but the Cloudinary asset
 * may survive".
 *
 * @param {string|Object} entry - A legacy or current stored entry.
 * @param {string} [fallbackResourceType] - Used when the URL cannot be parsed.
 * @returns {Object|null} A normalised `{ url, publicId, resourceType, ... }` record.
 */
export function normaliseEntry(entry, fallbackResourceType = 'image') {
  const record = typeof entry === 'string' ? { url: entry } : { ...(entry || {}) };
  if (!record.url) return null;

  if (!record.publicId) {
    const parsed = parseCloudinaryUrl(record.url);
    record.publicId = parsed?.publicId ?? null;
    record.resourceType = record.resourceType || parsed?.resourceType || fallbackResourceType;
  }

  record.resourceType = record.resourceType || fallbackResourceType;

  return record;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function stripExtension(publicId) {
  const lastSlash = publicId.lastIndexOf('/');
  const lastDot = publicId.lastIndexOf('.');
  return lastDot > lastSlash ? publicId.slice(0, lastDot) : publicId;
}
