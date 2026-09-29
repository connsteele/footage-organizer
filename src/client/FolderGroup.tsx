import { useDroppable } from '@dnd-kit/core';
import { Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './App.module.css';

export function FolderGroup({
  name,
  count,
  isNew,
  children,
  onRename,
}: {
  name: string;
  count: number;
  isNew: boolean;
  children: ReactNode;
  onRename?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: name });
  return (
    <section
      ref={setNodeRef}
      className={`${styles.folderGroup} ${isOver ? styles.dropActive : ''}`}
    >
      <div className={styles.folderHeading}>
        <Folder size={19} />
        <h2>{name || 'Media root'}</h2>
        {isNew && <span className={styles.newBadge}>NEW FOLDER</span>}
        <span className={styles.folderCount}>
          {count} {count === 1 ? 'clip' : 'clips'}
        </span>
        {onRename && (
          <button
            className={styles.detailsButton}
            onClick={onRename}
            aria-label={`Change proposed folder ${name || 'Media root'}`}
          >
            Edit folder
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
