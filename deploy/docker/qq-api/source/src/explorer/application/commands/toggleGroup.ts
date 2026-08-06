import { ExplorerStore } from '../ExplorerStore';
import { syncVisibleTreeState } from './helpers';

export const toggleGroup = (store: ExplorerStore, groupId: string): void => {
  store.updateState((state) => {
    if (!state.resourceState.groupMap[groupId]) {
      return state;
    }

    const expandedGroupIdSet = new Set(state.viewState.expandedGroupIds);

    if (expandedGroupIdSet.has(groupId)) {
      expandedGroupIdSet.delete(groupId);
    } else {
      expandedGroupIdSet.add(groupId);
    }

    return syncVisibleTreeState({
      ...state,
      viewState: {
        ...state.viewState,
        expandedGroupIds: [...expandedGroupIdSet],
      },
    });
  });
};
