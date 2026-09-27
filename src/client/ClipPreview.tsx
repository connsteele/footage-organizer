import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { clipLabel } from '../shared/model';
import { api, errorText } from './api';
import styles from './App.module.css';

export function ClipPreview({
  prefix,
  clipId,
  onExternal,
}: {
  prefix: string;
  clipId: number;
  onExternal: () => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ url: string }>(`${prefix}/preview`, { method: 'POST', body: { clipId } })
      .then(({ url }) => {
        if (!cancelled) setSource(url);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [prefix, clipId]);
  useEffect(() => {
    const player = video.current;
    return () => {
      if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
    };
  }, [source]);
  return (
    <section
      className={styles.clipPreview}
      aria-label={`Video preview for clip ${clipLabel(clipId)}`}
    >
      {!source && !error && (
        <p role="status">
          <LoaderCircle size={18} className={styles.spin} /> Loading preview…
        </p>
      )}
      {source && (
        <video
          ref={video}
          src={source}
          controls
          preload="metadata"
          playsInline
          aria-label={`Video for clip ${clipLabel(clipId)}`}
          onError={() =>
            setError(
              'This video is unavailable or its format is not supported by your browser. Try the external player, or close and reopen the preview.',
            )
          }
        />
      )}
      {error ? (
        <div className={styles.previewError} role="alert">
          <p>{error}</p>
          <button className={styles.secondary} onClick={onExternal}>
            <ExternalLink size={17} /> Open in external player
          </button>
        </div>
      ) : (
        <p className={styles.muted}>Use the timeline to scrub. Playback uses your original file.</p>
      )}
    </section>
  );
}
