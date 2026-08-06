import type { ApiExplorerMethod } from '../../config/apiExplorer';

export type HistoryEntryStatus = number | 'pending' | 'error';

export interface HistorySession {
  id: string;
  label: string;
  entryIds: string[];
}

export interface HistoryEntry {
  id: string;
  endpointId: string;
  endpointName: string;
  method: ApiExplorerMethod;
  url: string;
  status: HistoryEntryStatus;
  duration: number | null;
  requestBody: string;
  responsePreview: string;
  errorMessage: string;
  createdAt: string;
}
