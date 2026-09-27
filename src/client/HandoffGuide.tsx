import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { ProjectState, ProjectSummary } from '../shared/model';
import { api, download, errorText } from './api';
import { buildHandoffKit, handoffDocuments } from './handoffKit';
import styles from './App.module.css';

export function HandoffGuide({ projects }: { projects: ProjectSummary[] }) {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function exportKit() {
    if (!project) return;
    setBusy(true);
    setError('');
    try {
      const [state, folders] = await Promise.all([
        api<ProjectState>(`/projects/${project.id}`),
        api<string[]>(`/projects/${project.id}/folders`),
      ]);
      if (state.operations.some((operation) => operation.status === 'running'))
        throw new Error('Wait for the current move to finish, then download a fresh handoff kit.');
      download(`${project.id}-handoff-kit.md`, buildHandoffKit(state, folders), 'text/markdown');
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
        Handoff guide
      </div>
      <div className={styles.pageHeading}>
        <div>
          <h1>Handoff guide</h1>
          <p>Give any review conversation the instructions and project context it needs.</p>
        </div>
      </div>
      <section className={styles.guideCard} aria-labelledby="kit-heading">
        <h2 id="kit-heading">Start a review conversation</h2>
        <p>
          Select a project and download one file with the instructions, current clip IDs and paths,
          saved decisions, an example, and the handoff format. Share it with your clips or review
          material.
        </p>
        <div className={styles.kitControls}>
          <label>
            Project
            <select
              aria-label="Project"
              value={projectId || ''}
              disabled={busy}
              onChange={(e) =>
                navigate(
                  e.target.value ? `/projects/${e.target.value}/handoff-guide` : '/handoff-guide',
                )
              }
            >
              <option value="">Choose a project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.primary}
            disabled={!project || busy}
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
        <h2 id="workflow-heading">How a handoff works</h2>
        <ol>
          <li>
            <b>You cut and mark footage.</b> Share the kit and review material with your preferred
            agent.
          </li>
          <li>
            <b>The agent returns a handoff JSON.</b> Each clip has its current path, stable ID,
            suggested filename and folder, and reasoning. Unresolved questions start held.
          </li>
          <li>
            <b>You import and edit the plan.</b> Change destinations, names, notes, and holds in the
            app.
          </li>
          <li>
            <b>You review and move.</b> Move clips shows the exact file changes before you execute
            them.
          </li>
        </ol>
        <p>
          For follow-up reviews, the kit includes saved decisions. Export plan and Export Markdown
          provide more detail about a particular batch. These exports are reference material; the
          agent must return a separate handoff JSON for import.
        </p>
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
