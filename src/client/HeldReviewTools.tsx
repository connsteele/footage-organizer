import { useRef, useState } from 'react';
import { ChevronDown, Download, MessageSquareText, Upload } from 'lucide-react';
import type { Batch, HeldReviewRequest, ProjectState, ReviewUpdatePreview } from '../shared/model';
import { clipLabel } from '../shared/model';
import { api, download, errorText } from './api';
import { buildHeldReviewKit } from './heldReviewKit';
import { Modal } from './Modal';
import styles from './App.module.css';

export function HeldReviewTools({
  projectId,
  batch,
  locked,
  flush,
  reload,
}: {
  projectId: string;
  batch: Batch;
  locked: boolean;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ReviewUpdatePreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const prefix = `/projects/${projectId}/batches/${batch.id}`;
  async function exportHeld() {
    setBusy(true);
    setError('');
    try {
      await flush();
      const result = await api<{ state: ProjectState; request: HeldReviewRequest }>(
        `${prefix}/held-review`,
        { method: 'POST' },
      );
      download(
        `${batch.id}-held-review.md`,
        buildHeldReviewKit(result.state, result.request, batch.id),
        'text/markdown',
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function previewUpdate(update: unknown) {
    await flush();
    const result = await api<ReviewUpdatePreview>(`${prefix}/update-preview`, {
      method: 'POST',
      body: update,
    });
    setPreview(result);
    setSelected(
      result.clips
        .filter((c) => !c.conflicts.length && !c.alreadyApplied)
        .map((c) => c.suggestion.id),
    );
  }
  async function importUpdate(selectedFile?: File) {
    if (!selectedFile) return;
    setBusy(true);
    setError('');
    try {
      if (selectedFile.size > 8 * 1024 * 1024)
        throw new Error('Choose a batch update JSON under 8 MB.');
      await previewUpdate(JSON.parse(await selectedFile.text()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await flush();
      await api(`${prefix}/apply-update`, {
        method: 'POST',
        body: { update: preview.update, revision: preview.revision, clipIds: selected },
      });
      setPreview(null);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <details className={styles.notesPanel}>
        <summary>
          <MessageSquareText size={18} /> Agent follow-up{' '}
          <span className={styles.summaryHint}>
            Export held notes and review returned suggestions
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className={styles.followupPanel}>
          <p>
            Send the exported kit and review material to your agent. Import its batch update here to
            compare suggestions. Accepted clips stay held until you release them.
          </p>
          <div className={styles.inlineActions}>
            <button
              className={styles.secondary}
              disabled={locked || busy || !batch.clips.some((c) => c.held && !c.applied)}
              onClick={() => void exportHeld()}
            >
              <Download size={17} /> Export held clips for review
            </button>
            <button
              className={styles.secondary}
              disabled={locked || busy}
              onClick={() => file.current?.click()}
            >
              <Upload size={17} /> Import batch update
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Batch update JSON"
              onChange={(e) => {
                void importUpdate(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {!!batch.reviewUpdates?.length && (
            <details>
              <summary>
                Accepted review updates · {batch.reviewUpdates.length}
                <ChevronDown size={16} />
              </summary>
              {batch.reviewUpdates.map((r, index) => (
                <div className={styles.updateHistory} key={`${r.update.updateId}-${index}`}>
                  <b>
                    {new Date(r.acceptedAt).toLocaleString()} · Clips{' '}
                    {r.clipIds.map(clipLabel).join(', ')}
                  </b>
                  <p>{r.update.reviewNotes}</p>
                  {r.before.map((c) => {
                    const suggestion = r.update.clips.find((s) => s.id === c.id)!;
                    return (
                      <p key={c.id}>
                        #{clipLabel(c.id)}:{' '}
                        {[c.proposed.folder, c.proposed.filename].filter(Boolean).join('/')} →{' '}
                        {[suggestion.proposed.folder, suggestion.proposed.filename]
                          .filter(Boolean)
                          .join('/')}
                        <br />
                        {suggestion.rationale}
                      </p>
                    );
                  })}
                </div>
              ))}
            </details>
          )}
        </div>
      </details>
      {error && !preview && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {preview && (
        <Modal
          title="Review batch update"
          wide
          dismissible={!busy}
          onClose={() => {
            setPreview(null);
            setError('');
          }}
        >
          <p>
            Choose which suggestions to apply to this batch. Your notes and original suggestions are
            preserved. Clips remain held; no files move.
          </p>
          {preview.update.reviewNotes && <p>{preview.update.reviewNotes}</p>}
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          <div className={styles.updateList}>
            {preview.clips.map((item) => (
              <section className={styles.updateItem} key={item.suggestion.id}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    aria-label={`Apply suggestion for clip ${clipLabel(item.suggestion.id)}`}
                    checked={selected.includes(item.suggestion.id)}
                    disabled={busy || item.alreadyApplied || !!item.conflicts.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, item.suggestion.id]
                          : selected.filter((id) => id !== item.suggestion.id),
                      )
                    }
                  />
                  Clip {clipLabel(item.suggestion.id)}
                  {item.alreadyApplied && ' · Already applied'}
                </label>
                <dl className={styles.updateComparison}>
                  <dt>Your placement</dt>
                  <dd>
                    {item.current
                      ? [item.current.proposed.folder, item.current.proposed.filename]
                          .filter(Boolean)
                          .join('/')
                      : 'Unavailable'}
                  </dd>
                  <dt>Agent suggests</dt>
                  <dd>
                    {[item.suggestion.proposed.folder, item.suggestion.proposed.filename]
                      .filter(Boolean)
                      .join('/')}
                  </dd>
                </dl>
                {item.current?.note && (
                  <p>
                    <b>Your note:</b> {item.current.note}
                  </p>
                )}
                <p>{item.suggestion.rationale}</p>
                {item.suggestion.markerProposals && (
                  <div>
                    <b>Marker suggestions — added for individual review</b>
                    {item.suggestion.markerProposals.items.map((m) => (
                      <p key={m.markerId}>
                        {m.seconds}s: {m.originalLabel || '(unnamed)'} → {m.proposedLabel}
                        <br />
                        {m.rationale}
                      </p>
                    ))}
                  </div>
                )}
                {!!item.suggestion.questions.length && (
                  <p>Still unresolved: {item.suggestion.questions.join(' · ')}</p>
                )}
                {!item.alreadyApplied &&
                  item.conflicts.map((conflict, i) => (
                    <p className={styles.conflict} key={i}>
                      {conflict}
                    </p>
                  ))}
              </section>
            ))}
          </div>
          <p>For conflicts, keep your current decisions and export a fresh held-clip review.</p>
          <div className={styles.modalFooter}>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await previewUpdate(preview.update);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh preview
            </button>
            <button
              className={styles.primary}
              disabled={busy || !selected.length}
              onClick={() => void apply()}
            >
              {busy
                ? 'Working…'
                : `Apply ${selected.length} ${selected.length === 1 ? 'suggestion' : 'suggestions'}`}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
