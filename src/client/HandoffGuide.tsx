import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import type { ProjectState, ProjectSummary, ReviewInventory } from '../shared/model';
import { api, download, errorText } from './api';
import { buildHandoffKit, handoffDocuments } from './handoffKit';
import { useHandoffImport } from './useHandoffImport';
import { FolderField } from './FolderField';
import styles from './App.module.css';

export function HandoffGuide({
  projects,
  refresh,
  nextBatch = false,
}: {
  projects: ProjectSummary[];
  refresh: () => Promise<void>;
  nextBatch?: boolean;
}) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewFolders, setReviewFolders] = useState<Record<string, string>>({});
  const reviewFolder = project
    ? (reviewFolders[project.id] ??
      (project.reviewFolder === undefined
        ? ''
        : [project.mediaRoot.replace(/[\\/]$/, ''), project.reviewFolder]
            .filter(Boolean)
            .join('/')))
    : '';
  const [inventory, setInventory] = useState<ReviewInventory | null>(null);
  const [notice, setNotice] = useState('');
  const {
    importing,
    error: importError,
    importFile,
  } = useHandoffImport(project?.id, refresh, reviewFolder || undefined);
  const file = useRef<HTMLInputElement>(null);

  async function exportKit() {
    if (!project) return;
    setBusy(true);
    setError('');
    try {
      const [state, folders, scanned] = await Promise.all([
        api<ProjectState>(`/projects/${project.id}`),
        api<string[]>(`/projects/${project.id}/folders`),
        reviewFolder
          ? api<ReviewInventory>(`/projects/${project.id}/review-inventory`, {
              method: 'POST',
              body: { folder: reviewFolder },
            })
          : Promise.resolve(undefined),
      ]);
      if (state.operations.some((operation) => operation.status === 'running'))
        throw new Error('Wait for the current move to finish, then download a fresh handoff kit.');
      if (scanned && !scanned.files.length)
        throw new Error(
          'No supported media files were found in Review Footage. Choose a folder containing the next clips.',
        );
      setInventory(scanned ?? null);
      download(
        `${project.id}-handoff-kit.md`,
        buildHandoffKit(state, folders, undefined, scanned),
        'text/markdown',
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.breadcrumb}>
        <Link to="/">Projects</Link>
        <span>/</span>
        {project && (
          <>
            <Link to={`/projects/${project.id}`}>{project.name}</Link>
            <span>/</span>
          </>
        )}
        {nextBatch ? 'Start next batch' : 'Handoff guide'}
      </div>
      <div className={styles.pageHeading}>
        <div>
          <h1>{nextBatch ? 'Start next batch' : 'Handoff guide'}</h1>
          <p>
            {nextBatch
              ? 'Prepare another review in this project. Earlier batches and held clips stay available.'
              : 'Give any review conversation the instructions and project context it needs.'}
          </p>
        </div>
        {project && (
          <Link className={styles.secondary} to={`/projects/${project.id}`}>
            Back to batches
          </Link>
        )}
      </div>
      <section className={styles.guideCard} aria-labelledby="kit-heading">
        <h2 id="kit-heading">1. Choose footage and download a kit</h2>
        <p>
          Select a project and its incoming footage folder. Download one file with the instructions,
          file inventory, current clip IDs, saved decisions, an example, and the handoff format.
          Share it with your clips or review material.
        </p>
        <div className={styles.kitControls}>
          <label>
            Project
            <select
              aria-label="Project"
              value={projectId || ''}
              disabled={busy || importing}
              onChange={(e) => {
                setInventory(null);
                setNotice('');
                setError('');
                navigate(
                  e.target.value
                    ? `/projects/${e.target.value}/${nextBatch ? 'next-batch' : 'handoff-guide'}`
                    : '/handoff-guide',
                );
              }}
            >
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {project && (
          <>
            <p className={styles.guideHint}>
              <b>Root Footage:</b> {project.mediaRoot}
            </p>
            <FolderField
              label="Review Footage"
              value={reviewFolder}
              initialPath={project.mediaRoot}
              disabled={busy || importing}
              onChange={(folder) => {
                setReviewFolders({ ...reviewFolders, [project.id]: folder });
                setInventory(null);
                setNotice('');
              }}
              help="Choose this batch's incoming clips inside Root Footage. The kit lists supported media in this folder and its subfolders, including which clips already belong to a batch."
            />
            <button
              className={styles.textButton}
              disabled={!reviewFolder.trim() || busy || importing}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await api(`/projects/${project.id}/review-folder`, {
                    method: 'PUT',
                    body: { folder: reviewFolder },
                  });
                  await refresh();
                  setNotice('Default review folder saved.');
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save as default review folder
            </button>
            {notice && <p role="status">{notice}</p>}
            {inventory && (
              <p role="status">
                Kit ready: {inventory.files.length} media files ·{' '}
                {inventory.files.filter((f) => f.existingClipId === null).length} new ·{' '}
                {inventory.files.filter((f) => f.existingClipId !== null).length} already tracked.
              </p>
            )}
          </>
        )}
        <div className={styles.guideDownloads}>
          <button
            className={styles.primary}
            disabled={!project || busy || importing || (nextBatch && !reviewFolder.trim())}
            onClick={() => void exportKit()}
          >
            <Download size={16} /> {busy ? 'Preparing kit…' : 'Download handoff kit'}
          </button>
        </div>
        {!projects.length && (
          <p>
            <Link to="/" className={styles.textButton}>
              Create a project first
            </Link>{' '}
            to include your own context.
          </p>
        )}
        <p className={styles.guideHint}>
          The kit contains saved paths and notes. It does not include video or change any files.
          Download a fresh one after edits or moves.
        </p>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
      </section>
      <section className={styles.guideCard} aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">2. Review the next footage</h2>
        <p>
          Give the kit and the next set of cut, marked clips to your review conversation. Ask for a
          new batch containing those clips, using this project's folders, naming conventions, and
          saved decisions. Keep source clips beneath the same footage folder.
        </p>
        <p className={styles.guideHint}>
          The agent returns a handoff JSON with proposed names, folders, and reasoning. You will
          review those suggestions before any footage moves. Held clips from earlier batches can be
          resolved separately whenever you are ready.
        </p>
        <p>
          To revisit held clips, open their existing batch and use Agent follow-up → Export held
          clips for review. Import the returned batch update there to compare and accept suggestions
          while preserving your notes.
        </p>
      </section>
      <section className={styles.guideCard} aria-labelledby="import-heading">
        <h2 id="import-heading">3. Import the reviewed handoff</h2>
        <p>
          When the review is ready, choose its handoff JSON. Import creates a batch in the selected
          project and opens it for your edits. Existing batches and their held clips are preserved.
        </p>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className={styles.guideDownloads}>
          <button
            className={styles.primary}
            disabled={!project || importing || busy || (nextBatch && !reviewFolder.trim())}
            onClick={() => file.current?.click()}
          >
            <Upload size={17} /> {importing ? 'Importing…' : 'Import reviewed handoff'}
          </button>
        </div>
        {importError && (
          <div className={styles.error} role="alert">
            {importError}
          </div>
        )}
      </section>
      <section className={styles.guideCard} aria-labelledby="reference-heading">
        <h2 id="reference-heading">Format and agent reference</h2>
        <p>
          The full guide covers clip IDs, paths, metadata, held clips, and revisions. These are the
          same documents shipped in the repository; any agent can read them without this
          conversation.
        </p>
        <div className={styles.guideDownloads}>
          <button
            className={styles.secondary}
            onClick={() =>
              download(
                'handoff-guide.md',
                `${handoffDocuments.agentGuide}\n\n---\n\n${handoffDocuments.protocol}`,
                'text/markdown',
              )
            }
          >
            Download guide
          </button>
          <button
            className={styles.secondary}
            onClick={() => download('handoff.schema.json', handoffDocuments.schema)}
          >
            Download JSON schema
          </button>
          <button
            className={styles.secondary}
            onClick={() => download('handoff-example.json', handoffDocuments.example)}
          >
            Download example
          </button>
        </div>
        <details className={styles.protocolDetails}>
          <summary>Read full handoff protocol</summary>
          <pre>{handoffDocuments.protocol}</pre>
        </details>
      </section>
    </>
  );
}
