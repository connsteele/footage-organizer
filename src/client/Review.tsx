import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
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
  Plus,
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
  isInMoveQueue,
  targetPath,
  type Batch,
  type ClipEdit,
  type MoveReview,
  type Operation,
  type ProjectState,
} from '../shared/model';
import { batchMarkdown } from '../shared/markdown';
import { api, download, errorText } from './api';
import { useDraft } from './useDraft';
import { Modal } from './Modal';
import { HeldReviewTools } from './HeldReviewTools';
import { markerExport, sourceMarkers, pendingMarkerChanges } from '../shared/markers';
import { groupClipsByFolder } from '../shared/clipGroups';
import { folderProblem } from '../shared/filenames';
import { ClipRow } from './ClipRow';
import { FolderGroup } from './FolderGroup';
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
  const navigate = useNavigate();
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
  const [clipView, setClipView] = useState<'remaining' | 'queue' | 'held' | 'filed' | 'all'>(
    'remaining',
  );
  const [reviewFilter, setReviewFilter] = useState<'all' | 'unreviewed' | 'reviewed'>('all');
  const [error, setError] = useState('');
  const [review, setReview] = useState<MoveReview | null>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folder, setFolder] = useState('');
  const [folderError, setFolderError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [previewClip, setPreviewClip] = useState<number | null>(null);
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
  const held = batch.clips.filter((c) => c.held && !c.applied).length;
  const moved = batch.clips.filter((c) => c.applied).length;
  const remaining = batch.clips.filter((c) => !c.applied && !c.reviewed).length;
  const queued = batch.clips.filter(isInMoveQueue);
  const ready = queued.filter(isPending).length;
  const queuedUnchanged = queued.length - ready;
  const reviewedCount = batch.clips.filter((c) => c.reviewed).length;
  const views = [
    { value: 'remaining', label: 'Remaining', count: remaining },
    { value: 'queue', label: 'Move queue', count: queued.length },
    { value: 'held', label: 'Held', count: held },
    { value: 'filed', label: 'Filed', count: moved },
    { value: 'all', label: 'All', count: batch.clips.length },
  ] as const;
  const filtered = batch.clips.filter(
    (c) =>
      (clipView === 'all' ||
        (clipView === 'filed'
          ? c.applied
          : clipView === 'queue'
            ? isInMoveQueue(c)
            : !c.applied && (clipView === 'held' ? c.held : !c.reviewed))) &&
      (reviewFilter === 'all' || (reviewFilter === 'reviewed' ? c.reviewed : !c.reviewed)) &&
      [
        String(c.id),
        clipLabel(c.id),
        c.currentPath,
        targetPath(c),
        c.note,
        c.original.rationale,
        c.agentReview?.rationale ?? '',
      ].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  const totalSeconds = batch.clips.reduce((n, c) => n + (c.original.duration || 0), 0);
  const filteredGroups = groupClipsByFolder(filtered);
  const occupiedFolders = new Set(batch.clips.map((c) => c.proposed.folder));
  function chooseView(view: typeof clipView) {
    setPreviewClip(null);
    setClipView(view);
    // Remaining and Move queue already specify review state. Avoid carrying a
    // contradictory filter from All/Held/Filed into these workflow views.
    setReviewFilter('all');
  }
  async function startNextBatch() {
    try {
      await flush();
      navigate(`/projects/${project.id}/next-batch`);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function editClip(id: number, update: (clip: ClipEdit) => void) {
    change((draft) => {
      const clip = draft.clips.find((c) => c.id === id)!;
      update(clip);
    });
    setReview(null);
  }
  async function checkMoves() {
    setPreviewClip(null);
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
              {remaining
                ? 'IN REVIEW'
                : ready
                  ? 'READY TO MOVE'
                  : held
                    ? 'ON HOLD'
                    : 'ALL IN PLACE'}
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
          {batch.reviewFolder !== undefined && (
            <p>Review Footage: {batch.reviewFolder || 'Root Footage'}</p>
          )}
        </div>
        <div className={styles.headingActions}>
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
          <button
            className={pending ? styles.secondary : styles.primary}
            disabled={locked}
            onClick={() => void startNextBatch()}
          >
            <Plus size={18} /> Start next batch
          </button>
        </div>
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
          <span>Held for review</span>
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
              maxLength={64000}
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
      <HeldReviewTools
        projectId={project.id}
        batch={batch}
        locked={locked}
        flush={flush}
        reload={reload}
      />
      <div className={styles.clipFilters} role="group" aria-label="Clip status">
        {views.map((view) => (
          <button
            key={view.value}
            className={`${styles.filterButton} ${clipView === view.value ? styles.filterActive : ''}`}
            aria-pressed={clipView === view.value}
            onClick={() => chooseView(view.value)}
          >
            {view.label} <span>{view.count}</span>
          </button>
        ))}
      </div>
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
        {clipView !== 'remaining' && clipView !== 'queue' && (
          <label className={styles.reviewFilter}>
            Review status
            <select
              value={reviewFilter}
              onChange={(event) => {
                setPreviewClip(null);
                setReviewFilter(event.target.value as typeof reviewFilter);
              }}
            >
              <option value="all">All review states</option>
              <option value="unreviewed">Needs review</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </label>
        )}
        <span className={styles.reviewProgress} role="status">
          {reviewedCount} of {batch.clips.length} clips reviewed
        </span>
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
          <button
            className={styles.secondary}
            disabled={locked || clipView === 'filed'}
            onClick={() => {
              setFolderError('');
              setAdding(true);
            }}
          >
            <Plus size={16} /> Folder
          </button>
        </div>
      </div>
      <div className={styles.listHeading}>
        <span>
          {clipView === 'remaining'
            ? 'REMAINING CLIPS'
            : clipView === 'queue'
              ? 'MOVE QUEUE'
              : clipView === 'held'
                ? 'HELD FOR REVIEW'
                : clipView === 'filed'
                  ? 'FILED CLIPS'
                  : 'ALL CLIPS'}
        </span>
        <span>
          {clipView === 'filed'
            ? 'Completed placements are kept here for reference.'
            : 'Drag a clip into a folder, or open Details to choose its destination.'}
        </span>
      </div>
      {clipView === 'queue' && (
        <p className={styles.muted}>
          Reviewed clips wait here until you confirm Move clips. Held clips stay in Held.
          {queuedUnchanged > 0 && ` ${queuedUnchanged} already in place; no file changes needed.`}
        </p>
      )}
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
            const clips = filteredGroups.get(folderName) ?? [];
            const emptyDestination =
              !search &&
              reviewFilter === 'all' &&
              (clipView === 'all' ||
                (clipView === 'remaining' && remaining > 0) ||
                (clipView === 'queue' && queued.length > 0)) &&
              !occupiedFolders.has(folderName);
            if (!clips.length && active === null && !emptyDestination) return null;
            return (
              <FolderGroup
                key={folderName}
                name={folderName}
                count={clips.length}
                isNew={!knownFolders.includes(folderName) && !!folderName}
                onRename={
                  locked || clipView === 'filed'
                    ? undefined
                    : () => {
                        setRenaming(folderName);
                        setFolderError('');
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
                    prefix={prefix}
                    previewOpen={previewClip === clip.id && !locked}
                    onPreview={() => setPreviewClip(previewClip === clip.id ? null : clip.id)}
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
          {!filtered.length && (
            <div className={styles.empty}>
              {search || reviewFilter !== 'all' ? (
                <>
                  <h3>No matching clips in this view</h3>
                  <p>Clear the search or choose another file or review status above.</p>
                </>
              ) : clipView === 'remaining' ? (
                <>
                  <h3>No clips left to review</h3>
                  <p>
                    {queued.length
                      ? 'Your reviewed clips are in Move queue.'
                      : 'This batch is saved.'}
                    {held > 0 && ` ${held} held clips remain available in Held.`}
                  </p>
                  <button
                    className={styles.textButton}
                    onClick={() => chooseView(queued.length ? 'queue' : held ? 'held' : 'filed')}
                  >
                    {queued.length
                      ? 'View move queue'
                      : held
                        ? 'View held clips'
                        : 'View filed clips'}
                  </button>
                </>
              ) : (
                <h3>
                  {clipView === 'queue'
                    ? 'No clips in the move queue — mark a clip Reviewed to add it'
                    : clipView === 'held'
                      ? 'No clips held for review'
                      : clipView === 'filed'
                        ? 'No filed clips yet'
                        : 'No clips in this batch'}
                </h3>
              )}
            </div>
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
                        {i.markerRewrite && i.status === 'ambiguous' && (
                          <button
                            className={styles.secondary}
                            disabled={locked}
                            onClick={async () => {
                              try {
                                await flush();
                                await api(`/projects/${project.id}/restore-marker-original`, {
                                  method: 'POST',
                                  body: { operationId: op.id, clipId: i.clipId },
                                });
                                await reload();
                              } catch (e) {
                                setError(errorText(e));
                              }
                            }}
                          >
                            Restore original for retry
                          </button>
                        )}
                      </p>
                    ))}
                  {op.items
                    .filter((i) => i.markerRewrite)
                    .map((i) => (
                      <p key={`backup-${i.clipId}`}>
                        #{clipLabel(i.clipId)} original backup: {i.markerRewrite!.backupPath}
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
      <div className={styles.actionbar} data-review-actions>
        <div>
          <strong>
            {ready
              ? `${ready} clips ready to move`
              : remaining
                ? `${remaining} clips left to review`
                : held
                  ? `${held} clips held for review`
                  : queued.length
                    ? 'No pending moves'
                    : 'All clips filed'}
          </strong>
          <span>
            {ready
              ? 'Move clips includes the whole move queue, regardless of filters. Held and unreviewed clips stay in place.'
              : remaining
                ? 'Mark clips Reviewed to build your move queue.'
                : queuedUnchanged
                  ? 'Reviewed clips already in place remain in Move queue; no files need changing.'
                  : 'Held and filed clips remain available in their views.'}
          </span>
        </div>
        <div className={styles.inlineActions}>
          {batch.clips.some((c) => sourceMarkers(c).length) && (
            <button
              className={styles.textButton}
              disabled={locked}
              onClick={async () => {
                try {
                  await flush();
                  const saved = await api<ProjectState>(`/projects/${project.id}`);
                  download(`${batch.id}-markers.json`, {
                    schemaVersion: 2,
                    kind: 'batch-marker-review',
                    projectId: project.id,
                    batchId: batch.id,
                    clips: saved.batches
                      .find((b) => b.id === batch.id)!
                      .clips.filter((c) => sourceMarkers(c).length)
                      .map(markerExport),
                  });
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Export markers
            </button>
          )}
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
          {ready || remaining ? (
            <button
              className={styles.primary}
              disabled={!ready || checking || locked || status === 'error'}
              onClick={() => void checkMoves()}
            >
              {checking ? <LoaderCircle size={17} className={styles.spin} /> : <Folder size={17} />}
              {checking ? 'Checking files…' : `Move clips · ${ready}`}
              <ArrowRight size={17} />
            </button>
          ) : (
            <button
              className={styles.primary}
              disabled={locked}
              onClick={() => void startNextBatch()}
            >
              <Plus size={18} /> Start next batch
            </button>
          )}
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
              const problem = folderProblem(name);
              if (problem) {
                setFolderError(problem);
                return;
              }
              const filedIds = new Set(
                batch.clips.filter((clip) => clip.applied).map((clip) => clip.id),
              );
              change((b) => {
                if (renaming !== null) {
                  b.folders = b.folders.filter((f) => f !== renaming);
                  for (const clip of b.clips)
                    if (!filedIds.has(clip.id) && clip.proposed.folder === renaming)
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
                maxLength={1500}
                value={folder}
                onChange={(e) => {
                  setFolder(e.target.value);
                  setFolderError('');
                }}
              />
            </label>
            {folderError && (
              <p className={styles.error} role="alert">
                {folderError}
              </p>
            )}
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
            {review.items.length} clips will be moved, renamed, or have reviewed marker changes
            written from the move queue. {review.held} held · {review.unreviewed ?? 0} not reviewed
            · {review.unchanged} unchanged. Search and status filters do not change which queued
            clips are included.
          </p>
          {review.items.some((i) => i.markerChanges?.length) && (
            <p>
              Marker changes copy the media streams without re-encoding. Originals are retained
              under Root Footage/.footage-organizer-originals; the move log records each backup.
              Preparation and verification can take longer than an ordinary move.
            </p>
          )}
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
                  {item.markerChanges?.map((m) => (
                    <p key={m.markerId}>
                      {m.action === 'delete'
                        ? 'Delete marker'
                        : m.action === 'add'
                          ? 'Add marker'
                          : 'Rename marker'}{' '}
                      at {durationLabel(m.seconds)}:{' '}
                      {m.action === 'add'
                        ? m.label
                        : m.action === 'delete'
                          ? m.originalLabel || '(unnamed)'
                          : `${m.originalLabel || '(unnamed)'} → ${m.label}`}
                    </p>
                  ))}
                  {!!pendingMarkerChanges(batch.clips.find((c) => c.id === item.clipId)!) && (
                    <p className={styles.conflict}>
                      Pending marker names keep their originals; pending additions are not written.
                      Accept the marker changes you want before filing; filed marker decisions are
                      locked.
                    </p>
                  )}
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
                  {item.markerRewrite && <p>Original backup: {item.markerRewrite.backupPath}</p>}
                  {item.markerRewrite && item.status === 'ambiguous' && (
                    <button
                      className={styles.secondary}
                      onClick={async () => {
                        try {
                          await api(`/projects/${project.id}/restore-marker-original`, {
                            method: 'POST',
                            body: { operationId: executing.id, clipId: item.clipId },
                          });
                          await reload();
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    >
                      Restore original for retry
                    </button>
                  )}
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
