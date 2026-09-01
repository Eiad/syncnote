import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { CldUploadWidget } from 'next-cloudinary';
import styles from './FileShare.module.scss';
import { useAuth } from '@/contexts/AuthContext';
import { FiUpload, FiTrash2, FiUploadCloud } from 'react-icons/fi';
import { authedFetch } from '@/lib/authedFetch';
import { appendItem, removeItems } from '@/lib/mediaDoc';
import { itemsFromData, matchesTarget } from '@/lib/mediaSchema';
import { useFileDrop } from '@/lib/useFileDrop';

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

// Matches the widget's clientAllowedFormats. Checked by extension rather than
// MIME type: browsers report .docx, .xlsx and .zip inconsistently, sometimes as
// application/octet-stream and sometimes as nothing at all.
const ALLOWED_EXTENSIONS = ['zip', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];

// Matches the limit enforced by the upload route and the widget.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const extensionOf = (name) => (name || '').split('.').pop().toLowerCase();

const itemKey = (item) => item.publicId || item.url;

const fileName = (item) => item.name || decodeURIComponent(item.url.split('/').pop());

const fileExtension = (item) => extensionOf(fileName(item)).toUpperCase() || 'FILE';

/**
 * Human-readable size. Older records predate size being stored, so they get no
 * size rather than a fabricated one.
 */
const formatSize = (bytes) => {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Relative time for recent uploads, which is what you actually want when
 * checking whether the file you just sent arrived. Falls back to the stored
 * locale string for records saved before uploadedAt existed.
 */
const formatWhen = (item) => {
  if (typeof item.uploadedAt !== 'number') return item.date || null;

  const seconds = Math.round((Date.now() - item.uploadedAt) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(item.uploadedAt).toLocaleDateString();
};

const exactWhen = (item) =>
  typeof item.uploadedAt === 'number' ? new Date(item.uploadedAt).toLocaleString() : item.date || '';

const FileShare = ({ documentId }) => {
    const { user } = useAuth();
    const [items, setItems] = useState([]);
    const [deleting, setDeleting] = useState(false);
    const [deletingKeys, setDeletingKeys] = useState([]);
    const [error, setError] = useState(null);
    // { done, total } while an upload batch is in flight, otherwise null.
    const [uploading, setUploading] = useState(null);

    useEffect(() => {
        if (!user) return;

        const docRef = doc(db, `users/${user.uid}/files`, documentId);

        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            // Reads the current shape and older { url, date } records alike.
            setItems(snapshot.exists() ? itemsFromData(snapshot.data(), 'files') : []);
        });

        return () => unsubscribe();
    }, [documentId, user]);

    /**
     * Upload dropped files and record each one.
     *
     * Mirrors the media panel's path: sequential so one failure cannot hide
     * another, and an upload that cannot be recorded is undone rather than left
     * on Cloudinary with nothing referencing it.
     */
    const uploadFiles = useCallback(async (fileList) => {
        if (!user) return;

        const files = Array.from(fileList || []);
        const supported = files.filter((file) => ALLOWED_EXTENSIONS.includes(extensionOf(file.name)));
        const accepted = supported.filter((file) => file.size <= MAX_FILE_SIZE);

        const problems = [];
        if (files.length - supported.length > 0) {
            problems.push(`${files.length - supported.length} file(s) skipped - allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`);
        }
        if (supported.length - accepted.length > 0) {
            problems.push(`${supported.length - accepted.length} file(s) skipped - over 10MB`);
        }
        setError(problems.length ? problems.join('. ') : null);

        if (!accepted.length) return;

        setUploading({ done: 0, total: accepted.length });
        const failures = [];

        try {
            for (const [index, file] of accepted.entries()) {
                setUploading({ done: index, total: accepted.length });

                let uploaded = null;

                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    // Pin the type so a dropped PDF matches the raw asset the
                    // widget produces for the same file.
                    formData.append('resourceType', 'raw');

                    uploaded = await authedFetch('/api/uploadImage', formData);

                    const docRef = doc(db, `users/${user.uid}/files`, documentId);
                    await appendItem(docRef, 'files', {
                        url: uploaded.secure_url,
                        publicId: uploaded.public_id,
                        resourceType: uploaded.resource_type || 'raw',
                        name: file.name,
                        bytes: uploaded.bytes,
                        date: new Date().toLocaleString(),
                        uploadedAt: Date.now()
                    });
                } catch (err) {
                    if (uploaded?.public_id) {
                        await authedFetch('/api/deleteImage', {
                            publicId: uploaded.public_id,
                            resourceType: uploaded.resource_type
                        }).catch(() => {
                            // Nothing more to try; the message below still reports it.
                        });
                    }

                    failures.push(`${file.name || 'file'}: ${err.message}`);
                }
            }
        } finally {
            setUploading(null);

            if (failures.length === 1) {
                setError([...problems, `Error uploading ${failures[0]}`].join('. '));
            } else if (failures.length > 1) {
                setError([...problems, `${failures.length} uploads failed - ${failures.join('; ')}`].join('. '));
            }
        }
    }, [user, documentId]);

    const { dragProps, draggingOver } = useFileDrop(uploadFiles);

    const handleUploadSuccess = async (result) => {
        const docRef = doc(db, `users/${user.uid}/files`, documentId);

        try {
            await appendItem(docRef, 'files', {
                url: result.info.secure_url,
                // Persisting the public ID is what makes deletion reliable later.
                publicId: result.info.public_id,
                resourceType: result.info.resource_type || 'raw',
                bytes: result.info.bytes,
                name: result.info.original_filename
                    ? `${result.info.original_filename}.${result.info.format || ''}`.replace(/\.$/, '')
                    : null,
                date: new Date().toLocaleString(),
                uploadedAt: Date.now()
            });
        } catch (err) {
            setError('Error saving file: ' + err.message);
        }
    };

    /**
     * Delete a single file from Cloudinary and this document.
     */
    const handleDeleteItem = async (item) => {
        if (!window.confirm(`Delete ${fileName(item)}? This cannot be undone.`)) {
            return;
        }

        const key = itemKey(item);
        setDeletingKeys((keys) => [...keys, key]);
        setError(null);

        try {
            const data = await authedFetch('/api/deleteImage', {
                publicId: item.publicId ?? null,
                resourceType: item.resourceType
            });

            const docRef = doc(db, `users/${user.uid}/files`, documentId);
            await removeItems(docRef, 'files', (candidate) =>
                matchesTarget(candidate, { publicId: item.publicId, url: item.url })
            );

            if (data.status === 'skipped') {
                setError('File removed, but its Cloudinary ID could not be determined, so the original may remain.');
            }
        } catch (err) {
            setError('Error deleting file: ' + err.message);
        } finally {
            setDeletingKeys((keys) => keys.filter((existing) => existing !== key));
        }
    };

    const handleDeleteAll = async () => {
        if (!window.confirm('Are you sure you want to delete all files? This cannot be undone.')) {
            return;
        }

        setDeleting(true);
        setError(null);

        try {
            // Previously this only cleared Firestore, orphaning every raw asset
            // on Cloudinary. Each asset is now destroyed first, and only the
            // ones confirmed gone have their records cleared.
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

            const docRef = doc(db, `users/${user.uid}/files`, documentId);
            await removeItems(docRef, 'files', (candidate) =>
                cleared.has(candidate.publicId || candidate.url)
            );

            const failed = results.filter((result) => result.status === 'failed');
            if (failed.length) {
                setError(`${failed.length} file(s) could not be deleted from Cloudinary and were kept.`);
            }
        } catch (err) {
            setError('Error deleting files: ' + err.message);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <>
            {user?.displayName === 'Ash' && (
                <div
                    className={`${styles.container} ${draggingOver ? styles.dropActive : ''}`}
                    {...dragProps}
                >
                    {draggingOver && (
                        <div className={styles.dropOverlay}>
                            <FiUploadCloud className={styles.dropIcon} />
                            <span>Drop files here</span>
                        </div>
                    )}

                    {uploading && (
                        <div className={styles.uploading}>
                            {uploading.total > 1
                                ? `Uploading ${uploading.done + 1} of ${uploading.total}...`
                                : 'Uploading file...'}
                        </div>
                    )}

                    <div className={styles.header}>
                        {items.length > 0 && (
                            <button
                                className={styles.deleteButton}
                                onClick={handleDeleteAll}
                                disabled={deleting}
                            >
                                <FiTrash2 className={styles.buttonIcon} />
                                {deleting ? 'Deleting...' : 'Clear'}
                            </button>
                        )}
                    </div>


                    <CldUploadWidget
                        cloudName={CLOUD_NAME}
                        uploadPreset="syncnote"
                        onSuccess={handleUploadSuccess}
                        options={{
                            maxFiles: 10,
                            resourceType: "raw",
                            clientAllowedFormats: ["zip", "pdf", "doc", "docx", "xls", "xlsx"],
                            maxFileSize: 10000000,
                            multiple: true,
                            showCompletedButton: true,
                        }}
                    >
                        {({ open }) => (
                            <button className={styles.uploadButton} onClick={() => open()}>
                                <FiUpload className={styles.buttonIcon} />
                                Upload Files
                            </button>
                        )}
                    </CldUploadWidget>


                    <ul className={styles.fileList}>
                        {items.map((item, index) => {
                            const key = itemKey(item);
                            const isDeleting = deletingKeys.includes(key);
                            const name = fileName(item);
                            const size = formatSize(item.bytes);
                            const when = formatWhen(item);

                            return (
                                <li key={key || index} className={styles.fileItem}>
                                    <span className={styles.fileType} aria-hidden="true">
                                        {fileExtension(item)}
                                    </span>

                                    <div className={styles.fileInfo}>
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.fileLink}
                                            title={name}
                                        >
                                            {name}
                                        </a>
                                        {(size || when) && (
                                            <span className={styles.fileMeta} title={exactWhen(item)}>
                                                {[size, when].filter(Boolean).join(' \u00b7 ')}
                                            </span>
                                        )}
                                    </div>

                                    <div className={styles.fileActions}>
                                        <a href={item.url} download className={styles.downloadButton}>
                                            Download
                                        </a>
                                        <button
                                            className={styles.deleteFileButton}
                                            onClick={() => handleDeleteItem(item)}
                                            disabled={isDeleting || deleting}
                                            title={`Delete ${name}`}
                                            aria-label={`Delete ${name}`}
                                        >
                                            <FiTrash2 />
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {error && <div className={styles.error}>{error}</div>}
                    <div className={styles.instructions}>
                        You can also drag &amp; drop files here ({ALLOWED_EXTENSIONS.join(', ')})
                    </div>
                </div>
            )}
        </>
    );
};

export default FileShare;
