import type {
  ExplorerEndpointNodeMap,
  ExplorerGroupNodeMap,
  ExplorerMethodFilter,
} from '../contracts';

const matchesMethod = (method: string, methodFilter: ExplorerMethodFilter): boolean =>
  methodFilter === 'ALL' || method === methodFilter;

export const getVisibleExplorerNodeIds = (options: {
  endpointMap: ExplorerEndpointNodeMap;
  groupMap: ExplorerGroupNodeMap;
  groupOrder: string[];
  expandedGroupIds: string[];
  searchKeyword: string;
  methodFilter: ExplorerMethodFilter;
}): string[] => {
  const keyword = options.searchKeyword.trim().toLowerCase();
  const expandedGroupIdSet = new Set(options.expandedGroupIds);
  const visibleNodeIds: string[] = [];

  for (const groupId of options.groupOrder) {
    const group = options.groupMap[groupId];
    const visibleChildIds = group.childIds.filter((childId) => {
      const endpointNode = options.endpointMap[childId];

      if (!endpointNode) {
        return false;
      }

      if (!matchesMethod(endpointNode.method, options.methodFilter)) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return endpointNode.searchableText.includes(keyword);
    });

    if (!visibleChildIds.length) {
      continue;
    }

    visibleNodeIds.push(groupId);

    if (expandedGroupIdSet.has(groupId)) {
      visibleNodeIds.push(...visibleChildIds);
    }
  }

  return visibleNodeIds;
};
