import type { FoliumContextKind, FoliumDisposer, FoliumSecretAccess } from './contract';
import type { ModSecretsState } from '../types';
import { invokeModSecrets, subscribeModSecretChanges } from '../ipc';
import { createFoliumGatedChannel } from '../runtime/guard';

// src/mods/folium/secrets.ts
// Folium 1.7 `secret` settings values on the window side: `folium.secrets` for a mod's client, and what
// the settings form uses to draw a section's `secret` fields. The values live in the main process
// (electron/modSystem/modSecrets.cjs); this side only asks for them, tells the main process which keys a
// registered section declares, and passes on the change notices, which carry the key and never the value.

/** The longest value, in UTF-8 bytes; the main process refuses a longer one with `secret-too-large`. */
export const FOLIUM_SECRET_MAX_BYTES = 8 * 1024;

type SecretOperation = 'get' | 'has' | 'set' | 'declare' | 'state';

// The last declaration sent for each mod. Every later call of that mod waits for it, so a call made
// right after the section registered never reaches the main process before the keys it uses.
const declarations = new Map<string, Promise<unknown>>();

const call = async <T>(modId: string, operation: SecretOperation, key?: string | readonly string[], value?: string | null): Promise<T> => {
    await declarations.get(modId);
    const settled = await invokeModSecrets(modId, operation, key, value);
    if (!settled.ok) {
        throw new Error(settled.error ?? 'folium-call-failed');
    }
    return settled.result as T;
};

/**
 * A settings section of `modId` declares these `secret` keys. Called when the section registers in the
 * main window; the main process then accepts the keys from the client, the form and the main entry. A
 * refusal (too many keys) is logged: the section still registers, its `secret` calls are then refused.
 */
export const declareFoliumSecretKeys = (modId: string, keys: readonly string[]) => {
    if (keys.length === 0) return;
    // Sent now, inside register, not after the previous declaration settles: IPC keeps the order of
    // what one window sends, so anything the client sends next (a folium.rpc.call, which does not wait
    // for `declarations`) reaches the main process after these keys.
    const sent = invokeModSecrets(modId, 'declare', [...keys])
        .then((settled) => {
            if (!settled.ok && settled.error !== 'no-electron-bridge') {
                console.warn(`[Folium:${modId}] secret fields could not be declared: ${settled.error}`);
            }
        })
        .catch((error) => console.warn(`[Folium:${modId}] secret fields could not be declared`, error));
    const previous = declarations.get(modId);
    declarations.set(modId, previous ? Promise.all([previous, sent]) : sent);
};

// The listeners of each mod, fed by one bridge subscription made on first use.
const listenersByMod = new Map<string, Set<(key: string) => void>>();
let detachBridge: (() => void) | null = null;

const ensureBridge = () => {
    if (detachBridge) return;
    detachBridge = subscribeModSecretChanges((change) => {
        if (!change || typeof change.modId !== 'string' || typeof change.key !== 'string') return;
        listenersByMod.get(change.modId)?.forEach((listener) => {
            try {
                listener(change.key);
            } catch (error) {
                console.warn('[Folium] secret change listener failed', error);
            }
        });
    });
};

/**
 * Calls `listener` with the key whenever one of `modId`'s secret values is saved or cleared, by the form,
 * the client or the main entry. The host side of the notice: a mod's listeners go through the gate first.
 */
export const subscribeFoliumSecretChanges = (modId: string, listener: (key: string) => void): FoliumDisposer => {
    ensureBridge();
    let listeners = listenersByMod.get(modId);
    if (!listeners) {
        listeners = new Set();
        listenersByMod.set(modId, listeners);
    }
    listeners.add(listener);
    return () => {
        listeners!.delete(listener);
        if (listeners!.size === 0 && listenersByMod.get(modId) === listeners) listenersByMod.delete(modId);
    };
};

/** For the settings form: whether values outlive this run, and which keys hold one. */
export const readFoliumSecretsState = (modId: string): Promise<ModSecretsState> => call<ModSecretsState>(modId, 'state');

/** For the settings form: saves a value the user typed, or clears it with null. */
export const writeFoliumSecret = (modId: string, key: string, value: string | null): Promise<void> => (
    call<void>(modId, 'set', key, value).then(() => undefined)
);

const unavailable = (context: FoliumContextKind) => Promise.reject(new Error(`secrets-unavailable-in-${context}-context`));

/**
 * `folium.secrets` for one mod's client. In the export window every call rejects and `subscribe` never
 * fires, as with the other main-window-only services. `onRelease` receives the function that ends this
 * activation's subscriptions.
 */
export const createFoliumSecrets = (
    modId: string,
    context: FoliumContextKind,
    onRelease: (release: () => void) => void,
): FoliumSecretAccess => {
    if (context !== 'main') {
        return Object.freeze({
            get: () => unavailable(context),
            has: () => unavailable(context),
            set: () => unavailable(context),
            subscribe: () => () => {},
        }) as FoliumSecretAccess;
    }
    // A listener runs through the gate and is removed when the activation ends.
    const channel = createFoliumGatedChannel(modId, 'secrets.subscribe', true);
    onRelease(channel.release);
    return Object.freeze({
        get: (key: string) => call<string | null>(modId, 'get', key),
        has: (key: string) => call<boolean>(modId, 'has', key),
        set: (key: string, value: string | null) => call<void>(modId, 'set', key, value).then(() => undefined),
        subscribe: (listener: (key: string) => void) => channel.subscribe(
            listener,
            (gated) => subscribeFoliumSecretChanges(modId, gated),
        ),
    });
};
