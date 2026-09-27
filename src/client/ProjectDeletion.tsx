import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ProjectSummary, RemovedProject } from '../shared/model';
import { api, errorText } from './api';
import { Modal } from './Modal';
import styles from './App.module.css';

type DeleteResult = { plansDeleted: boolean; retainedFiles?: boolean; cleanupError?: string };
export function ProjectDeletion({
  project,
  disabled,
  onDeleted,
}: {
  project: ProjectSummary;
  disabled: boolean;
  onDeleted: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [deletePlans, setDeletePlans] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      const result = await api<DeleteResult>(`/projects/${project.id}`, {
        method: 'DELETE',
        body: { confirmProjectId: project.id, deletePlans },
      });
      const message = result.cleanupError
        ? `Project removed. Saved plans could not be fully cleaned up: ${result.cleanupError} Use Clean up removed projects to retry.`
        : result.plansDeleted
          ? `Project and saved plans deleted. Your footage is unchanged.${result.retainedFiles ? ' Other files in the plan folder were left in place.' : ''}`
          : 'Project removed. Your footage and saved plans are still on disk. Use Clean up removed projects if you want to delete the plans later.';
      await onDeleted(message);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={styles.projectDelete}>
        <button
          className={styles.dangerButton}
          disabled={disabled}
          onClick={() => {
            setDeletePlans(false);
            setError('');
            setOpen(true);
          }}
        >
          <Trash2 size={17} /> Delete project
        </button>
      </div>
      {open && (
        <Modal title="Delete project?" dismissible={!busy} onClose={() => setOpen(false)}>
          <p>
            Remove <strong>{project.name}</strong> and its {project.batches.length} review{' '}
            {project.batches.length === 1 ? 'batch' : 'batches'} from Footage Organizer?
          </p>
          <fieldset className={styles.deleteOptions} disabled={busy}>
            <legend>Saved plans</legend>
            <label>
              <input
                type="radio"
                name="delete-plans"
                checked={!deletePlans}
                onChange={() => setDeletePlans(false)}
              />
              <span>
                <b>Keep saved plans</b>
                <small>
                  Preserve notes and move history. You can reopen the project later using the same
                  ID and folders, or clean it up later.
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="delete-plans"
                checked={deletePlans}
                onChange={() => setDeletePlans(true)}
              />
              <span>
                <b>Delete saved plans too</b>
                <small>
                  Permanently delete this app’s saved plans, notes, imports, and move history.
                </small>
              </span>
            </label>
          </fieldset>
          <p>
            <strong>Your footage will stay untouched with either option.</strong>
          </p>
          <p className={styles.projectPath}>
            <b>Project ID:</b> {project.id}
            <br />
            <b>Plan folder:</b> {project.dataDir}
          </p>
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <div className={styles.modalFooter}>
            <button
              autoFocus
              className={styles.secondary}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button className={styles.dangerButton} disabled={busy} onClick={() => void remove()}>
              <Trash2 size={17} />
              {busy ? 'Deleting…' : 'Delete project'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function RemovedProjectsCleanup() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<RemovedProject[]>([]);
  const [selected, setSelected] = useState<RemovedProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    try {
      setRecords(await api<RemovedProject[]>('/removed-projects'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function cleanup() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ retainedFiles: boolean }>(
        `/removed-projects/${selected.removalId}`,
        { method: 'DELETE', body: { confirmRemovalId: selected.removalId } },
      );
      setRecords(records.filter((r) => r.removalId !== selected.removalId));
      setSelected(null);
      setNotice(
        `Saved plans deleted. Footage is unchanged.${result.retainedFiles ? ' Other files in the plan folder were left in place.' : ''}`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className={styles.secondary}
        onClick={() => {
          setSelected(null);
          setNotice('');
          setOpen(true);
          void load();
        }}
      >
        <Trash2 size={17} /> Clean up removed projects
      </button>
      {open && (
        <Modal
          title={selected ? 'Delete saved plans?' : 'Clean up removed projects'}
          dismissible={!busy}
          onClose={() => setOpen(false)}
        >
          {selected ? (
            <>
              <p>
                Permanently delete saved plans, notes, imports, and move history for{' '}
                <strong>{selected.project.name}</strong>?
              </p>
              <p className={styles.projectPath}>{selected.project.dataDir}</p>
              <p>
                Your footage and any unrelated files in the plan folder will stay untouched. Saved
                plans cannot be restored through the app after deletion.
              </p>
              <div className={styles.modalFooter}>
                <button
                  autoFocus
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    setSelected(null);
                    setError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className={styles.dangerButton}
                  disabled={busy}
                  onClick={() => void cleanup()}
                >
                  {busy ? 'Deleting…' : 'Delete saved plans'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                Projects removed with “Keep saved plans” appear here. Their footage is never
                deleted.
              </p>
              {notice && <p role="status">{notice}</p>}
              {busy ? (
                <p role="status">Loading removed projects…</p>
              ) : records.length ? (
                <div className={styles.cleanupList}>
                  {records.map((record) => (
                    <article key={record.removalId}>
                      <b>{record.project.name}</b>
                      <p className={styles.projectPath}>{record.project.dataDir}</p>
                      <small>Removed {new Date(record.removedAt).toLocaleDateString()}</small>
                      <button
                        className={styles.dangerButton}
                        onClick={() => {
                          setSelected(record);
                          setNotice('');
                          setError('');
                        }}
                      >
                        Delete saved plans for {record.project.name}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                !error && <p>No removed projects are waiting for cleanup.</p>
              )}
            </>
          )}
          {error && (
            <div className={styles.error} role="alert">
              {error}
              {!selected && (
                <button className={styles.secondary} disabled={busy} onClick={() => void load()}>
                  Retry
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
