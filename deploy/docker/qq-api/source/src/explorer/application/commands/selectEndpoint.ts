import { createExplorerRequestState } from '../../domain';
import { ExplorerStore } from '../ExplorerStore';
import { getEndpointByIdFromState, syncVisibleTreeState } from './helpers';

export const selectEndpoint = (store: ExplorerStore, endpointId: string): void => {
  store.updateState((state) => {
    const requestedEndpoint = getEndpointByIdFromState(state, endpointId);

    if (!requestedEndpoint) {
      return state;
    }

    const nextState = syncVisibleTreeState({
      ...state,
      viewState: {
        ...state.viewState,
        activeEndpointId: endpointId,
      },
    });

    return {
      ...nextState,
      requestState: createExplorerRequestState(requestedEndpoint),
    };
  });
};
