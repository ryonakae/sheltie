export function resolveActiveSelection(
  selectedNodeIds: string[],
  selectedEdgeIds: ReadonlySet<string>,
): { activeNodeId: string | null; activeEdgeId: string | null } {
  if (selectedNodeIds.length + selectedEdgeIds.size !== 1) {
    return { activeNodeId: null, activeEdgeId: null };
  }
  if (selectedNodeIds.length === 1) {
    return { activeNodeId: selectedNodeIds[0], activeEdgeId: null };
  }
  return {
    activeNodeId: null,
    activeEdgeId: selectedEdgeIds.values().next().value ?? null,
  };
}

export function retainLiveSelectedIds(
  selectedIds: ReadonlySet<string>,
  liveIds: ReadonlySet<string>,
): Set<string> {
  return new Set(Array.from(selectedIds).filter((id) => liveIds.has(id)));
}
