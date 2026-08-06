import { ApiExplorerEndpoint } from '../config/apiExplorer';

export interface BuildApiExplorerRequestOptions {
  baseUrl: string;
  pathValues?: Record<string, string>;
  queryValues?: Record<string, string>;
  bodyText?: string;
}

export interface BuiltApiExplorerRequest {
  method: ApiExplorerEndpoint['method'];
  url: string;
  body?: Record<string, unknown>;
}

export type ApiExplorerMethodFilter = 'ALL' | ApiExplorerEndpoint['method'];

export interface ApiExplorerRequestLogSnapshot {
  url: string;
  bodyText?: string;
}

export interface ApiExplorerRequestLogEntry {
  id: string;
  timestamp: string;
  endpointId: string;
  endpointName: string;
  method: ApiExplorerEndpoint['method'];
  url: string;
  requestBody: string;
  status: 'pending' | 'error' | number;
  duration: number | null;
  responsePreview: string;
  errorMessage: string;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const replacePathParams = (pathTemplate: string, pathValues: Record<string, string> = {}): string =>
  pathTemplate.replace(/:([A-Za-z0-9_]+)\??/g, (_match, key: string) => {
    const rawValue = pathValues[key];
    return rawValue ? encodeURIComponent(rawValue) : '';
  });

const normalizePath = (value: string): string => value.replace(/\/{2,}/g, '/');

const normalizeSearchKeyword = (value: string): string => value.trim().toLowerCase();

export const toQueryString = (queryValues: Record<string, string> = {}): string => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(queryValues)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, value);
    }
  }

  return searchParams.toString();
};

export const parseExplorerBody = (bodyText?: string): Record<string, unknown> | undefined => {
  if (!bodyText?.trim()) {
    return undefined;
  }

  const parsedBody = JSON.parse(bodyText) as unknown;

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  return parsedBody as Record<string, unknown>;
};

export const buildApiExplorerRequest = (
  endpoint: ApiExplorerEndpoint,
  options: BuildApiExplorerRequestOptions,
): BuiltApiExplorerRequest => {
  const resolvedPath = normalizePath(replacePathParams(endpoint.path, options.pathValues));
  const queryString = toQueryString(options.queryValues);
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const url = `${baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ''}`;
  const body = endpoint.method === 'POST' ? parseExplorerBody(options.bodyText) : undefined;

  return {
    method: endpoint.method,
    url,
    body,
  };
};

export const filterApiExplorerEndpoints = (
  endpoints: ApiExplorerEndpoint[],
  searchKeyword = '',
  methodFilter: ApiExplorerMethodFilter = 'ALL',
): ApiExplorerEndpoint[] => {
  const keyword = normalizeSearchKeyword(searchKeyword);

  return endpoints.filter((endpoint) => {
    const matchesMethod = methodFilter === 'ALL' || endpoint.method === methodFilter;

    if (!matchesMethod) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return [endpoint.name, endpoint.category, endpoint.path].some((fieldValue) =>
      fieldValue.toLowerCase().includes(keyword),
    );
  });
};

export const createApiExplorerRequestLogEntry = (
  endpoint: ApiExplorerEndpoint,
  request: ApiExplorerRequestLogSnapshot,
  options: {
    id: string;
    timestamp: string;
  },
): ApiExplorerRequestLogEntry => ({
  id: options.id,
  timestamp: options.timestamp,
  endpointId: endpoint.id,
  endpointName: endpoint.name,
  method: endpoint.method,
  url: request.url,
  requestBody: request.bodyText || '',
  status: 'pending',
  duration: null,
  responsePreview: '请求进行中...',
  errorMessage: '',
});

export const updateApiExplorerRequestLogEntry = (
  logs: ApiExplorerRequestLogEntry[],
  logId: string,
  patch: Partial<ApiExplorerRequestLogEntry>,
): ApiExplorerRequestLogEntry[] =>
  logs.map((log) => (log.id === logId ? { ...log, ...patch } : log));
