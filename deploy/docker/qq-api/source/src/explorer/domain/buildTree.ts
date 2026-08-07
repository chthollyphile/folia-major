import type { ApiExplorerEndpoint, ApiExplorerMetadata } from '../../config/apiExplorer';
import type {
  ExplorerEndpointNode,
  ExplorerGroupNode,
  ExplorerTreeBuildResult,
} from '../contracts';

const GROUP_ID_PREFIX = 'group:';

const normalizeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const createExplorerGroupId = (category: string): string =>
  `${GROUP_ID_PREFIX}${normalizeSegment(category) || 'uncategorized'}`;

export const createExplorerSearchableText = (endpoint: ApiExplorerEndpoint): string =>
  [endpoint.name, endpoint.category, endpoint.path, endpoint.method, endpoint.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export const createExplorerEndpointNode = (
  endpoint: ApiExplorerEndpoint,
): ExplorerEndpointNode => ({
  id: endpoint.id,
  type: 'endpoint',
  label: endpoint.name,
  endpointId: endpoint.id,
  category: endpoint.category,
  method: endpoint.method,
  path: endpoint.path,
  searchableText: createExplorerSearchableText(endpoint),
});

const createExplorerGroupNode = (category: string, childIds: string[]): ExplorerGroupNode => ({
  id: createExplorerGroupId(category),
  type: 'group',
  label: category,
  childIds,
  isExpanded: true,
  itemCount: childIds.length,
});

export const buildExplorerTree = (metadata: ApiExplorerMetadata): ExplorerTreeBuildResult => {
  const groupOrder: string[] = [];
  const groupLabels = new Map<string, string>();
  const groupChildren = new Map<string, string[]>();
  const endpointMap: ExplorerTreeBuildResult['endpointMap'] = {};

  for (const endpoint of metadata.endpoints) {
    const groupId = createExplorerGroupId(endpoint.category);
    const childIds = groupChildren.get(groupId);

    if (!childIds) {
      groupOrder.push(groupId);
      groupLabels.set(groupId, endpoint.category);
      groupChildren.set(groupId, []);
    }

    groupChildren.get(groupId)?.push(endpoint.id);
    endpointMap[endpoint.id] = createExplorerEndpointNode(endpoint);
  }

  const groupMap = groupOrder.reduce<ExplorerTreeBuildResult['groupMap']>(
    (accumulator, groupId) => {
      const category = groupLabels.get(groupId) || 'Uncategorized';
      const childIds = groupChildren.get(groupId) || [];

      accumulator[groupId] = createExplorerGroupNode(category, childIds);
      return accumulator;
    },
    {},
  );

  const visibleNodeIds = groupOrder.flatMap((groupId) => [groupId, ...groupMap[groupId].childIds]);

  return {
    groupOrder,
    groupMap,
    endpointMap,
    visibleNodeIds,
  };
};

export const buildExplorerTreeFromEndpoints = (
  endpoints: ApiExplorerEndpoint[],
  metadata: Omit<ApiExplorerMetadata, 'endpoints'> = {
    title: '',
    description: '',
  },
): ExplorerTreeBuildResult =>
  buildExplorerTree({
    ...metadata,
    endpoints,
  });
