import type { RemoteActionActivation, RemoteActionDescriptor, RemoteActionsSnapshot } from '../types/remoteControl';

// src/utils/remoteActionActivation.ts

export const createRemoteActionActivation = (
    snapshot: RemoteActionsSnapshot,
    item: RemoteActionDescriptor,
): RemoteActionActivation => ({
    type: 'remote-action',
    epoch: snapshot.epoch,
    handle: item.handle,
    trackKey: snapshot.trackKey,
});
