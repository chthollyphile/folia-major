import type { ApiExplorerMetadata } from '../../../config/apiExplorer';
import { ExplorerStore } from '../ExplorerStore';
import { createInitializedExplorerState } from './helpers';

export const initializeExplorer = (store: ExplorerStore, metadata: ApiExplorerMetadata): void => {
  store.setState(createInitializedExplorerState(metadata));
};
