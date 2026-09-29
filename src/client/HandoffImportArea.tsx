import { useRef, useState } from 'react';
import { FileJson, Upload } from 'lucide-react';
import styles from './App.module.css';

export function HandoffImportArea({
  disabled,
  importing,
  onImport,
}: {
  disabled: boolean;
  importing: boolean;
  onImport: (file?: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  function choose(files: FileList | null) {
    if (disabled || !files?.length) return;
    setError('');
    if (files.length !== 1) {
      setError('Import one reviewed handoff JSON at a time.');
      return;
    }
    void onImport(files[0]);
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Reviewed handoff JSON"
        hidden
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = '';
        }}
      />
      <div className={styles.handoffImport}>
        <button
          className={styles.primary}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={17} /> {importing ? 'Importing…' : 'Import reviewed handoff'}
        </button>
        <div
          role="region"
          aria-label="Drop reviewed handoff"
          aria-disabled={disabled}
          className={`${styles.handoffDrop} ${dragging && !disabled ? styles.handoffDropActive : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes('Files')) {
              depth.current++;
              setDragging(true);
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            depth.current = Math.max(0, depth.current - 1);
            if (!depth.current) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            depth.current = 0;
            setDragging(false);
            choose(event.dataTransfer.files);
          }}
        >
          <FileJson size={24} aria-hidden="true" />
          <span>
            {importing ? 'Importing your handoff…' : 'Or drop a reviewed handoff JSON here'}
          </span>
        </div>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
    </>
  );
}
