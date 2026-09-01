import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { CldUploadWidget } from 'next-cloudinary';
import styles from './FileShare.module.scss';
import { useAuth } from '@/contexts/AuthContext';
import { FiUpload, FiTrash2, FiFileText, FiUploadCloud } from 'react-icons/fi';
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


                    <div className={styles.fileGrid}>
                        {items.map((item, index) => {
                            const key = itemKey(item);
                            const isDeleting = deletingKeys.includes(key);

                            return (
                                <div key={key || index} className={styles.fileItem}>
                                    <div className={styles.fileTitle}>
                                        <FiFileText className={styles.fileIcon} />
                                        <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.fileLink}>
                                            {fileName(item)}
                                        </a>
                                    </div>
                                    <div className={styles.fileDetails}>
                                        <span className={styles.uploadDate}>{item.date}</span>
                                        <a href={item.url} download className={styles.downloadButton}>
                                            Download
                                        </a>
                                        <button
                                            className={styles.deleteFileButton}
                                            onClick={() => handleDeleteItem(item)}
                                            disabled={isDeleting || deleting}
                                            title="Delete this file"
                                            aria-label={`Delete ${fileName(item)}`}
                                        >
                                            <FiTrash2 />
                                            {isDeleting ? 'Deleting...' : 'Delete'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
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
