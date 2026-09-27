import { useId, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { api, errorText } from './api';
import styles from './App.module.css';

export function FolderField({
  label,
  value,
  onChange,
  help,
  initialPath = '',
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  initialPath?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState('');
  async function browse() {
    setBrowsing(true);
    setError('');
    try {
      const result = await api<{ path: string | null }>('/browse-folder', {
        method: 'POST',
        body: { initialPath: value || initialPath },
      });
      if (result.path !== null) onChange(result.path);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBrowsing(false);
    }
  }
  return (
    <div className={styles.folderField}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.folderInput}>
        <input
          id={id}
          value={value}
          required={required}
          disabled={disabled || browsing}
          aria-describedby={`${id}-help`}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Choose a folder or paste its full path"
        />
        <button
          type="button"
          className={styles.secondary}
          disabled={disabled || browsing}
          onClick={() => void browse()}
          aria-label={`Browse ${label}`}
        >
          <FolderOpen size={17} />
          {browsing ? 'Choosing…' : 'Browse'}
        </button>
      </div>
      <small id={`${id}-help`}>{help}</small>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
