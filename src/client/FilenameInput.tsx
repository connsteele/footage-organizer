import { useId } from 'react';
import styles from './App.module.css';

export function FilenameInput({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (filename: string) => void;
}) {
  const extensionId = useId();
  const dot = value.lastIndexOf('.');
  const extension = dot < 0 ? '' : value.slice(dot);
  const name = dot < 0 ? value : value.slice(0, dot);
  return (
    <div className={`${styles.filenameEditor} ${disabled ? styles.filenameDisabled : ''}`}>
      <span className={styles.filenameStem}>
        <span className={styles.filenameMeasure} aria-hidden="true">
          {name || ' '}
        </span>
        <input
          aria-label={label}
          aria-describedby={extension ? extensionId : undefined}
          value={name}
          disabled={disabled}
          onChange={(e) => onChange(`${e.target.value}${extension}`)}
          spellCheck={false}
          autoComplete="off"
        />
      </span>
      {extension && (
        <span
          id={extensionId}
          className={styles.filenameExtension}
          title="File extension (not editable)"
        >
          {extension}
        </span>
      )}
    </div>
  );
}
