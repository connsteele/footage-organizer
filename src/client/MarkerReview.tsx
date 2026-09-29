import { memo, useId, useMemo, useState } from 'react';
import { Check, Info, RotateCcw, Undo2, Plus, Trash2 } from 'lucide-react';
import type { BatchClip, ClipEdit, MarkerDecision } from '../shared/model';
import {
  effectiveMarkers,
  sourceMarkers,
  writesMarker,
  type EditableMarker,
  markerDecisionsById,
  markerSuggestionsById,
} from '../shared/markers';
import { markerTime, type PreviewMarker } from '../shared/media';
import styles from './App.module.css';
import { Modal } from './Modal';

const noPreviewMarkers: PreviewMarker[] = [];

export const MarkerReview = memo(function MarkerReview({
  clip,
  locked,
  onChange,
  onSeek,
  duration = 0,
  previewMarkers = noPreviewMarkers,
  showHeading = true,
  getPosition,
}: {
  clip: BatchClip;
  locked: boolean;
  onChange: (update: (clip: ClipEdit) => void) => void;
  onSeek?: (seconds: number) => void;
  duration?: number;
  previewMarkers?: PreviewMarker[];
  showHeading?: boolean;
  getPosition?: () => number;
}) {
  const fieldId = useId();
  const [reasons, setReasons] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<EditableMarker | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [writeToFile, setWriteToFile] = useState(true);
  const [error, setError] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const disabled = locked || clip.applied;
  const { markers, entries, suggestions, decisions } = useMemo(() => {
    const markers = sourceMarkers(clip);
    const effective = effectiveMarkers(clip);
    const markersByLabel = new Map<string, number[]>();
    for (const marker of effective) {
      const label = marker.label.trim() || 'Unnamed marker';
      const times = markersByLabel.get(label) ?? [];
      times.push(marker.seconds);
      markersByLabel.set(label, times);
    }
    // Keep original IDs for editing. Add only playback markers not already represented
    // by an imported marker's effective name and time (including accepted renames).
    const extra = previewMarkers.filter(
      (m) => !markersByLabel.get(m.label)?.some((seconds) => Math.abs(seconds - m.seconds) < 0.001),
    );
    const usedIds = new Set(markers.map((m) => m.id));
    const entries = [
      ...markers.map((marker) => ({ marker, reviewable: true as const })),
      ...extra.map((marker, i) => {
        let id = `preview-chapter-${marker.chapterIndex ?? i}`;
        while (usedIds.has(id)) id += '-extra';
        usedIds.add(id);
        return {
          marker: { ...marker, id, origin: 'discovered' as const },
          reviewable: marker.chapterIndex !== undefined,
        };
      }),
    ].sort((a, b) => a.marker.seconds - b.marker.seconds);
    return {
      markers,
      entries,
      suggestions: markerSuggestionsById(clip),
      decisions: markerDecisionsById(clip),
    };
  }, [clip, previewMarkers]);
  function decide(markerId: string, label: string, status: MarkerDecision['status']) {
    setError('');
    onChange((c) => {
      const marker = entries.find((e) => e.marker.id === markerId)?.marker;
      if (marker && !markers.some((m) => m.id === markerId) && marker.chapterIndex !== undefined)
        c.localMarkers = [
          ...(c.localMarkers ?? []),
          { ...marker, origin: 'discovered', chapterIndex: marker.chapterIndex },
        ];
      c.markerDecisions = [
        ...(c.markerDecisions ?? []).filter((d) => d.markerId !== markerId),
        { markerId, label, status },
      ];
    });
  }
  const deleted = entries.filter(({ marker }) => decisions.get(marker.id)?.status === 'deleted');
  const unreviewed = entries.filter(
    ({ marker }) => !decisions.has(marker.id) || decisions.get(marker.id)?.status === 'pending',
  ).length;
  function closeAdd() {
    setAdding(false);
    setError('');
  }
  function addMarker(event: React.FormEvent) {
    event.preventDefault();
    const parts = time.trim().split(':');
    const valid =
      parts.length <= 3 &&
      parts.every((part, i) => (i === parts.length - 1 ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(part)) &&
      parts.slice(1).every((part) => Number(part) < 60);
    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
    const limit = duration || clip.original.duration;
    if (
      !valid ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      (limit !== null && seconds >= limit)
    ) {
      setError('Enter a time before the end of the clip, as seconds or HH:MM:SS.mmm.');
      return;
    }
    if (
      entries.some(
        ({ marker }) =>
          decisions.get(marker.id)?.status !== 'deleted' &&
          Math.abs(marker.seconds - seconds) < 0.001,
      )
    ) {
      setError('A marker already exists at this time. Choose a different time.');
      return;
    }
    if (!name.trim()) {
      setError('Enter a marker name.');
      return;
    }
    if (entries.length >= 10000) {
      setError('This clip has reached the 10,000 marker limit.');
      return;
    }
    const id = `added-${crypto.randomUUID()}`;
    onChange((c) => {
      c.localMarkers = [
        ...(c.localMarkers ?? []),
        { id, origin: 'added', seconds, label: name.trim(), writeToFile },
      ];
      c.markerDecisions = [
        ...(c.markerDecisions ?? []),
        { markerId: id, label: name.trim(), status: 'accepted' },
      ];
    });
    setError('');
    setAdding(false);
  }
  return (
    <section className={styles.markerReview} aria-label={`Marker names for clip ${clip.id}`}>
      {showHeading && <h3>Marker names</h3>}
      <div className={styles.markerToolbar}>
        <span>
          {unreviewed} need review · {entries.length - deleted.length - unreviewed} reviewed
        </span>
        <button
          className={styles.secondary}
          disabled={disabled}
          onClick={() => {
            setName('');
            setTime(markerTime(getPosition?.() ?? 0));
            setError('');
            setWriteToFile(true);
            setAdding(true);
          }}
        >
          <Plus size={16} /> Add marker
        </button>
      </div>
      <p className={styles.markerHint}>
        Embedded changes are written with Move clips. Export-only markers stay in your plan.
      </p>
      {!!deleted.length && (
        <button className={styles.textButton} onClick={() => setShowDeleted(!showDeleted)}>
          {showDeleted ? 'Hide' : 'Show'} deleted markers ({deleted.length})
        </button>
      )}
      {error && !adding && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {entries.map(({ marker: m, reviewable }) => {
        if (!reviewable)
          return (
            <MarkerSeekButton
              key={`playback-${m.id}`}
              marker={m}
              duration={duration}
              onSeek={onSeek}
            />
          );
        const suggestion = suggestions.get(m.id);
        const decision = decisions.get(m.id);
        if (decision?.status === 'deleted')
          return showDeleted ? (
            <div className={`${styles.markerCard} ${styles.deletedMarker}`} key={m.id}>
              <span>
                Deleted · Time: {markerTime(m.seconds)} · {m.label}
              </span>
              <button
                className={styles.textButton}
                disabled={disabled}
                onClick={() => {
                  if (
                    entries.some(
                      ({ marker }) =>
                        marker.id !== m.id &&
                        decisions.get(marker.id)?.status !== 'deleted' &&
                        Math.abs(marker.seconds - m.seconds) < 0.001 &&
                        (marker.origin === 'added' || m.origin === 'added'),
                    )
                  ) {
                    setError(
                      'Another marker now occupies this time. Delete it before restoring this marker.',
                    );
                    return;
                  }
                  decide(m.id, m.label, 'pending');
                }}
              >
                <Undo2 size={16} /> Restore marker
              </button>
            </div>
          ) : null;
        const label = decision?.label ?? suggestion?.proposedLabel ?? m.label;
        const canSeek = !!onSeek && duration > 0 && m.seconds <= duration;
        return (
          <div
            className={`${styles.markerCard} ${styles.markerComparison} ${canSeek ? styles.markerClickable : ''}`}
            key={`review-${m.id}`}
            onClick={(event) => {
              // Text/background clicks seek; editing, labels and review controls keep
              // their own actions. The separate native button supports keyboard seeking.
              if (
                !canSeek ||
                (event.target as Element).closest('button, input, label, a, select, textarea')
              )
                return;
              if (window.getSelection()?.type === 'Range') return;
              onSeek?.(m.seconds);
            }}
          >
            {onSeek && (
              <button
                type="button"
                className={styles.markerCardSeek}
                title="Seek to this marker"
                aria-label={`Seek to marker ${m.id} at ${markerTime(m.seconds)}`}
                disabled={!canSeek}
                onClick={() => onSeek(m.seconds)}
              />
            )}
            <div className={styles.markerHeading}>
              <span className={styles.markerTime}>
                Time: <time>{markerTime(m.seconds)}</time>
              </span>
              <span>
                {writesMarker(m)
                  ? m.origin === 'added'
                    ? 'New chapter'
                    : 'Embedded chapter'
                  : 'Export only'}{' '}
                ·{' '}
                {decision?.status === 'accepted'
                  ? clip.applied && m.chapterIndex !== undefined
                    ? 'Written to file'
                    : 'Reviewed'
                  : decision?.status === 'rejected'
                    ? 'Reviewed · Keeping original'
                    : 'Needs review'}
              </span>
            </div>
            <div className={styles.markerNames}>
              <label htmlFor={`${fieldId}-${m.id}`}>New:</label>
              <input
                id={`${fieldId}-${m.id}`}
                aria-label={`New marker name ${m.id} for clip ${clip.id}`}
                value={label}
                maxLength={4000}
                disabled={locked || clip.applied}
                onChange={(e) => decide(m.id, e.target.value, 'pending')}
              />
              <button
                type="button"
                className={styles.markerAction}
                title={label.trim() === m.label ? 'Mark reviewed' : 'Accept name and mark reviewed'}
                aria-label={`Accept name for marker ${m.id}`}
                aria-pressed={decision?.status === 'accepted'}
                disabled={
                  locked || clip.applied || !label.trim() || decision?.status === 'accepted'
                }
                onClick={() => decide(m.id, label.trim(), 'accepted')}
              >
                <Check size={18} />
              </button>
              <span className={styles.muted}>{m.origin === 'added' ? 'Added:' : 'Original:'}</span>
              <span className={styles.markerOriginal}>{m.label || '(unnamed)'}</span>
              <button
                type="button"
                className={styles.markerAction}
                title="Keep original"
                aria-label={`Keep original for marker ${m.id}`}
                aria-pressed={decision?.status === 'rejected'}
                disabled={
                  locked || clip.applied || decision?.status === 'rejected' || m.origin === 'added'
                }
                onClick={() => decide(m.id, label, 'rejected')}
              >
                <Undo2 size={18} />
              </button>
            </div>
            <div className={styles.markerContext}>
              <button
                className={styles.iconButton}
                title="Delete marker"
                aria-label={`Delete marker ${m.id}`}
                disabled={disabled}
                onClick={() => setDeleting(m)}
              >
                <Trash2 size={17} />
              </button>
              {suggestion?.rationale && (
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Why this name?"
                  aria-label={`Why this name for marker ${m.id}?`}
                  aria-expanded={!!reasons[m.id]}
                  aria-controls={`${fieldId}-${m.id}-reason`}
                  onClick={() => setReasons((values) => ({ ...values, [m.id]: !values[m.id] }))}
                >
                  <Info size={17} />
                </button>
              )}
              {(suggestion || (decision && decision.status !== 'pending')) && (
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Mark as needs review"
                  aria-label={`Reset marker ${m.id}`}
                  disabled={locked || clip.applied}
                  onClick={() => decide(m.id, suggestion?.proposedLabel ?? label, 'pending')}
                >
                  <RotateCcw size={16} />
                </button>
              )}
            </div>
            {suggestion?.rationale && (
              <p
                className={styles.markerReason}
                id={`${fieldId}-${m.id}-reason`}
                hidden={!reasons[m.id]}
              >
                {suggestion.rationale}
              </p>
            )}
          </div>
        );
      })}
      {deleting && (
        <Modal title="Delete marker?" onClose={() => setDeleting(null)}>
          <p>
            Delete “{deleting.label || '(unnamed)'}” at {markerTime(deleting.seconds)}?
          </p>
          <p>
            {deleting.chapterIndex !== undefined
              ? 'The embedded chapter will be removed when you confirm Move clips.'
              : 'This marker will be removed from the active plan and marker export.'}{' '}
            You can restore it or use Undo before filing. The original review record is retained.
          </p>
          <div className={styles.modalFooter}>
            <button className={styles.secondary} onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className={styles.dangerButton}
              disabled={disabled}
              onClick={() => {
                decide(deleting.id, deleting.label, 'deleted');
                setDeleting(null);
              }}
            >
              Delete marker
            </button>
          </div>
        </Modal>
      )}
      {adding && (
        <Modal title="Add marker" onClose={closeAdd}>
          <form className={styles.form} onSubmit={addMarker}>
            <label>
              Time
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="00:00.000"
                required
              />
            </label>
            <label>
              Marker name
              <input
                value={name}
                maxLength={4000}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className={styles.kitMarkerOption}>
              <input
                type="checkbox"
                checked={writeToFile}
                onChange={(e) => setWriteToFile(e.target.checked)}
              />{' '}
              Write an embedded chapter with Move clips
            </label>
            <p className={styles.muted}>
              New markers start Reviewed. Uncheck this to keep the marker in the app and exports
              only.
            </p>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.modalFooter}>
              <button type="button" className={styles.secondary} onClick={closeAdd}>
                Cancel
              </button>
              <button type="submit" className={styles.primary} disabled={disabled}>
                Add marker
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
});

export function MarkerSeekButton({
  marker,
  duration,
  onSeek,
}: {
  marker: PreviewMarker;
  duration: number;
  onSeek?: (seconds: number) => void;
}) {
  const canSeek = !!onSeek && duration > 0 && marker.seconds <= duration;
  return (
    <button
      type="button"
      className={`${styles.markerCard} ${styles.markerSeek} ${canSeek ? styles.markerClickable : ''}`}
      disabled={!canSeek}
      title="Seek to this marker"
      onClick={() => onSeek?.(marker.seconds)}
    >
      <time className={styles.markerTime}>Time: {markerTime(marker.seconds)}</time>
      <span>
        {marker.label}
        {duration > 0 && marker.seconds > duration ? ' (outside this clip)' : ''}
      </span>
    </button>
  );
}
