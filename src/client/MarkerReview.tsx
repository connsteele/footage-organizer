import { useId, useState } from 'react';
import { Check, Info, RotateCcw, Undo2 } from 'lucide-react';
import type { BatchClip, MarkerDecision } from '../shared/model';
import { effectiveMarkers, identifiedMarkers } from '../shared/markers';
import { markerTime, type PreviewMarker } from '../shared/media';
import styles from './App.module.css';

export function MarkerReview({
  clip,
  locked,
  onChange,
  onSeek,
  duration = 0,
  previewMarkers = [],
  showHeading = true,
}: {
  clip: BatchClip;
  locked: boolean;
  onChange: (update: (clip: BatchClip) => void) => void;
  onSeek?: (seconds: number) => void;
  duration?: number;
  previewMarkers?: PreviewMarker[];
  showHeading?: boolean;
}) {
  const fieldId = useId();
  const [reasons, setReasons] = useState<Record<string, boolean>>({});
  const markers = identifiedMarkers(clip.original.markers);
  const effective = effectiveMarkers(clip);
  // Keep original IDs for editing. Add only playback markers not already represented
  // by an imported marker's effective name and time (including accepted renames).
  const extra = previewMarkers.filter(
    (m) =>
      !effective.some(
        (original) =>
          Math.abs(original.seconds - m.seconds) < 0.001 &&
          (original.label.trim() || 'Unnamed marker') === m.label,
      ),
  );
  const entries = [
    ...markers.map((marker) => ({ marker, reviewable: true as const })),
    ...extra.map((marker, i) => ({
      marker: { ...marker, id: `preview-${i}` },
      reviewable: false as const,
    })),
  ].sort((a, b) => a.marker.seconds - b.marker.seconds);
  if (!entries.length) return null;
  function decide(markerId: string, label: string, status: MarkerDecision['status']) {
    onChange((c) => {
      c.markerDecisions = [
        ...(c.markerDecisions ?? []).filter((d) => d.markerId !== markerId),
        { markerId, label, status },
      ];
    });
  }
  return (
    <section className={styles.markerReview} aria-label={`Marker names for clip ${clip.id}`}>
      {showHeading && <h3>Marker names</h3>}
      {!!markers.length && (
        <p className={styles.markerHint}>
          Accepted embedded names are written with Move clips. Other markers are saved for export.
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
        const suggestion =
          clip.agentReview?.markerProposals?.items.find((p) => p.markerId === m.id) ??
          clip.original.markerProposals?.items.find((p) => p.markerId === m.id);
        const decision = clip.markerDecisions?.find((d) => d.markerId === m.id);
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
                {m.chapterIndex === undefined ? 'Export only' : 'Embedded chapter'} ·{' '}
                {decision?.status === 'accepted'
                  ? clip.applied && m.chapterIndex !== undefined
                    ? 'Written to file'
                    : 'Accepted'
                  : decision?.status === 'rejected'
                    ? 'Keeping original'
                    : suggestion || decision
                      ? 'Needs review'
                      : 'Original'}
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
                title="Accept name"
                aria-label={`Accept name for marker ${m.id}`}
                aria-pressed={decision?.status === 'accepted'}
                disabled={
                  locked ||
                  clip.applied ||
                  !label.trim() ||
                  label.trim() === m.label ||
                  decision?.status === 'accepted'
                }
                onClick={() => decide(m.id, label.trim(), 'accepted')}
              >
                <Check size={18} />
              </button>
              <span className={styles.muted}>Original:</span>
              <span className={styles.markerOriginal}>{m.label || '(unnamed)'}</span>
              <button
                type="button"
                className={styles.markerAction}
                title="Keep original"
                aria-label={`Keep original for marker ${m.id}`}
                aria-pressed={decision?.status === 'rejected'}
                disabled={locked || clip.applied || decision?.status === 'rejected'}
                onClick={() => decide(m.id, label, 'rejected')}
              >
                <Undo2 size={18} />
              </button>
            </div>
            <div className={styles.markerContext}>
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
              {suggestion && (
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Reset marker suggestion"
                  aria-label={`Reset marker ${m.id}`}
                  disabled={locked || clip.applied}
                  onClick={() => decide(m.id, suggestion.proposedLabel, 'pending')}
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
    </section>
  );
}

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
