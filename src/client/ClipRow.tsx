import { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { AlertCircle, ChevronDown, GripVertical, Pause, Play, RotateCcw } from 'lucide-react';
import {
  clipLabel,
  durationLabel,
  targetPath,
  type BatchClip,
  type ClipEdit,
} from '../shared/model';
import { markerChanges, needsMarkerReview, sourceMarkers } from '../shared/markers';
import { FilenameInput } from './FilenameInput';
import { ClipPreview } from './ClipPreview';
import { MarkerReview } from './MarkerReview';
import { centerExpandedClip } from './clipScroll';
import styles from './App.module.css';

export function ClipRow({
  clip,
  choices,
  locked,
  onChange,
  onPlay,
  prefix,
  previewOpen,
  onPreview,
}: {
  clip: BatchClip;
  choices: string[];
  locked: boolean;
  onChange: (update: (clip: ClipEdit) => void) => void;
  onPlay: () => void;
  prefix: string;
  previewOpen: boolean;
  onPreview: () => void;
}) {
  const [details, setDetails] = useState(false);
  const row = useRef<HTMLElement>(null);
  const focusPanel = useRef<'preview' | 'details' | null>(null);
  useEffect(() => {
    const requested = focusPanel.current;
    if (!requested || !(requested === 'preview' ? previewOpen : details)) return;
    focusPanel.current = null;
    const frame = requestAnimationFrame(() => {
      const panel = row.current?.querySelector<HTMLElement>(`[data-clip-panel="${requested}"]`);
      if (row.current && panel) centerExpandedClip(row.current, panel);
    });
    return () => cancelAnimationFrame(frame);
  }, [previewOpen, details]);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: clip.id,
    disabled: locked || clip.applied,
  });
  const currentName = clip.currentPath.split('/').at(-1) ?? clip.currentPath;
  const originalName = clip.original.source.relativePath.split('/').at(-1)!;
  const questions = clip.agentReview?.questions ?? clip.original.questions;
  const renamed = currentName !== clip.proposed.filename;
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
          ? markerChanges(clip).length
            ? 'Update markers'
            : 'Unchanged'
          : 'Move';
  return (
    <article
      ref={(node) => {
        row.current = node;
        setNodeRef(node);
      }}
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
          <span className={styles.filenameLabel}>New:</span>
          <div className={styles.proposedFilename}>
            <FilenameInput
              label={`Filename for clip ${clipLabel(clip.id)}`}
              value={clip.proposed.filename}
              disabled={locked || clip.applied}
              onChange={(filename) =>
                onChange((c) => {
                  c.proposed.filename = filename;
                })
              }
            />
            <button
              type="button"
              className={styles.restoreFilename}
              aria-label={`Use original filename for clip ${clipLabel(clip.id)}`}
              title={
                clip.proposed.filename !== originalName
                  ? 'Use the original filename'
                  : 'Already using the original filename'
              }
              disabled={locked || clip.applied || clip.proposed.filename === originalName}
              onClick={() =>
                onChange((c) => {
                  c.proposed.filename = originalName;
                })
              }
            >
              <RotateCcw size={16} />
            </button>
          </div>
          <span className={styles.originalFilenameLabel}>Original:</span>
          <span className={styles.originalFilename} title={clip.original.source.relativePath}>
            {originalName}
          </span>
        </div>
        <span className={styles.duration}>{durationLabel(clip.original.duration)}</span>
        <span
          className={`${styles.statusPill} ${clip.held ? styles.heldPill : clip.applied ? styles.filedPill : ''}`}
        >
          {status}
        </span>
        {!!sourceMarkers(clip).length && (
          <span className={styles.statusPill}>
            {needsMarkerReview(clip)
              ? `${needsMarkerReview(clip)} markers to review`
              : 'Markers reviewed'}
          </span>
        )}
        <button
          aria-label={`Open clip ${clipLabel(clip.id)} in player`}
          className={styles.iconButton}
          disabled={locked}
          title="Open in external player"
          onClick={onPlay}
        >
          <Play size={16} />
        </button>
        <button
          className={styles.detailsButton}
          disabled={locked}
          aria-expanded={previewOpen}
          aria-label={`Preview clip ${clipLabel(clip.id)}`}
          onClick={() => {
            focusPanel.current = previewOpen ? null : 'preview';
            onPreview();
          }}
        >
          Preview <ChevronDown size={13} />
        </button>
        <button
          className={styles.detailsButton}
          aria-expanded={details}
          aria-label={`Details for clip ${clipLabel(clip.id)}`}
          onClick={() => {
            focusPanel.current = details ? null : 'details';
            setDetails(!details);
          }}
        >
          Details
          <ChevronDown size={13} />
        </button>
      </div>
      {previewOpen && (
        <div data-clip-panel="preview">
          <ClipPreview
            key={`${prefix}-${clip.id}`}
            prefix={prefix}
            clipId={clip.id}
            markers={clip.original.markers}
            markerDecisions={clip.markerDecisions}
            review={{ clip, locked, onChange }}
            onExternal={onPlay}
          />
        </div>
      )}
      {clip.importIssue && (
        <p className={styles.rowWarning}>
          <AlertCircle size={14} />
          {clip.importIssue}
        </p>
      )}
      {questions.length > 0 && (
        <p className={styles.rowQuestion}>
          <AlertCircle size={14} />
          {questions.join(' · ')}
        </p>
      )}
      {details && (
        <div className={styles.clipDetails} data-clip-panel="details">
          {!previewOpen && <MarkerReview clip={clip} locked={locked} onChange={onChange} />}
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
              <b>Original review rationale</b>
              <br />
              {clip.original.rationale || 'No additional rationale.'}
            </p>
            {clip.agentReview && (
              <p>
                <b>Latest agent follow-up</b>
                <br />
                {clip.agentReview.rationale || 'No additional rationale.'}
              </p>
            )}
          </div>
          <div>
            <label>
              Your note
              <textarea
                aria-label="Your note"
                rows={3}
                maxLength={16000}
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
                <Pause size={14} /> Hold for review
              </label>
              <button
                className={styles.textButton}
                disabled={locked || clip.applied}
                onClick={() =>
                  onChange((c) => {
                    c.proposed = { ...clip.original.proposed };
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
