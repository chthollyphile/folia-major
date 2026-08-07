import { ExplorerStore } from '../ExplorerStore';
import { syncVisibleTreeState } from './helpers';

export const updateSearchKeyword = (store: ExplorerStore, searchKeyword: string): void => {
  store.updateState((state) =>
    syncVisibleTreeState({
      ...state,
      viewState: {
        ...state.viewState,
        searchKeyword,
      },
    }),
  );
};
