import type { ApiExplorerEndpoint, ApiExplorerMetadata } from '../../../config/apiExplorer';
import type { ExplorerState } from '../../contracts';
import {
  buildExplorerTree,
  createExplorerContextMenuState,
  createExplorerRequestState,
  getVisibleExplorerNodeIds,
} from '../../domain';

const getEndpointById = (
  metadata: ApiExplorerMetadata | null,
  endpointId: string | null,
): ApiExplorerEndpoint | null => {
  if (!metadata || !endpointId) {
    return null;
  }

  return metadata.endpoints.find((endpoint) => endpoint.id === endpointId) || null;
};

const getVisibleEndpointIds = (state: ExplorerState): string[] =>
  state.resourceState.visibleNodeIds.filter((nodeId) =>
    Boolean(state.resourceState.endpointMap[nodeId]),
  );

export const syncVisibleTreeState = (state: ExplorerState): ExplorerState => {
  const previousActiveEndpointId = state.viewState.activeEndpointId;
  const visibleNodeIds = getVisibleExplorerNodeIds({
    endpointMap: state.resourceState.endpointMap,
    groupMap: state.resourceState.groupMap,
    groupOrder: state.resourceState.groupOrder,
    expandedGroupIds: state.viewState.expandedGroupIds,
    searchKeyword: state.viewState.searchKeyword,
    methodFilter: state.viewState.methodFilter,
  });

  let nextActiveEndpointId = state.viewState.activeEndpointId;
  const visibleEndpointIds = visibleNodeIds.filter((nodeId) =>
    Boolean(state.resourceState.endpointMap[nodeId]),
  );

  if (!nextActiveEndpointId || !visibleEndpointIds.includes(nextActiveEndpointId)) {
    nextActiveEndpointId = visibleEndpointIds[0] || null;
  }

  const activeEndpoint = getEndpointById(state.resourceState.metadata, nextActiveEndpointId);
  const shouldResetRequestState = previousActiveEndpointId !== nextActiveEndpointId;

  return {
    ...state,
    resourceState: {
      ...state.resourceState,
      visibleNodeIds,
    },
    viewState: {
      ...state.viewState,
      activeEndpointId: nextActiveEndpointId,
    },
    requestState: shouldResetRequestState
      ? createExplorerRequestState(activeEndpoint)
      : state.requestState,
  };
};

export const createExplorerInitialState = (): ExplorerState => ({
  resourceState: {
    metadata: null,
    groupOrder: [],
    groupMap: {},
    endpointMap: {},
    visibleNodeIds: [],
  },
  viewState: {
    activeEndpointId: null,
    selectedHistoryEntryId: null,
    searchKeyword: '',
    methodFilter: 'ALL',
    expandedGroupIds: [],
    isHistoryPanelOpen: true,
    contextMenu: createExplorerContextMenuState(),
  },
  requestState: createExplorerRequestState(null),
  historyState: {
    sessions: {},
    entries: {},
    activeSessionId: null,
    orderedEntryIds: [],
  },
});

export const createInitializedExplorerState = (metadata: ApiExplorerMetadata): ExplorerState => {
  const tree = buildExplorerTree(metadata);
  const firstEndpointId =
    metadata.endpoints.find((endpoint) => Boolean(tree.endpointMap[endpoint.id]))?.id || null;
  const firstEndpoint = getEndpointById(metadata, firstEndpointId);

  return {
    resourceState: {
      metadata,
      groupOrder: tree.groupOrder,
      groupMap: tree.groupMap,
      endpointMap: tree.endpointMap,
      visibleNodeIds: tree.visibleNodeIds,
    },
    viewState: {
      activeEndpointId: firstEndpointId,
      selectedHistoryEntryId: null,
      searchKeyword: '',
      methodFilter: 'ALL',
      expandedGroupIds: tree.groupOrder,
      isHistoryPanelOpen: true,
      contextMenu: createExplorerContextMenuState(),
    },
    requestState: createExplorerRequestState(firstEndpoint),
    historyState: {
      sessions: {},
      entries: {},
      activeSessionId: null,
      orderedEntryIds: [],
    },
  };
};

export const getActiveEndpoint = (state: ExplorerState): ApiExplorerEndpoint | null =>
  getEndpointById(state.resourceState.metadata, state.viewState.activeEndpointId);

export const getEndpointByIdFromState = (
  state: ExplorerState,
  endpointId: string | null,
): ApiExplorerEndpoint | null => getEndpointById(state.resourceState.metadata, endpointId);

export const getVisibleEndpointCount = (state: ExplorerState): number =>
  getVisibleEndpointIds(state).length;
