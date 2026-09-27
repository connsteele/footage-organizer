import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './App.module.css';
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.modal} ${wide ? styles.wide : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      aria-label={title}
    >
      <div className={styles.modalHeading}>
        <h2>{title}</h2>
        {dismissible && (
          <button className={styles.iconButton} aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
