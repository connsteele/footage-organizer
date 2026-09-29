import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { clipLabel, type BatchClip, type ClipEdit, type MarkerDecision } from '../shared/model';
import {
  effectiveMarkers,
  identifiedMarkers,
  markerDecisionsById,
  sourceMarkers,
} from '../shared/markers';
import { markerTime, previewMarkers, type MediaInfo, type PreviewMarker } from '../shared/media';
import { api, errorText } from './api';
import { MarkerReview, MarkerSeekButton } from './MarkerReview';
import { TimelineMarkers } from './TimelineMarkers';
import { useShuttlePlayback } from './useShuttlePlayback';
import styles from './App.module.css';

export function ClipPreview({
  prefix,
  clipId,
  markers,
  markerDecisions,
  review,
  onExternal,
}: {
  prefix: string;
  clipId: number;
  markers: PreviewMarker[];
  markerDecisions?: MarkerDecision[];
  review?: {
    clip: BatchClip;
    locked: boolean;
    onChange: (update: (clip: ClipEdit) => void) => void;
  };
  onExternal: () => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [capability, setCapability] = useState(
    'The browser has not reported decoding efficiency for this clip.',
  );
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [markersOpen, setMarkersOpen] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ url: string }>(`${prefix}/preview`, { method: 'POST', body: { clipId } })
      .then(({ url }) => {
        if (cancelled) return;
        setSource(url);
        // Metadata is optional and must not delay or prevent playback.
        void api<MediaInfo>(`${url.replace(/^\/api/, '')}/info`)
          .then((value) => {
            if (!cancelled) setInfo(value);
          })
          .catch(() => {
            if (!cancelled)
              setInfo({
                video: null,
                audio: [],
                markers: [],
                note: 'Embedded markers could not be loaded. Imported markers are still available.',
              });
          });
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
  useEffect(() => {
    let cancelled = false;
    const v = info?.video;
    if (
      v?.contentType &&
      v.width &&
      v.height &&
      v.bitrate &&
      v.framerate &&
      navigator.mediaCapabilities?.decodingInfo
    ) {
      void navigator.mediaCapabilities
        .decodingInfo({
          type: 'file',
          video: {
            contentType: v.contentType,
            width: v.width,
            height: v.height,
            bitrate: v.bitrate,
            framerate: v.framerate,
          },
        })
        .then((result) => {
          if (!cancelled)
            setCapability(
              !result.supported
                ? 'The browser does not report support for this video format. Use the external player if playback fails.'
                : result.powerEfficient
                  ? `The browser expects power-efficient video decoding.${result.smooth ? '' : ' Smooth playback is not guaranteed.'}`
                  : 'The browser does not expect power-efficient video decoding. The external player may perform better.',
            );
        })
        .catch(() => {
          /* Keep the honest unknown state if the API rejects this format. */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [info]);
  const reviewClip = review?.clip;
  const allMarkers = useMemo(() => {
    const originals = reviewClip ? sourceMarkers(reviewClip) : identifiedMarkers(markers);
    const decisions = markerDecisionsById({ markerDecisions });
    const reviewed = reviewClip
      ? effectiveMarkers(reviewClip)
      : originals
          .filter((m) => decisions.get(m.id)?.status !== 'deleted')
          .map((m) => {
            const decision = decisions.get(m.id);
            return { ...m, label: decision?.status === 'accepted' ? decision.label : m.label };
          });
    const chapters = new Map(
      originals.filter((m) => m.chapterIndex !== undefined).map((m) => [m.chapterIndex, m]),
    );
    const embedded = (info?.markers ?? []).flatMap((m) => {
      if (reviewClip?.applied) return [m];
      const original = m.chapterIndex === undefined ? undefined : chapters.get(m.chapterIndex);
      if (!original || Math.abs(original.seconds - m.seconds) >= 0.001) return [m];
      const decision = decisions.get(original.id);
      return decision?.status === 'deleted'
        ? []
        : [
            {
              ...original,
              label: decision?.status === 'accepted' ? decision.label : original.label,
            },
          ];
    });
    return previewMarkers(reviewed, embedded);
  }, [markers, markerDecisions, info, reviewClip]);
  const getPosition = useCallback(() => video.current?.currentTime ?? 0, []);
  const ready = duration > 0 && !error;
  const shuttle = useShuttlePlayback(video, source, ready);
  const seek = useCallback(
    (seconds: number) => {
      if (!video.current || !ready) return;
      const next = Math.max(0, Math.min(duration, seconds));
      video.current.currentTime = next;
      setPosition(next);
    },
    [duration, ready],
  );
  function loaded() {
    const value = video.current?.duration || 0;
    setDuration(Number.isFinite(value) && value > 0 ? value : 0);
  }
  return (
    <section
      className={styles.clipPreview}
      aria-label={`Video preview for clip ${clipLabel(clipId)}`}
    >
      <div className={styles.previewLayout}>
        <div className={styles.previewMedia}>
          <div className={styles.previewStage}>
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
                onLoadedMetadata={loaded}
                onDurationChange={loaded}
                onTimeUpdate={() => setPosition(video.current?.currentTime || 0)}
                onError={() =>
                  setError(
                    'This video is unavailable or its format is not supported by your browser. Try the external player, or close and reopen the preview.',
                  )
                }
              />
            )}
          </div>
          <div className={styles.shuttleStatus}>
            <span role="status" aria-label="Playback speed">
              {!shuttle.speed
                ? 'Paused'
                : `${shuttle.speed < 0 ? 'Rewind' : 'Forward'} ${Math.abs(shuttle.speed)}×`}
            </span>
            <span>
              <kbd>J</kbd> Rewind · <kbd>K</kbd> Pause · <kbd>L</kbd> Play / faster
            </span>
          </div>
          {shuttle.error && (
            <p role="alert" className={styles.muted}>
              {shuttle.error}
            </p>
          )}
          <div className={styles.markerTimeline}>
            {markerDecisions?.some((d) => d.status === 'accepted') && (
              <p className={styles.muted}>Timeline shows accepted names from this plan.</p>
            )}
            <div className={styles.timelineHeading}>
              <span>
                {allMarkers.length} {allMarkers.length === 1 ? 'marker' : 'markers'}
              </span>
              <span>
                Time: {markerTime(position)} / {markerTime(duration)}
              </span>
            </div>
            <div className={styles.timelineTrack}>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.001}
                value={Math.min(position, duration)}
                disabled={!ready}
                aria-label={`Seek clip ${clipLabel(clipId)}`}
                aria-valuetext={markerTime(position)}
                onChange={(event) => seek(Number(event.target.value))}
              />
              {ready && <TimelineMarkers markers={allMarkers} duration={duration} onSeek={seek} />}
            </div>
          </div>
          {error && (
            <div className={styles.previewError} role="alert">
              <p>{error}</p>
              <button className={styles.secondary} onClick={onExternal}>
                <ExternalLink size={17} /> Open in external player
              </button>
            </div>
          )}
        </div>
        <aside
          className={styles.previewAside}
          aria-label={`Markers and playback info for clip ${clipLabel(clipId)}`}
        >
          <details
            className={styles.previewMarkers}
            open={markersOpen}
            onToggle={(event) => setMarkersOpen(event.currentTarget.open)}
          >
            <summary>
              Markers <span className={styles.muted}>({allMarkers.length})</span>
            </summary>
            <div
              className={styles.previewMarkersScroll}
              role="region"
              aria-label={`Markers for clip ${clipLabel(clipId)}`}
              tabIndex={0}
            >
              {review ? (
                <MarkerReview
                  {...review}
                  onSeek={seek}
                  duration={ready ? duration : 0}
                  previewMarkers={allMarkers}
                  showHeading={false}
                  getPosition={getPosition}
                />
              ) : (
                allMarkers.map((marker, index) => (
                  <MarkerSeekButton
                    key={index}
                    marker={marker}
                    duration={ready ? duration : 0}
                    onSeek={seek}
                  />
                ))
              )}
              {!allMarkers.length && info && !info.note && (
                <p>No imported or embedded markers found.</p>
              )}
              {info?.note && <p>{info.note}</p>}
              {!info && !error && <p>Checking for embedded markers…</p>}
            </div>
          </details>
          <details className={styles.playbackInfo}>
            <summary>Playback info</summary>
            {info?.video && (
              <p>
                {info.video.codec.toUpperCase()} · {info.video.width} × {info.video.height} ·{' '}
                {Number(info.video.framerate.toFixed(2))} fps
                {info.audio.length ? ` · ${info.audio.join(', ').toUpperCase()} audio` : ''}
              </p>
            )}
            <p>
              {capability} This is a browser estimate, not confirmation that the GPU is currently
              decoding.
            </p>
            <p>
              Original-file playback uses the browser's native decoder. Hardware acceleration is
              managed by your browser and graphics driver and must be enabled there.
            </p>
            <p>
              In Firefox: Settings → General → Performance → Use hardware acceleration when
              available. Uncheck Use recommended performance settings to reveal this option. Restart
              Firefox after changing it.{' '}
              <a
                href="https://support.mozilla.org/en-US/kb/performance-settings"
                target="_blank"
                rel="noreferrer"
              >
                Firefox playback settings
              </a>
            </p>
            {info?.note && <p>{info.note}</p>}
          </details>
        </aside>
      </div>
    </section>
  );
}
