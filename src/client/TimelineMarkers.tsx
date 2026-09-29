import { memo } from 'react';
import { markerTime, type PreviewMarker } from '../shared/media';
import styles from './App.module.css';

// Playback position changes several times per second; the marker ticks do not.
export const TimelineMarkers = memo(function TimelineMarkers({
  markers,
  duration,
  onSeek,
}: {
  markers: PreviewMarker[];
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  return markers
    .filter((marker) => marker.seconds <= duration)
    .map((marker, index) => (
      <button
        key={`${marker.seconds}-${index}`}
        type="button"
        className={styles.timelineMarker}
        style={{ left: `${(marker.seconds / duration) * 100}%` }}
        title={`${markerTime(marker.seconds)} — ${marker.label}`}
        aria-label={`Jump to ${markerTime(marker.seconds)}: ${marker.label}`}
        onClick={() => onSeek(marker.seconds)}
      />
    ));
});
