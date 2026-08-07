import type { ApiExplorerEndpoint, ApiExplorerField } from '../../config/apiExplorer';
import type {
  ExplorerContextMenuState,
  ExplorerLatestResponseState,
  ExplorerRequestState,
} from '../contracts';

const DEFAULT_RESPONSE_MESSAGE = '发送请求后在这里查看最新结果';

const toFieldValueMap = (fields: ApiExplorerField[] | undefined): Record<string, string> =>
  (fields || []).reduce<Record<string, string>>((accumulator, field) => {
    if (field.defaultValue !== undefined) {
      accumulator[field.key] = String(field.defaultValue);
    }

    return accumulator;
  }, {});

export const createExplorerContextMenuState = (): ExplorerContextMenuState => ({
  isOpen: false,
  nodeId: null,
  x: 0,
  y: 0,
});

export const createExplorerLatestResponseState = (): ExplorerLatestResponseState => ({
  statusText: DEFAULT_RESPONSE_MESSAGE,
  bodyText: '等待请求...',
  isError: false,
});

export const createExplorerRequestState = (
  endpoint: ApiExplorerEndpoint | null,
): ExplorerRequestState => ({
  pathParams: toFieldValueMap(endpoint?.pathParams),
  queryParams: toFieldValueMap(endpoint?.queryParams),
  bodyText: endpoint?.bodyExample ? JSON.stringify(endpoint.bodyExample, null, 2) : '',
  previewText: '',
  isSending: false,
  latestResponse: createExplorerLatestResponseState(),
});
