import type {
  BatchClip,
  MarkerChange,
  MarkerDecision,
  MarkerProposals,
  SourceMarker,
  LocalMarker,
} from './model.js';

export function identifiedMarkers(markers: SourceMarker[]) {
  return markers.map((m, index) => ({ ...m, id: m.id ?? `marker-${index + 1}` }));
}
type MarkerClip = Pick<BatchClip, 'original' | 'markerDecisions' | 'localMarkers'>;
export type EditableMarker = SourceMarker & {
  id: string;
  origin?: LocalMarker['origin'];
  writeToFile?: boolean;
};
export function sourceMarkers(
  clip: Pick<BatchClip, 'original' | 'localMarkers'>,
): EditableMarker[] {
  return [...identifiedMarkers(clip.original.markers), ...(clip.localMarkers ?? [])];
}
export function needsMarkerReview(clip: MarkerClip) {
  const decisions = markerDecisionsById(clip);
  return sourceMarkers(clip).filter(
    (m) => !decisions.has(m.id) || decisions.get(m.id)?.status === 'pending',
  ).length;
}
export function writesMarker(marker: EditableMarker) {
  return marker.chapterIndex !== undefined || (marker.origin === 'added' && marker.writeToFile);
}
export function validateMarkerProposals(markers: SourceMarker[], proposals?: MarkerProposals) {
  const identified = identifiedMarkers(markers);
  if (new Set(identified.map((m) => m.id)).size !== identified.length)
    throw new Error('Marker IDs must be unique within a clip.');
  const chapters = identified.filter((m) => m.chapterIndex !== undefined);
  if (new Set(chapters.map((m) => m.chapterIndex)).size !== chapters.length)
    throw new Error('An embedded chapter may appear only once within a clip.');
  const items = proposals?.items ?? [];
  if (new Set(items.map((m) => m.markerId)).size !== items.length)
    throw new Error('A marker may have only one proposal.');
  const originalsById = new Map(identified.map((m) => [m.id, m]));
  for (const item of items) {
    const original = originalsById.get(item.markerId);
    if (!original || original.label !== item.originalLabel || original.seconds !== item.seconds)
      throw new Error(`Marker ${item.markerId} does not match its original ID, label and time.`);
  }
}
export function initialMarkerDecisions(proposals?: MarkerProposals): MarkerDecision[] {
  return (proposals?.items ?? []).map((m) => ({
    markerId: m.markerId,
    label: m.proposedLabel,
    status: 'pending',
  }));
}
export function validateMarkerDecisions(markers: SourceMarker[], decisions: MarkerDecision[]) {
  const ids = new Set(identifiedMarkers(markers).map((m) => m.id));
  if (
    new Set(decisions.map((d) => d.markerId)).size !== decisions.length ||
    decisions.some((d) => !ids.has(d.markerId))
  )
    throw new Error('Marker decisions must reference unique original marker IDs.');
  if (decisions.some((d) => d.status === 'accepted' && !d.label.trim()))
    throw new Error('Accepted marker names cannot be empty.');
}
export function markerChanges(clip: BatchClip): MarkerChange[] {
  const decisions = markerDecisionsById(clip);
  return sourceMarkers(clip).flatMap((m): MarkerChange[] => {
    const decision = decisions.get(m.id);
    if (!writesMarker(m)) return [];
    const base = {
      markerId: m.id,
      seconds: m.seconds,
      originalLabel: m.label,
      label: decision?.label ?? m.label,
    };
    if (m.origin === 'added')
      return decision?.status === 'accepted' ? [{ ...base, action: 'add' }] : [];
    if (decision?.status === 'deleted')
      return [{ ...base, chapterIndex: m.chapterIndex, action: 'delete' }];
    return decision?.status === 'accepted' && decision.label !== m.label
      ? [{ ...base, chapterIndex: m.chapterIndex }]
      : [];
  });
}
export function effectiveMarkers(clip: MarkerClip) {
  const decisions = markerDecisionsById(clip);
  return sourceMarkers(clip)
    .filter((m) => decisions.get(m.id)?.status !== 'deleted')
    .map((m) => {
      const decision = decisions.get(m.id);
      return { ...m, label: decision?.status === 'accepted' ? decision.label : m.label };
    });
}
export function markerExport(clip: BatchClip) {
  const decisions = markerDecisionsById(clip);
  return {
    schemaVersion: 2,
    kind: 'reviewed-markers',
    clipId: clip.id,
    sourcePath: clip.currentPath,
    footageUpdated: clip.applied,
    markers: sourceMarkers(clip)
      .filter((m) => decisions.get(m.id)?.status !== 'deleted')
      .map((m) => {
        const decision = decisions.get(m.id);
        return {
          ...m,
          originalLabel: m.label,
          label: decision?.status === 'accepted' ? decision.label : m.label,
          decision: decision?.status ?? 'pending',
          proposedLabel: decision?.label,
        };
      }),
    deletedMarkers: sourceMarkers(clip).filter((m) => decisions.get(m.id)?.status === 'deleted'),
  };
}

export function validateLocalMarkers(clip: MarkerClip) {
  const markers = sourceMarkers(clip);
  if (markers.length > 10000) throw new Error('A clip can contain at most 10,000 markers.');
  validateMarkerProposals(markers);
  validateMarkerDecisions(markers, clip.markerDecisions ?? []);
  const decisions = markerDecisionsById(clip);
  const active = markers.filter((m) => decisions.get(m.id)?.status !== 'deleted');
  for (const m of clip.localMarkers ?? []) {
    if (m.origin !== 'added') continue;
    if (!m.label.trim()) throw new Error('New marker names cannot be empty.');
    const duration = clip.original.duration;
    if (duration !== null && m.seconds >= duration)
      throw new Error('New markers must be before the end of the clip.');
    if (
      decisions.get(m.id)?.status !== 'deleted' &&
      active.some((other) => other.id !== m.id && Math.abs(other.seconds - m.seconds) < 0.001)
    )
      throw new Error('A marker already exists at this time. Choose a different time.');
  }
}

export function markerDecisionsById(clip: Pick<BatchClip, 'markerDecisions'>) {
  return new Map((clip.markerDecisions ?? []).map((decision) => [decision.markerId, decision]));
}

export function markerSuggestionsById(clip: Pick<BatchClip, 'original' | 'agentReview'>) {
  // A follow-up can replace individual suggestions while preserving the rest.
  return new Map(
    [
      ...(clip.original.markerProposals?.items ?? []),
      ...(clip.agentReview?.markerProposals?.items ?? []),
    ].map((suggestion) => [suggestion.markerId, suggestion]),
  );
}
