import type { FoliumRemoteActionDef, FoliumRemoteActionsContext, FoliumRemoteActionsDef, FoliumRemoteActionsHandle } from '../contract';
import { hasFoliumIcon } from '../icons';
import { createFoliumRegistry, foliumId, type FoliumRegistryEntry } from '../../runtime/registry';
import { reportFoliumIssue } from '../../runtime/status';

// src/mods/folium/registries/remoteActions.ts
// Main-window action groups; the companion receives only serialized button data.
// Epoch identifies a registration lifetime, never a presentation refresh.
interface StoredRemoteActions extends FoliumRemoteActionsDef {
    readonly epoch: string;
    readonly definition: FoliumRemoteActionsDef;
}
export interface ResolvedRemoteAction extends FoliumRemoteActionDef { readonly epoch: string }

// A defensive bound on one callback's result, not the experimental per-mod UI quota.
const MAX_ACTION_RESULT_LENGTH = 128;
const ACTION_ID = /^[a-z0-9][a-z0-9-]*$/;
const invalidationListeners = new Set<() => void>();

export const remoteActionsRegistry = createFoliumRegistry<FoliumRemoteActionsDef, StoredRemoteActions>('remote.actions', {
    validate: (def) => {
        if (typeof def.actions !== 'function') throw new TypeError('remote.actions: actions must be a function');
        if (def.order !== undefined && !Number.isFinite(def.order)) throw new TypeError('remote.actions: order must be finite');
        return Object.freeze({ id: def.id, order: def.order, actions: def.actions, epoch: crypto.randomUUID(), definition: def });
    },
});

export const registerRemoteActions = (modId: string, def: FoliumRemoteActionsDef): FoliumRemoteActionsHandle => {
    const definition = { ...def };
    const handle = remoteActionsRegistry.register(modId, definition);
    const owner = remoteActionsRegistry.get(handle.id);
    return Object.freeze({
        ...handle,
        invalidate: () => {
            if (!owner || owner.def.definition !== definition || remoteActionsRegistry.get(handle.id) !== owner) return;
            invalidationListeners.forEach((listener) => {
                try { listener(); }
                catch (error) { console.warn('[Folium] remote.actions listener failed', error); }
            });
        },
    });
};

export const subscribeRemoteActions = (listener: () => void): (() => void) => {
    const notify = () => listener();
    const unregister = remoteActionsRegistry.subscribe(notify);
    invalidationListeners.add(notify);
    return () => { unregister(); invalidationListeners.delete(notify); };
};

/** Freeze the mod's data before it crosses the bridge, retaining the locale map. */
const normalizeAction = (action: FoliumRemoteActionDef, owner: FoliumRegistryEntry<StoredRemoteActions>): ResolvedRemoteAction => {
    if (!action || typeof action.id !== 'string' || !ACTION_ID.test(action.id)) throw new TypeError('remote.actions: invalid action id');
    if (!action.label || typeof action.label !== 'object' || Array.isArray(action.label)
        || Object.values(action.label).some(value => value !== undefined && typeof value !== 'string')
        || !Object.values(action.label).some(value => typeof value === 'string' && value.trim())) {
        throw new TypeError('remote.actions: label must contain localized text');
    }
    if (typeof action.icon !== 'string' || !hasFoliumIcon(action.icon)) throw new TypeError('remote.actions: invalid Lucide icon');
    if (typeof action.run !== 'function') throw new TypeError('remote.actions: run must be a function');
    for (const field of ['disabled', 'pressed'] as const) {
        if (action[field] !== undefined && typeof action[field] !== 'boolean') throw new TypeError(`remote.actions: ${field} must be boolean`);
    }
    if (action.count !== undefined && (!Number.isFinite(action.count) || action.count < 0)) throw new TypeError('remote.actions: count must be nonnegative and finite');
    if (action.tone !== undefined && action.tone !== 'normal' && action.tone !== 'alert') throw new TypeError('remote.actions: invalid tone');
    if (action.scope !== undefined && action.scope !== 'track' && action.scope !== 'session') throw new TypeError('remote.actions: invalid scope');
    const run = action.run;
    const disabled = action.disabled ?? false;
    return Object.freeze({
        id: foliumId(owner.id, action.id), epoch: owner.def.epoch,
        label: Object.freeze({ ...action.label }), icon: action.icon, disabled,
        pressed: action.pressed ?? false, count: action.count, tone: action.tone ?? 'normal', scope: action.scope ?? 'track',
        run: async () => {
            if (remoteActionsRegistry.get(owner.id) !== owner) throw new Error('remote.actions: registration is no longer active');
            if (disabled) throw new Error('remote.actions: action is disabled');
            try { await run(); }
            catch (error) { reportFoliumIssue(owner.modId, `remote.actions ${owner.id}`, error); throw error; }
        },
    });
};

/** Resolve owned additions independently: one malformed group cannot hide another mod's buttons. */
export const resolveRemoteActions = (context: FoliumRemoteActionsContext): readonly ResolvedRemoteAction[] => {
    const resolved: ResolvedRemoteAction[] = [];
    const owners = [...remoteActionsRegistry.list()].sort((left, right) => (left.def.order ?? 0) - (right.def.order ?? 0));
    for (const owner of owners) {
        if (remoteActionsRegistry.get(owner.id) !== owner) continue;
        try {
            const actions = owner.def.actions(context);
            if (!Array.isArray(actions) || actions.length > MAX_ACTION_RESULT_LENGTH) throw new TypeError('remote.actions: expected a bounded array of actions');
            const ids = new Set<string>();
            const group: ResolvedRemoteAction[] = [];
            for (const action of actions) {
                const normalized = normalizeAction(action, owner);
                if (ids.has(normalized.id)) throw new TypeError('remote.actions: duplicate action id');
                ids.add(normalized.id);
                group.push(normalized);
            }
            if (remoteActionsRegistry.get(owner.id) === owner) resolved.push(...group);
        } catch (error) { reportFoliumIssue(owner.modId, `remote.actions ${owner.id}`, error); }
    }
    return Object.freeze(resolved);
};
