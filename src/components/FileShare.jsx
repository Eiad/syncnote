import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { CldUploadWidget } from 'next-cloudinary';
import styles from './FileShare.module.scss';
import { useAuth } from '@/contexts/AuthContext';
import { FiUpload, FiTrash2, FiFileText } from 'react-icons/fi';
import { authedFetch } from '@/lib/authedFetch';
import { appendItem } from '@/lib/mediaDoc';
import { itemsFromData } from '@/lib/mediaSchema';

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

const itemKey = (item) => item.publicId || item.url;

const fileName = (item) => item.name || decodeURIComponent(item.url.split('/').pop());

const FileShare = ({ documentId }) => {
    const { user } = useAuth();
    const [items, setItems] = useState([]);
    const [deleting, setDeleting] = useState(false);
    const [deletingKeys, setDeletingKeys] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user) return;

        const docRef = doc(db, `users/${user.uid}/files`, documentId);

        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            // Reads the current shape and older { url, date } records alike.
            setItems(snapshot.exists() ? itemsFromData(snapshot.data(), 'files') : []);
        });

        return () => unsubscribe();
    }, [documentId, user]);

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
                collection: 'files',
                documentId,
                publicId: item.publicId,
                url: item.url
            });

            if (data.cloudinary === 'skipped') {
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
            // on Cloudinary. The endpoint now removes both.
            const data = await authedFetch('/api/deleteAll', {
                collection: 'files',
                documentId
            });

            if (data.failed?.length) {
                setError(`${data.failed.length} file(s) could not be deleted from Cloudinary and were kept.`);
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
                <div className={styles.container}>
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
                </div>
            )}
        </>
    );
};

export default FileShare;
