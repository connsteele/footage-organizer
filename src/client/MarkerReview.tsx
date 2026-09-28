import { RotateCcw } from 'lucide-react';
import type { BatchClip, MarkerDecision } from '../shared/model';
import { identifiedMarkers } from '../shared/markers';
import { markerTime } from '../shared/media';
import styles from './App.module.css';

export function MarkerReview({
  clip,
  locked,
  onChange,
}: {
  clip: BatchClip;
  locked: boolean;
  onChange: (update: (clip: BatchClip) => void) => void;
}) {
  const markers = identifiedMarkers(clip.original.markers);
  if (!markers.length) return null;
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
      <h3>Marker names</h3>
      <p>
        Review the marked events first, then use them to refine the clip name. Accepted embedded
        names are written when you confirm Move clips; other markers are saved for export.
      </p>
      {markers.map((m) => {
        const suggestion =
          clip.agentReview?.markerProposals?.items.find((p) => p.markerId === m.id) ??
          clip.original.markerProposals?.items.find((p) => p.markerId === m.id);
        const decision = clip.markerDecisions?.find((d) => d.markerId === m.id);
        const label = decision?.label ?? suggestion?.proposedLabel ?? m.label;
        return (
          <div className={styles.markerComparison} key={m.id}>
            <div className={styles.markerHeading}>
              <b>{markerTime(m.seconds)}</b>
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
              <span>Original:</span>
              <span className={styles.muted}>{m.label || '(unnamed)'}</span>
              <label htmlFor={`marker-${clip.id}-${m.id}`}>New:</label>
              <input
                id={`marker-${clip.id}-${m.id}`}
                aria-label={`New marker name ${m.id} for clip ${clip.id}`}
                value={label}
                maxLength={4000}
                disabled={locked || clip.applied}
                onChange={(e) => decide(m.id, e.target.value, 'pending')}
              />
            </div>
            {suggestion?.rationale && <p>{suggestion.rationale}</p>}
            <div className={styles.detailActions}>
              <button
                className={styles.secondary}
                disabled={
                  locked ||
                  clip.applied ||
                  !label.trim() ||
                  label === m.label ||
                  decision?.status === 'accepted'
                }
                onClick={() => decide(m.id, label.trim(), 'accepted')}
              >
                Accept name
              </button>
              <button
                className={styles.textButton}
                disabled={locked || clip.applied || decision?.status === 'rejected'}
                onClick={() => decide(m.id, label, 'rejected')}
              >
                Keep original
              </button>
              {suggestion && (
                <button
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
          </div>
        );
      })}
    </section>
  );
}
