import type { ExplorerMethodFilter } from '../../contracts';
import { ExplorerStore } from '../ExplorerStore';
import { syncVisibleTreeState } from './helpers';

export const updateMethodFilter = (
  store: ExplorerStore,
  methodFilter: ExplorerMethodFilter,
): void => {
  store.updateState((state) =>
    syncVisibleTreeState({
      ...state,
      viewState: {
        ...state.viewState,
        methodFilter,
      },
    }),
  );
};
