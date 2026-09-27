import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Folder,
  GripVertical,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Undo2,
  Redo2,
  AlertCircle,
} from 'lucide-react';
import {
  clipLabel,
  durationLabel,
  editOf,
  isPending,
  targetPath,
  type Batch,
  type BatchClip,
  type MoveReview,
  type Operation,
  type ProjectState,
} from '../shared/model';
import { batchMarkdown } from '../shared/markdown';
import { api, download, errorText } from './api';
import { useDraft } from './useDraft';
import { Modal } from './Modal';
import styles from './App.module.css';

export function Review({ refreshProjects }: { refreshProjects: () => Promise<void> }) {
  const { projectId = '', batchId = '' } = useParams();
  const [state, setState] = useState<ProjectState | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const data = await api<ProjectState>(`/projects/${projectId}`);
      if (generation !== loadGeneration.current) return;
      setState(data);
      setVersion((v) => v + 1);
      setError('');
      await refreshProjects();
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(errorText(e));
    }
  }, [projectId, refreshProjects]);
  useEffect(() => {
    setState(null);
    void reload();
    return () => {
      // This ref is a request counter, not a DOM node; cancellation invalidates its current generation.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadGeneration.current++;
    };
  }, [reload, batchId]);
  const batch = state?.batches.find((b) => b.id === batchId);
  if (error)
    return (
      <div className={styles.error} role="alert">
        {error}
        <button onClick={() => void reload()}>Retry</button>
      </div>
    );
  if (!state)
    return (
      <div className={styles.empty}>
        <LoaderCircle className={styles.spin} /> Opening your batch…
      </div>
    );
  if (!batch)
    return (
      <div className={styles.empty}>
        Batch not found. <Link to={`/projects/${projectId}`}>Back to project</Link>
      </div>
    );
  return (
    <ReviewSession
      key={`${projectId}-${batchId}-${version}`}
      initial={batch}
      state={state}
      reload={reload}
    />
  );
}

function ReviewSession({
  initial,
  state,
  reload,
}: {
  initial: Batch;
  state: ProjectState;
  reload: () => Promise<void>;
}) {
  const project = state.project;
  const {
    batch,
    status,
    error: saveError,
    change,
    flush,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDraft(project.id, initial);
  const [search, setSearch] = useState('');
  const [onlyHeld, setOnlyHeld] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<MoveReview | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folder, setFolder] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [knownFolders, setKnownFolders] = useState<string[]>([]);
  const [executing, setExecuting] = useState<Operation | null>(
    state.operations.find((o) => o.batchId === batch.id && o.status === 'running') || null,
  );
  const [starting, setStarting] = useState(false);
  const retryPoll = useRef(false);
  const locked = !!executing || starting;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const prefix = `/projects/${project.id}/batches/${batch.id}`;
  useEffect(() => {
    api<string[]>(`/projects/${project.id}/folders`)
      .then(setKnownFolders)
      .catch((e) => setError(errorText(e)));
  }, [project.id]);
  useEffect(() => {
    if (executing?.status !== 'running') return;
    const poll = async () => {
      if (retryPoll.current) return;
      retryPoll.current = true;
      try {
        const updated = await api<ProjectState>(`/projects/${project.id}`);
        const operation = updated.operations.find((o) => o.id === executing.id);
        if (operation) setExecuting(operation);
      } catch (e) {
        setError(`Waiting to reconnect. ${errorText(e)}`);
      } finally {
        retryPoll.current = false;
      }
    };
    const timer = setInterval(() => void poll(), 750);
    return () => clearInterval(timer);
  }, [executing?.id, executing?.status, project.id]);
  const folders = [
    ...new Set([...batch.folders, ...batch.clips.map((c) => c.proposed.folder)]),
  ].sort();
  const choices = [...new Set(['', ...folders, ...knownFolders])].sort();
  const pending = batch.clips.filter(isPending).length;
  const held = batch.clips.filter((c) => c.held).length;
  const moved = batch.clips.filter((c) => c.applied).length;
  const filtered = batch.clips.filter(
    (c) =>
      (!onlyHeld || c.held) &&
      [
        String(c.id),
        clipLabel(c.id),
        c.currentPath,
        targetPath(c),
        c.note,
        c.original.rationale,
      ].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  const totalSeconds = batch.clips.reduce((n, c) => n + (c.original.duration || 0), 0);
  function editClip(id: number, update: (clip: BatchClip) => void) {
    change((draft) => {
      const clip = draft.clips.find((c) => c.id === id)!;
      update(clip);
    });
    setReview(null);
  }
  async function checkMoves() {
    setChecking(true);
    setError('');
    try {
      await flush();
      setReview(await api<MoveReview>(`${prefix}/review`, { method: 'POST' }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  }
  async function startMoves() {
    if (!review || starting) return;
    setStarting(true);
    setError('');
    try {
      const operation = await api<Operation>(`${prefix}/move`, {
        method: 'POST',
        body: { reviewId: review.id },
      });
      setExecuting(operation);
      setReview(null);
    } catch (e) {
      setError(errorText(e));
      setReview(null);
    } finally {
      setStarting(false);
    }
  }
  const operations = state.operations.filter((o) => o.batchId === batch.id);
  return (
    <>
      <DraftNavigationGuard pending={status !== 'saved'} flush={flush} />
      <div className={styles.breadcrumb}>
        <Link to={`/projects/${project.id}`}>{project.name}</Link>
        <span>/</span>Batch review
      </div>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.pill}>
              {pending ? 'IN REVIEW' : held ? 'ON HOLD' : 'ALL IN PLACE'}
            </span>
            <span className={styles.saveState}>
              {status === 'saved' ? (
                <Check size={13} />
              ) : status === 'error' ? (
                <AlertCircle size={13} />
              ) : (
                <LoaderCircle size={13} className={styles.spin} />
              )}
              {status === 'saved'
                ? 'All changes saved'
                : status === 'error'
                  ? 'Not saved'
                  : 'Saving changes…'}
            </span>
          </div>
          <h1>{batch.title}</h1>
          <p>
            {batch.clips.length} clips ·{' '}
            {totalSeconds < 60
              ? `${Math.round(totalSeconds)} seconds`
              : `${Math.round(totalSeconds / 60)} minutes`}{' '}
            of footage · Imported{' '}
            {new Date(batch.importedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          className={styles.secondary}
          disabled={locked}
          onClick={async () => {
            try {
              await flush();
              const saved = await api<ProjectState>(`/projects/${project.id}`);
              download(
                `${batch.id}.md`,
                batchMarkdown(
                  saved.project,
                  saved.batches.find((b) => b.id === batch.id)!,
                  saved.operations,
                ),
                'text/markdown',
              );
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <Download size={16} /> Export Markdown
        </button>
      </div>
      {(error || saveError) && (
        <div className={styles.error} role="alert">
          {error || saveError}
          {saveError && (
            <div className={styles.inlineActions}>
              <button onClick={() => download(`${batch.id}-unsaved-draft.json`, editOf(batch))}>
                Download my edits
              </button>
              <button onClick={() => void reload()}>Reload saved batch</button>
            </div>
          )}
        </div>
      )}
      <div className={styles.batchStats}>
        <div>
          <b>{pending}</b>
          <span>Pending placements</span>
        </div>
        <div>
          <b>{folders.length}</b>
          <span>Destination folders</span>
        </div>
        <div>
          <b>{held}</b>
          <span>Held for later</span>
        </div>
        <div>
          <b>{moved}</b>
          <span>Filed successfully</span>
        </div>
      </div>
      <details className={styles.notesPanel}>
        <summary>
          <FileText size={18} />
          <span>Review notes & decisions</span>
          <span className={styles.summaryHint}>The thinking behind this batch</span>
          <ChevronDown size={16} />
        </summary>
        <div className={styles.notesGrid}>
          <div>
            <span className={styles.eyebrow}>FROM THE REVIEW</span>
            <div className={styles.prose}>
              {batch.reviewNotes || 'No batch notes were included in this handoff.'}
            </div>
          </div>
          <label>
            Your decisions
            <textarea
              rows={6}
              value={batch.notes}
              disabled={locked}
              onChange={(e) =>
                change((b) => {
                  b.notes = e.target.value;
                })
              }
              placeholder="Keep a record of your choices, questions, or changes…"
            />
          </label>
        </div>
      </details>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={17} />
          <input
            aria-label="Search clips"
            placeholder="Search names, notes, or clip IDs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={onlyHeld}
            onChange={(e) => setOnlyHeld(e.target.checked)}
          />
          Held only
        </label>
        <div className={styles.toolbarEnd}>
          <button
            className={styles.iconButton}
            title="Undo edit"
            aria-label="Undo edit"
            disabled={!canUndo || locked}
            onClick={undo}
          >
            <Undo2 size={17} />
          </button>
          <button
            className={styles.iconButton}
            title="Redo edit"
            aria-label="Redo edit"
            disabled={!canRedo || locked}
            onClick={redo}
          >
            <Redo2 size={17} />
          </button>
          <button className={styles.secondary} disabled={locked} onClick={() => setAdding(true)}>
            <Plus size={16} /> Folder
          </button>
        </div>
      </div>
      <div className={styles.listHeading}>
        <span>PROPOSED PLACEMENTS</span>
        <span>Drag a clip into a folder, or open Details to choose its destination.</span>
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={(event) => setActive(Number(event.active.id))}
        onDragCancel={() => setActive(null)}
        onDragEnd={(event) => {
          if (event.over && !locked)
            editClip(Number(event.active.id), (c) => {
              c.proposed.folder = String(event.over!.id);
            });
          setActive(null);
        }}
      >
        <div className={styles.folderList}>
          {folders.map((folderName) => {
            const clips = filtered.filter((c) => c.proposed.folder === folderName);
            if (!clips.length && (search || onlyHeld) && active === null) return null;
            return (
              <FolderGroup
                key={folderName}
                name={folderName}
                count={clips.length}
                isNew={!knownFolders.includes(folderName) && !!folderName}
                onRename={
                  locked
                    ? undefined
                    : () => {
                        setRenaming(folderName);
                        setFolder(folderName);
                        setAdding(true);
                      }
                }
              >
                {clips.map((clip) => (
                  <ClipRow
                    key={clip.id}
                    clip={clip}
                    choices={choices}
                    locked={locked}
                    onChange={(update) => editClip(clip.id, update)}
                    onPlay={async () => {
                      try {
                        await api(`${prefix}/player`, {
                          method: 'POST',
                          body: { clipId: clip.id },
                        });
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  />
                ))}
                {!clips.length && <div className={styles.emptyFolder}>Drop a clip here</div>}
              </FolderGroup>
            );
          })}
          {!filtered.length && (search || onlyHeld) && (
            <div className={styles.empty}>No clips match this filter.</div>
          )}
        </div>
        <DragOverlay>
          {active !== null && (
            <div className={styles.dragOverlay}>
              <GripVertical size={17} /> {clipLabel(active)} ·{' '}
              {batch.clips.find((c) => c.id === active)?.proposed.filename}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {!!operations.length && (
        <details className={styles.notesPanel}>
          <summary>
            <CheckCircle2 size={18} />
            Move history<span className={styles.summaryHint}>{operations.length} operations</span>
            <ChevronDown size={16} />
          </summary>
          <div className={styles.history}>
            {operations
              .slice()
              .reverse()
              .map((op) => (
                <div key={op.id}>
                  <b>
                    {op.status === 'completed'
                      ? 'Completed'
                      : op.status === 'running'
                        ? 'In progress'
                        : 'Stopped for review'}
                  </b>
                  <span>
                    {new Date(op.startedAt).toLocaleString()} ·{' '}
                    {op.items.filter((i) => i.status === 'succeeded').length} of {op.items.length}{' '}
                    filed
                  </span>
                  {op.items
                    .filter((i) => i.error)
                    .map((i) => (
                      <p key={i.clipId}>
                        #{clipLabel(i.clipId)} — {i.error}
                      </p>
                    ))}
                </div>
              ))}
            <button
              className={styles.secondary}
              onClick={async () => {
                try {
                  await api(`/projects/${project.id}/recover`, { method: 'POST' });
                  await reload();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Check recovery
            </button>
            <button
              className={styles.textButton}
              onClick={() => download(`${batch.id}-operations.json`, operations)}
            >
              Download move log
            </button>
          </div>
        </details>
      )}
      <div className={styles.actionbar}>
        <div>
          <strong>
            {pending
              ? `${pending} clips ready for review`
              : held
                ? `${held} clips held for later`
                : 'Everything is in place'}
          </strong>
          <span>
            {held
              ? `${held} held clips will stay where they are.`
              : 'Your edits become file changes after you confirm.'}
          </span>
        </div>
        <div className={styles.inlineActions}>
          <button
            className={styles.textButton}
            disabled={locked}
            onClick={async () => {
              try {
                await flush();
                const saved = await api<ProjectState>(`/projects/${project.id}`);
                download(`${batch.id}-plan.json`, {
                  project: saved.project,
                  batch: saved.batches.find((b) => b.id === batch.id),
                });
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Export plan
          </button>
          <button
            className={styles.primary}
            disabled={!pending || checking || locked || status === 'error'}
            onClick={() => void checkMoves()}
          >
            {checking ? <LoaderCircle size={17} className={styles.spin} /> : <Folder size={17} />}
            {checking ? 'Checking files…' : `Move clips · ${pending}`}
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      {adding && (
        <Modal
          title={renaming !== null ? 'Change proposed folder' : 'Add a destination folder'}
          onClose={() => {
            setAdding(false);
            setRenaming(null);
            setFolder('');
          }}
        >
          <p>
            Enter a path beneath the footage folder. This changes proposed placements; existing
            folders and already filed clips stay in place.
          </p>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              const name = folder.trim().replaceAll('\\', '/');
              if (
                !name ||
                name.split('/').some((p) => !p || p === '.' || p === '..' || /[<>:"|?*]/.test(p))
              )
                return;
              change((b) => {
                if (renaming !== null) {
                  b.folders = b.folders.filter((f) => f !== renaming);
                  for (const clip of b.clips)
                    if (!clip.applied && clip.proposed.folder === renaming)
                      clip.proposed.folder = name;
                }
                if (!b.folders.includes(name)) b.folders.push(name);
              });
              setAdding(false);
              setRenaming(null);
              setFolder('');
            }}
          >
            <label>
              Folder path
              <input
                required
                autoFocus
                placeholder="Narrative/Act 1/Cai"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
            </label>
            <button className={styles.primary}>
              {renaming !== null ? 'Update placements' : 'Add folder'}
              <Plus size={16} />
            </button>
          </form>
        </Modal>
      )}
      {review && (
        <Modal
          title="Review your file changes"
          wide
          onClose={() => {
            if (!starting) setReview(null);
          }}
        >
          <p>
            {review.items.length} clips will be moved or renamed. {review.held} held ·{' '}
            {review.unchanged} unchanged. This includes clips hidden by your search filter.
          </p>
          {review.issues.length > 0 && (
            <div className={styles.error} role="alert">
              <b>Resolve these before moving</b>
              {review.issues.map((issue, index) => (
                <p key={index}>
                  {issue.clipId !== null ? `#${clipLabel(issue.clipId)} — ` : ''}
                  {issue.message}
                </p>
              ))}
            </div>
          )}
          {review.newFolders.length > 0 && (
            <p className={styles.muted}>New folders: {review.newFolders.join(', ')}</p>
          )}
          <div className={styles.moveList}>
            {review.items.map((item) => (
              <div key={item.clipId}>
                <span className={styles.clipId}>#{clipLabel(item.clipId)}</span>
                <div>
                  <small>{item.from}</small>
                  <p>
                    <ArrowRight size={14} /> {item.to}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.modalFooter}>
            <button
              className={styles.secondary}
              disabled={starting}
              onClick={() => setReview(null)}
            >
              Back to editing
            </button>
            <button
              className={styles.primary}
              disabled={starting || !!review.issues.length || !review.items.length}
              onClick={() => void startMoves()}
            >
              {starting ? 'Starting…' : `Move ${review.items.length} clips`}
              <ArrowRight size={17} />
            </button>
          </div>
        </Modal>
      )}
      {executing && (
        <Modal
          title={
            executing.status === 'running'
              ? 'Putting your clips in place'
              : executing.status === 'completed'
                ? 'Your footage is filed.'
                : 'Some clips need another look'
          }
          wide
          onClose={() => {
            if (executing.status !== 'running') void reload();
          }}
        >
          <p>
            {executing.items.filter((i) => i.status === 'succeeded').length} of{' '}
            {executing.items.length} clips filed
            {executing.status === 'running'
              ? '. You can leave this tab open while the app works.'
              : '. Every completed move has been recorded.'}
          </p>
          <progress
            max={executing.items.length}
            value={executing.items.filter((i) => i.status === 'succeeded').length}
          />
          <div className={styles.moveList}>
            {executing.items.map((item) => (
              <div key={item.clipId}>
                <span>
                  {item.status === 'succeeded' ? (
                    <CheckCircle2 size={18} />
                  ) : item.status === 'moving' ? (
                    <LoaderCircle size={18} className={styles.spin} />
                  ) : (
                    <span className={styles.clipId}>#{clipLabel(item.clipId)}</span>
                  )}
                </span>
                <div>
                  <p>{item.to}</p>
                  <small>{item.error || item.status}</small>
                </div>
              </div>
            ))}
          </div>
          {executing.status !== 'running' && (
            <div className={styles.modalFooter}>
              <button
                className={styles.textButton}
                onClick={() => download(`${executing.id}-move-log.json`, executing)}
              >
                Download move log
              </button>
              <button className={styles.primary} onClick={() => void reload()}>
                Back to batch
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function DraftNavigationGuard({
  pending,
  flush,
}: {
  pending: boolean;
  flush: () => Promise<void>;
}) {
  const blocker = useBlocker(pending);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    void flush()
      .then(() => {
        if (!cancelled) blocker.proceed();
      })
      .catch(() => {
        if (!cancelled) blocker.reset();
      });
    return () => {
      cancelled = true;
    };
  }, [blocker, flush]);
  return null;
}

function FolderGroup({
  name,
  count,
  isNew,
  children,
  onRename,
}: {
  name: string;
  count: number;
  isNew: boolean;
  children: React.ReactNode;
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
function ClipRow({
  clip,
  choices,
  locked,
  onChange,
  onPlay,
}: {
  clip: BatchClip;
  choices: string[];
  locked: boolean;
  onChange: (update: (clip: BatchClip) => void) => void;
  onPlay: () => void;
}) {
  const [details, setDetails] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: clip.id,
    disabled: locked || clip.applied,
  });
  const originalName = clip.currentPath.split('/').at(-1);
  const renamed = originalName !== clip.proposed.filename;
  const movedFolder = clip.currentPath.split('/').slice(0, -1).join('/') !== clip.proposed.folder;
  const status = clip.applied
    ? 'Filed'
    : clip.held
      ? 'Held'
      : renamed
        ? movedFolder
          ? 'Rename + move'
          : 'Rename'
        : clip.currentPath === targetPath(clip)
          ? 'Unchanged'
          : 'Move';
  return (
    <article
      ref={setNodeRef}
      className={`${styles.clipRow} ${clip.held ? styles.heldRow : ''} ${isDragging ? styles.dragging : ''}`}
    >
      <div className={styles.clipMain}>
        <button
          {...attributes}
          {...listeners}
          disabled={locked || clip.applied}
          className={styles.dragHandle}
          aria-label={`Drag clip ${clipLabel(clip.id)}`}
        >
          <GripVertical size={18} />
        </button>
        <span className={styles.clipId}>{clipLabel(clip.id)}</span>
        <div className={styles.clipName}>
          <input
            aria-label={`Filename for clip ${clipLabel(clip.id)}`}
            value={clip.proposed.filename}
            disabled={locked || clip.applied}
            onChange={(e) =>
              onChange((c) => {
                c.proposed.filename = e.target.value;
              })
            }
            spellCheck={false}
          />
          <span title={clip.currentPath}>
            {renamed ? `Current: ${originalName}` : clip.original.rationale || clip.currentPath}
          </span>
        </div>
        <span className={styles.duration}>{durationLabel(clip.original.duration)}</span>
        <span
          className={`${styles.statusPill} ${clip.held ? styles.heldPill : clip.applied ? styles.filedPill : ''}`}
        >
          {status}
        </span>
        <button
          aria-label={`Open clip ${clipLabel(clip.id)} in player`}
          className={styles.iconButton}
          disabled={locked}
          title="Open in player"
          onClick={onPlay}
        >
          <Play size={16} />
        </button>
        <button
          className={styles.detailsButton}
          aria-expanded={details}
          aria-label={`Details for clip ${clipLabel(clip.id)}`}
          onClick={() => setDetails(!details)}
        >
          Details
          <ChevronDown size={13} />
        </button>
      </div>
      {clip.importIssue && (
        <p className={styles.rowWarning}>
          <AlertCircle size={14} />
          {clip.importIssue}
        </p>
      )}
      {clip.original.questions.length > 0 && (
        <p className={styles.rowQuestion}>
          <AlertCircle size={14} />
          {clip.original.questions.join(' · ')}
        </p>
      )}
      {details && (
        <div className={styles.clipDetails}>
          <div>
            <label>
              Destination
              <select
                aria-label="Destination"
                value={clip.proposed.folder}
                disabled={locked || clip.applied}
                onChange={(e) =>
                  onChange((c) => {
                    c.proposed.folder = e.target.value;
                  })
                }
              >
                {choices.map((f) => (
                  <option key={f} value={f}>
                    {f || 'Media root'}
                  </option>
                ))}
              </select>
            </label>
            <p>
              <b>Current path</b>
              <br />
              {clip.currentPath}
            </p>
            <p>
              <b>Review rationale</b>
              <br />
              {clip.original.rationale || 'No additional rationale.'}
            </p>
            {clip.original.markers.length > 0 && (
              <div>
                <b>Markers</b>
                {clip.original.markers.map((m, i) => (
                  <p key={i}>
                    {durationLabel(m.seconds)} — {m.label}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div>
            <label>
              Your note
              <textarea
                aria-label="Your note"
                rows={3}
                value={clip.note}
                disabled={locked}
                placeholder="Why this placement? Anything to revisit?"
                onChange={(e) =>
                  onChange((c) => {
                    c.note = e.target.value;
                  })
                }
              />
            </label>
            <div className={styles.detailActions}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={clip.held}
                  disabled={locked || clip.applied}
                  onChange={(e) =>
                    onChange((c) => {
                      c.held = e.target.checked;
                    })
                  }
                />
                <Pause size={14} /> Hold for later
              </label>
              <button
                className={styles.textButton}
                disabled={locked || clip.applied}
                onClick={() =>
                  onChange((c) => {
                    c.proposed = { ...c.original.proposed };
                    c.note = '';
                    c.held = c.original.hold || c.original.questions.length > 0;
                  })
                }
              >
                <RotateCcw size={13} />
                Reset suggestion
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
