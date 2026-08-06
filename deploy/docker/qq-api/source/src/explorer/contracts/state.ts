import type { ApiExplorerMetadata, ApiExplorerMethod } from '../../config/apiExplorer';
import type { HistoryEntry, HistorySession } from './history';
import type { ExplorerEndpointNodeMap, ExplorerGroupNodeMap } from './nodes';

export type ExplorerMethodFilter = 'ALL' | ApiExplorerMethod;

export interface ExplorerContextMenuState {
  isOpen: boolean;
  nodeId: string | null;
  x: number;
  y: number;
}

export interface ExplorerResourceState {
  metadata: ApiExplorerMetadata | null;
  groupOrder: string[];
  groupMap: ExplorerGroupNodeMap;
  endpointMap: ExplorerEndpointNodeMap;
  visibleNodeIds: string[];
}

export interface ExplorerViewState {
  activeEndpointId: string | null;
  selectedHistoryEntryId: string | null;
  searchKeyword: string;
  methodFilter: ExplorerMethodFilter;
  expandedGroupIds: string[];
  isHistoryPanelOpen: boolean;
  contextMenu: ExplorerContextMenuState;
}

export interface ExplorerLatestResponseState {
  statusText: string;
  bodyText: string;
  isError: boolean;
}

export interface ExplorerRequestState {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  bodyText: string;
  previewText: string;
  isSending: boolean;
  latestResponse: ExplorerLatestResponseState;
}

export interface ExplorerHistoryState {
  sessions: Record<string, HistorySession>;
  entries: Record<string, HistoryEntry>;
  activeSessionId: string | null;
  orderedEntryIds: string[];
}

export interface ExplorerState {
  resourceState: ExplorerResourceState;
  viewState: ExplorerViewState;
  requestState: ExplorerRequestState;
  historyState: ExplorerHistoryState;
}
