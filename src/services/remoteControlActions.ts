import type { FoliumRemoteActionsContext } from '../mods/folium/contract';
import { remoteActionsRegistry, resolveRemoteActions } from '../mods/folium/registries/remoteActions';
import type { RemoteActionDescriptor, RemoteActionsSnapshot, RemoteControlCommand } from '../types/remoteControl';

// src/services/remoteControlActions.ts

interface RemoteActionsSource {
    trackKey: string | null;
    context: FoliumRemoteActionsContext;
}

interface ActionTicket {
    id: string;
    registrationEpoch: string;
}

/** Owns only mod-action tickets. Native remote commands never pass through this bridge. */
export const createRemoteControlActionBridge = (readSource: () => RemoteActionsSource) => {
    const epoch = crypto.randomUUID();
    const tickets = new Map<string, ActionTicket>();
    let revision = 0;
    let serialized = '';
    let snapshot: RemoteActionsSnapshot | undefined;
    let disposed = false;

    const clear = () => {
        tickets.clear();
        serialized = '';
        snapshot = undefined;
    };

    const read = (): RemoteActionsSnapshot | undefined => {
        if (disposed || !remoteActionsRegistry.list().length) {
            clear();
            return undefined;
        }
        const source = readSource();
        const actions = resolveRemoteActions(source.context);
        if (!actions.length) {
            clear();
            return undefined;
        }
        // Tickets follow registration identity, even if an action is temporarily hidden.
        tickets.clear();
        const items: RemoteActionDescriptor[] = actions.map((action) => {
            const handle = `${action.epoch}:${action.id}`;
            tickets.set(handle, { id: action.id, registrationEpoch: action.epoch });
            return Object.freeze({
                id: action.id,
                handle,
                label: action.label,
                icon: action.icon,
                disabled: action.disabled || (action.scope !== 'session' && source.trackKey === null),
                pressed: action.pressed,
                count: action.count,
                tone: action.tone,
            });
        });
        const nextSerialized = JSON.stringify([source.trackKey, items]);
        if (nextSerialized !== serialized) {
            serialized = nextSerialized;
            snapshot = Object.freeze({ epoch, revision: ++revision, trackKey: source.trackKey, items: Object.freeze(items) });
        }
        return snapshot;
    };

    /** Re-resolve at execution time; presentation revisions do not consume valid clicks. */
    const activate = async (command: RemoteControlCommand): Promise<boolean> => {
        if (disposed || !command || command.type !== 'remote-action' || command.epoch !== epoch) return false;
        const ticket = tickets.get(command.handle);
        if (!ticket) return false;
        const source = readSource();
        const action = resolveRemoteActions(source.context).find((item) => (
            item.id === ticket.id && item.epoch === ticket.registrationEpoch
        ));
        if (!action || action.disabled) return false;
        if (action.scope !== 'session' && (source.trackKey === null || source.trackKey !== command.trackKey)) return false;
        try {
            await action.run();
            return true;
        } catch {
            // The owned registry callback reports the mod issue before rejecting.
            return false;
        }
    };

    return { read, activate, dispose: () => { disposed = true; clear(); } };
};
