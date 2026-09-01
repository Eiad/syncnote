import { useState, useEffect, useCallback, useRef } from 'react';
import { db, logAnalyticsEvent } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { CldUploadWidget } from 'next-cloudinary';
import styles from './MediaShare.module.scss';
import ImageModal from './ImageModal';
import { useAuth } from '@/contexts/AuthContext';
import { FiImage, FiTrash2, FiUploadCloud } from 'react-icons/fi';
import { authedFetch } from '@/lib/authedFetch';
import { appendItem, removeItems } from '@/lib/mediaDoc';
import { itemsFromData, matchesTarget } from '@/lib/mediaSchema';

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

// Matches the limit enforced by the upload route and the Cloudinary widget.
// Checking it here turns a server error into an explanatory message.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Stable identity for a stored entry. Legacy records with an underivable public
// ID fall back to their URL so they can still be selected and removed.
const itemKey = (item) => item.publicId || item.url;

const MediaShare = ({ documentId }) => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingKeys, setDeletingKeys] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  // { done, total } while an upload batch is in flight, otherwise null.
  const [uploading, setUploading] = useState(null);
  const [draggingOver, setDraggingOver] = useState(false);

  // dragenter/dragleave fire for every child element the pointer crosses, so
  // track nesting depth. Toggling a boolean per event makes the overlay flicker
  // as the pointer moves over the image grid.
  const dragDepth = useRef(0);

  /**
   * Upload image files and record each one.
   *
   * Shared by the clipboard and drag-and-drop paths so both behave identically
   * and stay in sync. `eventPrefix` keeps their analytics events distinct.
   *
   * @param {FileList|File[]} fileList - Candidate files.
   * @param {string} eventPrefix - 'media_paste_upload' or 'media_drop_upload'.
   * @param {string} method - Value recorded as upload_method.
   */
  const uploadFiles = useCallback(async (fileList, eventPrefix, method) => {
    if (!user) return;

    const files = Array.from(fileList || []);
    const images = files.filter((file) => file.type.startsWith('image/'));
    const accepted = images.filter((file) => file.size <= MAX_FILE_SIZE);

    // Explain anything dropped that we are not going to upload, rather than
    // silently ignoring it or letting the request fail server-side.
    const problems = [];
    if (files.length - images.length > 0) {
      problems.push(`${files.length - images.length} file(s) skipped - images only`);
    }
    if (images.length - accepted.length > 0) {
      problems.push(`${images.length - accepted.length} file(s) skipped - over 10MB`);
    }
    setError(problems.length ? problems.join('. ') : null);

    if (!accepted.length) return;

    setUploading({ done: 0, total: accepted.length });

    try {
      for (const [index, file] of accepted.entries()) {
        setUploading({ done: index, total: accepted.length });

        // Track upload attempts to understand user behavior
        logAnalyticsEvent(`${eventPrefix}_started`, {
          file_size: file.size,               // File size in bytes for performance analysis
          file_type: file.type,               // MIME type (e.g., 'image/jpeg')
          user_id: user.uid,                  // User identifier
          document_id: documentId,            // Which document receives the upload
          upload_method: method               // 'paste' or 'drag_drop'
        });

        try {
          const formData = new FormData();
          formData.append('file', file);

          const data = await authedFetch('/api/uploadImage', formData);

          const docRef = doc(db, `users/${user.uid}/media`, documentId);
          const total = await appendItem(docRef, 'media', {
            url: data.secure_url,
            // Persisting the public ID is what makes deletion reliable later.
            publicId: data.public_id,
            resourceType: data.resource_type || 'image',
            uploadedAt: Date.now()
          });

          // Track successful uploads for feature usage analysis
          logAnalyticsEvent(`${eventPrefix}_success`, {
            file_size: file.size,              // File size for performance tracking
            file_type: file.type,              // File type for format analysis
            user_id: user.uid,                 // User identifier
            document_id: documentId,           // Target document
            total_images: total,               // Total images in collection
            upload_method: method              // 'paste' or 'drag_drop'
          });
        } catch (err) {
          // One bad file must not abandon the rest of the batch.
          setError(`Error uploading ${file.name || 'image'}: ${err.message}`);

          // Track upload errors to identify upload issues
          logAnalyticsEvent(`${eventPrefix}_error`, {
            error_message: err.message,        // Specific error message
            file_size: file.size,              // File size that failed
            file_type: file.type,              // File type that failed
            user_id: user.uid,                 // User identifier for support
            document_id: documentId,           // Target document
            upload_method: method              // 'paste' or 'drag_drop'
          });
        }
      }
    } finally {
      setUploading(null);
    }
  }, [user, documentId]);

  /**
   * Handle paste operations for image uploads
   * Supports pasting screenshots and copied images straight into the page
   */
  const handlePaste = useCallback(async (event) => {
    const clipboardItems = event.clipboardData?.items;
    if (!clipboardItems || !user) return;

    const files = Array.from(clipboardItems)
      .filter((clipboardItem) => clipboardItem.type.indexOf('image') === 0)
      .map((clipboardItem) => clipboardItem.getAsFile())
      .filter(Boolean);

    if (files.length) {
      await uploadFiles(files, 'media_paste_upload', 'paste');
    }
  }, [user, uploadFiles]);

  /* ----------------------------------------------------------- drag and drop */

  const handleDragEnter = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingOver(true);
  };

  // Without preventDefault on dragover the drop event never fires and the
  // browser navigates to the dropped file instead.
  const handleDragOver = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingOver(false);
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingOver(false);

    const dropped = event.dataTransfer?.files;
    if (dropped?.length) {
      await uploadFiles(dropped, 'media_drop_upload', 'drag_drop');
    }
  };

  // Dropping a file anywhere outside the drop zone makes the browser open it,
  // navigating away and losing the page. Swallow those drops.
  //
  // The same listeners reset the overlay: a drag that ends outside the window,
  // or is cancelled with Escape, produces no dragleave on the panel, which
  // would otherwise leave the overlay stuck over the page.
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0;
      setDraggingOver(false);
    };

    const swallow = (event) => event.preventDefault();

    const swallowAndReset = (event) => {
      event.preventDefault();
      reset();
    };

    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallowAndReset);
    window.addEventListener('dragend', reset);

    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallowAndReset);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  // Set up global paste event listener
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  /**
   * Set up real-time listener for media document changes
   * Tracks when media is loaded for engagement analysis
   */
  useEffect(() => {
    if (!user) return;

    const docRef = doc(db, `users/${user.uid}/media`, documentId);

    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      // Reads the current shape and older URL-only documents alike.
      const nextItems = snapshot.exists() ? itemsFromData(snapshot.data(), 'media') : [];
      setItems(nextItems);

      // Track media loading to understand content access patterns
      if (nextItems.length > 0) {
        logAnalyticsEvent('media_loaded', {
          user_id: user.uid,                 // User identifier
          document_id: documentId,           // Which document was loaded
          image_count: nextItems.length      // Number of images loaded
        });
      }
    });

    return () => unsubscribe();
  }, [documentId, user]);

  /**
   * Handle successful uploads from the Cloudinary widget
   * Tracks upload success with detailed file information
   */
  const handleUploadSuccess = async (result) => {
    try {
      const docRef = doc(db, `users/${user.uid}/media`, documentId);
      const total = await appendItem(docRef, 'media', {
        url: result.info.secure_url,
        publicId: result.info.public_id,
        resourceType: result.info.resource_type || 'image',
        uploadedAt: Date.now()
      });

      // Track successful widget uploads for feature usage analysis
      logAnalyticsEvent('media_upload_success', {
        user_id: user.uid,                    // User identifier
        document_id: documentId,              // Target document
        file_size: result.info.bytes,         // File size in bytes
        file_format: result.info.format,      // File format (jpg, png, etc.)
        total_images: total,                  // Total images in collection
        upload_method: 'widget'               // Indicates widget upload method
      });
    } catch (err) {
      setError('Error saving image: ' + err.message);

      // Track upload errors to identify widget issues
      logAnalyticsEvent('media_upload_error', {
        error_message: err.message,           // Specific error message
        user_id: user.uid,                    // User identifier for support
        document_id: documentId               // Target document
      });
    }
  };

  /**
   * Delete a single image: destroy the Cloudinary asset first, then drop the
   * record. A hard Cloudinary failure leaves both sides untouched and the
   * action retryable; an asset that is already gone still clears its record,
   * which is what unsticks entries whose asset was deleted long ago.
   */
  const handleDeleteItem = async (item, event) => {
    event?.stopPropagation();

    if (!window.confirm('Delete this image? This cannot be undone.')) {
      return;
    }

    const key = itemKey(item);
    setDeletingKeys((keys) => [...keys, key]);
    setError(null);

    // Track single deletions to understand how media is curated
    logAnalyticsEvent('media_delete_single_started', {
      user_id: user?.uid,                     // User identifier
      document_id: documentId,                // Target document
      image_count: items.length               // Collection size before deletion
    });

    try {
      const data = await authedFetch('/api/deleteImage', {
        publicId: item.publicId ?? null,
        resourceType: item.resourceType
      });

      const docRef = doc(db, `users/${user.uid}/media`, documentId);
      await removeItems(docRef, 'media', (candidate) =>
        matchesTarget(candidate, { publicId: item.publicId, url: item.url })
      );

      if (data.status === 'skipped') {
        setError('Image removed, but its Cloudinary ID could not be determined, so the original file may remain.');
      }

      setSelectedItem((current) => (current && itemKey(current) === key ? null : current));

      // Track successful single deletions
      logAnalyticsEvent('media_delete_single_success', {
        user_id: user?.uid,                   // User identifier
        document_id: documentId,              // Target document
        cloudinary_result: data.status        // 'deleted', 'missing' or 'skipped'
      });
    } catch (err) {
      setError('Error deleting image: ' + err.message);

      // Track single deletion errors to identify cleanup issues
      logAnalyticsEvent('media_delete_single_error', {
        error_message: err.message,           // Specific error message
        user_id: user?.uid,                   // User identifier for support
        document_id: documentId               // Target document
      });
    } finally {
      setDeletingKeys((keys) => keys.filter((existing) => existing !== key));
    }
  };

  /**
   * Handle bulk deletion of all media
   * Tracks deletion attempts, success, and errors
   */
  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to delete all images? This cannot be undone.')) {
      return;
    }

    setDeleting(true);
    setError(null);

    // Track deletion attempts to understand user behavior
    logAnalyticsEvent('media_delete_all_started', {
      user_id: user?.uid,                     // User identifier
      document_id: documentId,                // Target document
      image_count: items.length               // Number of images to delete
    });

    try {
      // Every asset is attempted independently, and only the ones that are
      // actually gone from Cloudinary have their records cleared. One bad asset
      // can no longer strand the rest.
      const { results } = await authedFetch('/api/deleteAll', {
        items: items.map(({ publicId, resourceType, url }) => ({
          publicId: publicId ?? null,
          resourceType,
          url
        }))
      });

      const cleared = new Set(
        results.filter((result) => result.status !== 'failed').map((result) => result.publicId || result.url)
      );

      const docRef = doc(db, `users/${user.uid}/media`, documentId);
      const removed = await removeItems(docRef, 'media', (candidate) =>
        cleared.has(candidate.publicId || candidate.url)
      );

      const failed = results.filter((result) => result.status === 'failed');
      if (failed.length) {
        setError(`${failed.length} image(s) could not be deleted from Cloudinary and were kept.`);
      }

      setSelectedItem(null);

      // Track successful bulk deletions
      logAnalyticsEvent('media_delete_all_success', {
        user_id: user?.uid,                   // User identifier
        document_id: documentId,              // Target document
        deleted_count: removed                // Number of images deleted
      });
    } catch (err) {
      setError('Error deleting images: ' + err.message);

      // Track deletion errors to identify cleanup issues
      logAnalyticsEvent('media_delete_all_error', {
        error_message: err.message,           // Specific error message
        user_id: user?.uid,                   // User identifier for support
        document_id: documentId,              // Target document
        image_count: items.length             // Number of images that failed to delete
      });
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Handle image viewing with analytics tracking
   * Tracks which images users view for content engagement analysis
   */
  const handleImageClick = (item) => {
    setSelectedItem(item);

    // Track image views to understand content engagement
    logAnalyticsEvent('media_image_viewed', {
      user_id: user?.uid,                     // User identifier
      document_id: documentId,                // Target document
      image_index: items.indexOf(item),       // Position of image in collection
      total_images: items.length              // Total number of images available
    });
  };

  return (
    <div
      className={`${styles.container} ${draggingOver ? styles.dropActive : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingOver && (
        <div className={styles.dropOverlay}>
          <FiUploadCloud className={styles.dropIcon} />
          <span>Drop images here</span>
        </div>
      )}

      {items.length > 0 && (
        <div className={styles.header}>

          <button
            className={styles.deleteButton}
            onClick={handleDeleteAll}
            disabled={deleting}
          >
            <FiTrash2 className={styles.buttonIcon} />
            {deleting ? 'Deleting...' : 'Clear'}
          </button>

        </div>
      )}

      {uploading && (
        <div className={styles.loading}>
          {uploading.total > 1
            ? `Uploading ${uploading.done + 1} of ${uploading.total}...`
            : 'Uploading image...'}
        </div>
      )}

      <div className={styles.imageGrid}>
        {items.map((item, index) => {
          const key = itemKey(item);
          const isDeleting = deletingKeys.includes(key);

          return (
            <div
              key={key || index}
              className={styles.imageWrapper}
              onClick={() => handleImageClick(item)}
            >
              <img src={item.url} alt={`Shared media ${index + 1}`} />
              <div className={styles.imageOverlay}>
                <span>Click to view</span>
              </div>
              <button
                className={styles.imageDeleteButton}
                onClick={(event) => handleDeleteItem(item, event)}
                disabled={isDeleting || deleting}
                title="Delete this image"
                aria-label={`Delete image ${index + 1}`}
              >
                <FiTrash2 />
              </button>
              {isDeleting && <div className={styles.itemDeleting}>Deleting...</div>}
            </div>
          );
        })}
      </div>
      {selectedItem && (
        <ImageModal
          imageUrl={selectedItem.url}
          onClose={() => setSelectedItem(null)}
          onDelete={(event) => handleDeleteItem(selectedItem, event)}
          deleting={deletingKeys.includes(itemKey(selectedItem))}
        />
      )}

      <div className={styles.uploadButtonContainer}>
        <CldUploadWidget
          cloudName={CLOUD_NAME}
          uploadPreset="syncnote"
          onSuccess={handleUploadSuccess}
          options={{
            maxFiles: 10,
            sources: ['local', 'camera', 'url'],
            resourceType: "image",
            clientAllowedFormats: ["png", "gif", "jpeg", "jpg"],
            maxFileSize: 10000000,
            cropping: false,
            multiple: true,
            showAdvancedOptions: false,
            showCompletedButton: true,
            styles: {
              palette: {
                window: "#FFFFFF",
                windowBorder: "#90A0B3",
                tabIcon: "#0078FF",
                menuIcons: "#5A616A",
                textDark: "#000000",
                textLight: "#FFFFFF",
                link: "#0078FF",
                action: "#FF620C",
                inactiveTabIcon: "#0E2F5A",
                error: "#F44235",
                inProgress: "#0078FF",
                complete: "#20B832",
                sourceBg: "#E4EBF1"
              }
            }
          }}
        >
          {({ open }) => (
            <button
              className={styles.uploadButton}
              onClick={() => {
                open();

                // Track widget opens to understand upload method preferences
                logAnalyticsEvent('media_upload_widget_opened', {
                  user_id: user?.uid,          // User identifier
                  document_id: documentId      // Target document
                });
              }}
            >
              <FiImage className={styles.buttonIcon} />
              Upload Media
            </button>
          )}
        </CldUploadWidget>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.instructions}>
        You can also drag &amp; drop images here, or paste them (Ctrl/Cmd + V)
      </div>
    </div>
  );
};

export default MediaShare;
