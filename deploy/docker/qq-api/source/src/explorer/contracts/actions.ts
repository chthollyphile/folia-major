export type ExplorerGroupActionId = 'toggle-group' | 'collapse-other-groups' | 'copy-group-name';

export type ExplorerEndpointActionId =
  | 'copy-endpoint-path'
  | 'copy-request-template'
  | 'set-default-endpoint'
  | 'run-in-new-session';

export type ExplorerHistoryActionId =
  | 'copy-history-url'
  | 'copy-history-response'
  | 'load-history-into-request';

export type ExplorerTreeActionId = ExplorerGroupActionId | ExplorerEndpointActionId;

export interface ExplorerTreeAction {
  id: ExplorerTreeActionId;
  label: string;
}

export interface ExplorerHistoryAction {
  id: ExplorerHistoryActionId;
  label: string;
}
