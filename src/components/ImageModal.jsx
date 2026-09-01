import { useEffect } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import styles from './ImageModal.module.scss';

const ImageModal = ({ imageUrl, onClose, onDelete, deleting = false }) => {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>×</button>
        {onDelete && (
          <button
            className={styles.deleteButton}
            onClick={onDelete}
            disabled={deleting}
            title="Delete this image"
            aria-label="Delete this image"
          >
            <FiTrash2 />
          </button>
        )}
        <img src={imageUrl} alt="Full size" className={styles.image} />
      </div>
    </div>
  );
};

export default ImageModal;
