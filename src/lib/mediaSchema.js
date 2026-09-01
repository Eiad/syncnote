import { normaliseEntry } from '@/lib/cloudinaryUrl';

/**
 * Shape of the two Cloudinary-backed documents, shared by the client
 * components and the API routes so the two can never drift apart.
 *
 * Current shape:  { items: [{ url, publicId, resourceType, name?, uploadedAt }] }
 * Legacy shapes:  media -> { urls: string[] }
 *                 files -> { files: [{ url, date }] }
 */
export const COLLECTIONS = {
  media: { legacyField: 'urls', defaultResourceType: 'image' },
  files: { legacyField: 'files', defaultResourceType: 'raw' }
};

/**
 * Read a document's entries in the current shape, upgrading legacy records on
 * the fly. Legacy entries get their public ID derived from the URL where
 * possible; where it isn't, `publicId` stays null and the entry is still
 * removable from Firestore.
 *
 * @param {Object|undefined} data - Raw Firestore document data.
 * @param {'media'|'files'} collection
 * @returns {Object[]}
 */
export function itemsFromData(data, collection) {
  if (!data) return [];

  const { legacyField, defaultResourceType } = COLLECTIONS[collection];
  const raw = Array.isArray(data.items) ? data.items : data[legacyField] || [];

  return raw
    .map((entry) => normaliseEntry(entry, defaultResourceType))
    .filter(Boolean);
}

/**
 * Whether a stored entry is the one a delete request is targeting. Entries that
 * predate public ID storage and could not be parsed are matched on their URL.
 */
export function matchesTarget(item, { publicId, url }) {
  if (publicId && item.publicId) return item.publicId === publicId;
  if (url) return item.url === url;
  return false;
}
