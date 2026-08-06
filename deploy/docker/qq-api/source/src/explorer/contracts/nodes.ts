import type {
  ApiExplorerEndpoint,
  ApiExplorerMetadata,
  ApiExplorerMethod,
} from '../../config/apiExplorer';

export type ExplorerTreeNodeType = 'group' | 'endpoint';

export interface ExplorerTreeNodeBase {
  id: string;
  type: ExplorerTreeNodeType;
  label: string;
}

export interface ExplorerGroupNode extends ExplorerTreeNodeBase {
  type: 'group';
  childIds: string[];
  isExpanded: boolean;
  itemCount: number;
}

export interface ExplorerEndpointNode extends ExplorerTreeNodeBase {
  type: 'endpoint';
  endpointId: string;
  category: string;
  method: ApiExplorerMethod;
  path: string;
  searchableText: string;
}

export type ExplorerTreeNode = ExplorerGroupNode | ExplorerEndpointNode;

export type ExplorerGroupNodeMap = Record<string, ExplorerGroupNode>;
export type ExplorerEndpointNodeMap = Record<string, ExplorerEndpointNode>;

export interface ExplorerTreeBuildResult {
  groupOrder: string[];
  groupMap: ExplorerGroupNodeMap;
  endpointMap: ExplorerEndpointNodeMap;
  visibleNodeIds: string[];
}

export interface ExplorerMetadataSource {
  metadata: ApiExplorerMetadata;
  endpoints: ApiExplorerEndpoint[];
}
