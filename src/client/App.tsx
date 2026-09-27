import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Clapperboard,
  FolderClosed,
  LayoutGrid,
  Power,
  ArrowUpRight,
  BookOpen,
} from 'lucide-react';
import type { ProjectSummary } from '../shared/model';
import { api, errorText } from './api';
import { Dashboard } from './Dashboard';
import { Review } from './Review';
import { HandoffGuide } from './HandoffGuide';
import { Modal } from './Modal';
import { saveBeforeStop } from './lifecycle';
import styles from './App.module.css';
export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');
  const location = useLocation();
  const refresh = useCallback(
    () =>
      api<ProjectSummary[]>('/projects')
        .then(setProjects)
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [location.pathname, refresh]);
  async function stopApp() {
    setStopping(true);
    setStopError('');
    try {
      await saveBeforeStop();
      await api('/shutdown', { method: 'POST' });
      setStopped(true);
    } catch (e) {
      setStopError(errorText(e));
    } finally {
      setStopping(false);
    }
  }
  if (stopped)
    return (
      <main className={styles.stoppedScreen}>
        <Power size={32} />
        <h1>App stopped</h1>
        <p>You can close this tab. Open the Footage Organizer desktop shortcut to start again.</p>
      </main>
    );
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand}>
          <span className={styles.brandIcon}>
            <Clapperboard size={23} />
          </span>
          <span>
            Footage
            <br />
            <b>Organizer</b>
          </span>
        </Link>
        <p className={styles.navLabel}>WORKSPACE</p>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
        >
          <LayoutGrid size={17} /> All projects
        </NavLink>
        <NavLink
          to="/handoff-guide"
          aria-label="Handoff guide"
          title="Handoff guide"
          className={({ isActive }) =>
            `${styles.navItem} ${isActive || location.pathname.endsWith('/handoff-guide') ? styles.active : ''}`
          }
        >
          <BookOpen size={17} /> <span>Handoff guide</span>
        </NavLink>
        <p className={styles.navLabel}>
          YOUR PROJECTS <span>{projects.length}</span>
        </p>
        <nav aria-label="Projects">
          {projects.map((project) => (
            <NavLink
              key={project.id}
              to={`/projects/${project.id}`}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <FolderClosed size={17} />
              <span>{project.name}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.localStatus}>
            <i /> Runs on your computer
          </div>
          <button className={styles.textButton} onClick={() => setSettings(true)}>
            App settings <ArrowUpRight size={14} />
          </button>
          <button
            className={styles.stopButton}
            onClick={stopApp}
            title="Stop the local app"
            aria-label="Stop app"
          >
            <Power size={17} /> <span>Stop app</span>
          </button>
          <span className={styles.version}>LOCAL · v0.1</span>
        </div>
      </aside>
      <div className={styles.workspace}>
        <main className={styles.main}>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
            </div>
          )}
          <Routes>
            <Route path="/" element={<Dashboard projects={projects} refresh={refresh} />} />
            <Route
              path="/handoff-guide"
              element={<HandoffGuide projects={projects} refresh={refresh} />}
            />
            <Route
              path="/projects/:projectId/handoff-guide"
              element={<HandoffGuide projects={projects} refresh={refresh} />}
            />
            <Route
              path="/projects/:projectId/next-batch"
              element={<HandoffGuide projects={projects} refresh={refresh} nextBatch />}
            />
            <Route
              path="/projects/:projectId"
              element={<Dashboard projects={projects} refresh={refresh} />}
            />
            <Route
              path="/projects/:projectId/batches/:batchId"
              element={<Review refreshProjects={refresh} />}
            />
          </Routes>
        </main>
      </div>
      {settings && (
        <Modal title="Your local workspace" onClose={() => setSettings(false)}>
          <p>
            The app runs on this computer. Closing a browser tab keeps it running so file operations
            can finish.
          </p>
          <p>
            Plans are saved in each project’s plan folder. The project context export gives your
            next review the folder structure and stable clip IDs.
          </p>
          <p>
            Use Stop app in the sidebar, or the Stop Footage Organizer desktop shortcut, to shut
            down the local app.
          </p>
        </Modal>
      )}
      {(stopping || stopError) && (
        <Modal
          title={stopping ? 'Stopping app…' : 'App is still running'}
          dismissible={!stopping}
          onClose={() => setStopError('')}
        >
          {stopping ? (
            <p>Saving your edits and stopping the local app.</p>
          ) : (
            <>
              <p role="alert">{stopError}</p>
              <button className={styles.secondary} onClick={() => setStopError('')}>
                Back to work
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
