import { runTransaction, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS, itemsFromData } from '@/lib/mediaSchema';

/**
 * Append an entry to a media/files document.
 *
 * Runs in a transaction rather than the previous read-then-write pair: the
 * upload widget allows `multiple: true`, so several success callbacks fire
 * concurrently and a plain getDoc/setDoc silently drops all but the last one.
 * Transactions retry on contention, so every upload lands.
 *
 * The same write retires the legacy `urls`/`files` field, which lazily migrates
 * older documents to the current shape the first time anything is added.
 *
 * @param {import('firebase/firestore').DocumentReference} docRef
 * @param {'media'|'files'} collection
 * @param {Object} entry - `{ url, publicId, resourceType, ... }`
 * @returns {Promise<number>} The document's entry count after the append.
 */
export async function appendItem(docRef, collection, entry) {
  const { legacyField } = COLLECTIONS[collection];

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const items = itemsFromData(snapshot.exists() ? snapshot.data() : null, collection);
    const next = [...items, entry];

    transaction.set(
      docRef,
      { items: next, [legacyField]: deleteField() },
      { merge: true }
    );

    return next.length;
  });
}

/**
 * Remove every entry matched by `shouldRemove`, and retire the legacy field in
 * the same write.
 *
 * Called only after the Cloudinary asset is confirmed gone, so the record and
 * the asset cannot diverge. Transactional for the same reason as appendItem.
 *
 * @returns {Promise<number>} How many entries were removed.
 */
export async function removeItems(docRef, collection, shouldRemove) {
  const { legacyField } = COLLECTIONS[collection];

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const items = itemsFromData(snapshot.exists() ? snapshot.data() : null, collection);
    const remaining = items.filter((item) => !shouldRemove(item));

    transaction.set(
      docRef,
      { items: remaining, [legacyField]: deleteField() },
      { merge: true }
    );

    return items.length - remaining.length;
  });
}
