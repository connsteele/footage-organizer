export type PreviewMarker = { seconds: number; label: string; id?: string; chapterIndex?: number };
export type MediaInfo = {
  markers: PreviewMarker[];
  video: {
    codec: string;
    width: number;
    height: number;
    framerate: number;
    bitrate: number;
    contentType?: string;
  } | null;
  audio: string[];
  note?: string;
};

export function previewMarkers(imported: PreviewMarker[], embedded: PreviewMarker[]) {
  const sorted = [...imported, ...embedded]
    .filter((m) => Number.isFinite(m.seconds) && m.seconds >= 0)
    .map((m) => ({ ...m, label: m.label.trim() || 'Unnamed marker' }))
    .sort((a, b) => a.seconds - b.seconds);
  const seen = new Map<string, number>();
  return sorted.filter((m) => {
    const previous = seen.get(m.label);
    if (previous !== undefined && Math.abs(previous - m.seconds) < 0.001) return false;
    seen.set(m.label, m.seconds);
    return true;
  });
}

export function markerTime(seconds: number) {
  const value = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(value / 3600000);
  const minutes = Math.floor(value / 60000) % 60;
  const secs = Math.floor(value / 1000) % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
