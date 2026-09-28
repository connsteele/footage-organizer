import type {
  BatchClip,
  MarkerChange,
  MarkerDecision,
  MarkerProposals,
  SourceMarker,
} from './model.js';

export function identifiedMarkers(markers: SourceMarker[]) {
  return markers.map((m, index) => ({ ...m, id: m.id ?? `marker-${index + 1}` }));
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
  for (const item of items) {
    const original = identified.find((m) => m.id === item.markerId);
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
  return identifiedMarkers(clip.original.markers).flatMap((m) => {
    const decision = clip.markerDecisions?.find((d) => d.markerId === m.id);
    return m.chapterIndex !== undefined &&
      decision?.status === 'accepted' &&
      decision.label !== m.label
      ? [
          {
            markerId: m.id,
            chapterIndex: m.chapterIndex,
            seconds: m.seconds,
            originalLabel: m.label,
            label: decision.label,
          },
        ]
      : [];
  });
}
export function effectiveMarkers(clip: Pick<BatchClip, 'original' | 'markerDecisions'>) {
  return identifiedMarkers(clip.original.markers).map((m) => {
    const decision = clip.markerDecisions?.find((d) => d.markerId === m.id);
    return { ...m, label: decision?.status === 'accepted' ? decision.label : m.label };
  });
}
export function markerExport(clip: BatchClip) {
  return {
    schemaVersion: 1,
    kind: 'reviewed-markers',
    clipId: clip.id,
    sourcePath: clip.currentPath,
    footageUpdated: clip.applied,
    markers: identifiedMarkers(clip.original.markers).map((m) => {
      const decision = clip.markerDecisions?.find((d) => d.markerId === m.id);
      return {
        ...m,
        originalLabel: m.label,
        label: decision?.status === 'accepted' ? decision.label : m.label,
        decision: decision?.status ?? 'unchanged',
        proposedLabel: decision?.label,
      };
    }),
  };
}
