import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Plus,
  Upload,
  FolderOpen,
  Download,
  FileJson,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import type { Project, ProjectSummary } from '../shared/model';
import { api, download, errorText } from './api';
import { Modal } from './Modal';
import { useHandoffImport } from './useHandoffImport';
import { FolderField } from './FolderField';
import { ProjectDeletion, RemovedProjectsCleanup } from './ProjectDeletion';
import styles from './App.module.css';

export function Dashboard({
  projects,
  refresh,
}: {
  projects: ProjectSummary[];
  refresh: () => Promise<void>;
}) {
  const { projectId } = useParams();
  const project = projects.find((p) => p.id === projectId);
  const navigate = useNavigate();
  const location = useLocation();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const { importing, error: importError, importFile } = useHandoffImport(project?.id, refresh);
  const file = useRef<HTMLInputElement>(null);
  const batchCount = projects.reduce((sum, p) => sum + p.batches.length, 0);
  return (
    <>
      <div className={styles.breadcrumb}>
        {project ? (
          <>
            <Link to="/">Projects</Link>
            <span>/</span>
            {project.name}
          </>
        ) : (
          'YOUR WORKSPACE'
        )}
      </div>
      <div className={styles.pageHeading}>
        <div>
          <h1>{project ? project.name : 'A place for every clip.'}</h1>
          <p>
            {project
              ? 'Review a handoff. Make it yours. File the footage.'
              : 'Bring your review into focus, then put everything where it belongs.'}
          </p>
        </div>
        <div className={styles.headingActions}>
          {project ? (
            <>
              <button
                className={styles.secondary}
                disabled={importing}
                onClick={() => file.current?.click()}
              >
                <Upload size={17} /> Import handoff
              </button>
              <Link className={styles.primary} to={`/projects/${project.id}/next-batch`}>
                <Plus size={18} /> Start next batch
              </Link>
            </>
          ) : (
            <>
              <RemovedProjectsCleanup />
              <button className={styles.primary} onClick={() => setCreating(true)}>
                <Plus size={18} /> New project
              </button>
            </>
          )}
        </div>
      </div>
      {!project && location.state?.projectMessage && (
        <p className={styles.notice} role="status">
          {location.state.projectMessage}
        </p>
      )}
      {(error || importError) && (
        <div className={styles.error} role="alert">
          {error || importError}
        </div>
      )}
      {project ? (
        <>
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
          <section className={styles.projectMeta}>
            <div>
              <span className={styles.eyebrow}>ROOT FOOTAGE</span>
              <p>{project.mediaRoot}</p>
              {project.reviewFolder !== undefined && (
                <p>Default review folder: {project.reviewFolder || '(Root Footage)'}</p>
              )}
            </div>
            <div className={styles.guideDownloads}>
              <button
                className={styles.secondary}
                onClick={async () => {
                  try {
                    download(
                      `${project.id}-context.json`,
                      await api(`/projects/${project.id}/context`),
                    );
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                <Download size={16} /> Export project context
              </button>
            </div>
          </section>
          <section
            className={styles.dropzone}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              void importFile(e.dataTransfer.files[0]);
            }}
          >
            <span className={styles.largeIcon}>
              <FileJson size={25} />
            </span>
            <div>
              <h3>{importing ? 'Reading your handoff…' : 'Your next batch starts here'}</h3>
              <p>
                Drop a review handoff JSON here, or choose a file. Your footage stays where it is.
              </p>
            </div>
            <button
              className={styles.textButton}
              disabled={importing}
              onClick={() => file.current?.click()}
            >
              Choose handoff <ArrowRight size={16} />
            </button>
          </section>
          <div className={styles.sectionHeading}>
            <h2>Review batches</h2>
            <span>
              {project.batches.length} {project.batches.length === 1 ? 'batch' : 'batches'}
            </span>
          </div>
          {project.batches.length ? (
            <div className={styles.batchList}>
              {project.batches.map((batch) => (
                <Link
                  className={styles.batchCard}
                  to={`/projects/${project.id}/batches/${batch.id}`}
                  key={batch.id}
                >
                  <span className={styles.largeIcon}>
                    {batch.pending || batch.held ? (
                      <Layers size={23} />
                    ) : (
                      <CheckCircle2 size={23} />
                    )}
                  </span>
                  <div>
                    <h3>{batch.title}</h3>
                    <p>
                      {batch.clips} clips · {batch.pending} pending · {batch.held} held
                    </p>
                  </div>
                  <span className={styles.date}>
                    {new Date(batch.importedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <ArrowRight size={19} />
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <h3>Ready for your first handoff.</h3>
              <p>
                Export the project context for the chat reviewing your clips, then import its
                proposed placements here.
              </p>
            </div>
          )}
          <details className={styles.storageDetails}>
            <summary>Project details</summary>
            <p>
              <b>Project ID:</b> {project.id}
            </p>
            <p>
              <b>Saved plans:</b> {project.dataDir}
            </p>
            <p>{project.namingNotes || 'No naming notes yet.'}</p>
          </details>
          <ProjectDeletion
            project={project}
            disabled={importing}
            onDeleted={async (projectMessage) => {
              await refresh();
              navigate('/', { state: { projectMessage } });
            }}
          />
        </>
      ) : (
        <>
          <div className={styles.overviewStats}>
            <div>
              <b>{String(projects.length).padStart(2, '0')}</b>
              <span>Projects</span>
            </div>
            <div>
              <b>{String(batchCount).padStart(2, '0')}</b>
              <span>Review batches</span>
            </div>
            <div>
              <b>{projects.reduce((sum, p) => sum + p.clipCount, 0)}</b>
              <span>Catalogued clips</span>
            </div>
            <p>
              Cut & mark <ArrowRight size={14} /> Review <ArrowRight size={14} /> Organize
            </p>
          </div>
          <div className={styles.sectionHeading}>
            <h2>Your projects</h2>
            <span>One workflow. Every video.</span>
          </div>
          <div className={styles.projectGrid}>
            {projects.map((p) => (
              <Link className={styles.projectCard} key={p.id} to={`/projects/${p.id}`}>
                <span className={styles.largeIcon}>
                  <FolderOpen size={26} />
                </span>
                <h3>{p.name}</h3>
                <p>
                  {p.batches.length} review batches · {p.clipCount} clips
                </p>
                <div className={styles.cardFooter}>
                  <span>{p.batches.reduce((n, b) => n + b.pending, 0)} pending placements</span>
                  <ArrowRight size={18} />
                </div>
              </Link>
            ))}
            <button className={styles.newProjectCard} onClick={() => setCreating(true)}>
              <Plus size={25} />
              <h3>Start a project</h3>
              <p>
                Connect a footage folder
                <br />
                and bring in your review.
              </p>
            </button>
          </div>
          <section className={styles.howItWorks}>
            <span className={styles.eyebrow}>FROM HANDOFF TO HOME</span>
            <div>
              <article>
                <b>01</b>
                <h3>Bring in the review</h3>
                <p>Import suggested filenames, folder placements, and the thinking behind them.</p>
              </article>
              <article>
                <b>02</b>
                <h3>Make the final call</h3>
                <p>
                  Edit names, drag clips into folders, and hold anything that needs another look.
                </p>
              </article>
              <article>
                <b>03</b>
                <h3>Put it in place</h3>
                <p>
                  Review the exact changes. Move your clips and keep a record of every decision.
                </p>
              </article>
            </div>
          </section>
        </>
      )}
      {creating && (
        <CreateProject
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await refresh();
            navigate(`/projects/${id}`);
          }}
        />
      )}
    </>
  );
}
function CreateProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    id: '',
    mediaRoot: '',
    reviewFolder: '',
    dataDir: '',
    namingNotes: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const project = await api<Project>('/projects', { method: 'POST', body: form });
      onCreated(project.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Start a project" onClose={onClose}>
      <p>Connect your existing footage folder. Plans and decisions will be saved separately.</p>
      <form className={styles.form} onSubmit={(e) => void submit(e)}>
        <label>
          Project name
          <input
            required
            value={form.name}
            placeholder="My footage review"
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                id: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, '')
                  .slice(0, 80),
              })
            }
          />
        </label>
        <label>
          Project ID
          <input
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}"
            value={form.id}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
          />
          <small>Use this same ID in the review handoff.</small>
        </label>
        <FolderField
          label="Root Footage"
          required
          value={form.mediaRoot}
          disabled={busy}
          onChange={(mediaRoot) => setForm({ ...form, mediaRoot })}
          help="Top-level footage library containing incoming clips and their destination folders."
        />
        <FolderField
          label="Review Footage"
          required
          value={form.reviewFolder}
          initialPath={form.mediaRoot}
          disabled={busy}
          onChange={(reviewFolder) => setForm({ ...form, reviewFolder })}
          help="Clips waiting for review. Choose a folder inside Root Footage. Each batch can use a different review folder."
        />
        <FolderField
          label="Plan folder"
          required
          value={form.dataDir}
          disabled={busy}
          onChange={(dataDir) => setForm({ ...form, dataDir })}
          help="Choose a separate folder for saved plans and move records. You can type a new folder path."
        />
        <label>
          Naming notes <span className={styles.optional}>(optional)</span>
          <textarea
            rows={2}
            value={form.namingNotes}
            onChange={(e) => setForm({ ...form, namingNotes: e.target.value })}
            placeholder="Prefixes, chapter numbers, or conventions for this project…"
          />
        </label>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <button className={styles.primary} disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
          <ArrowRight size={16} />
        </button>
      </form>
    </Modal>
  );
}
