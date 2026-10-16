import type { ExternalPlaybackCapabilities, ExternalPlaybackIntent } from '../types/externalPlayback';
import { configurePlaybackRequestGuard, invalidatePlaybackRequest } from './playbackRequest';

// src/services/externalPlaybackSession.ts
// Owns control routing, not provider logic or UI. Cleanup always releases the owner, even on errors.
interface Owner {
    token: symbol;
    modId: string;
    dispatch(intent: ExternalPlaybackIntent): void | Promise<void>;
    cleanup(): void;
    report(error: unknown): void;
    capabilities?: Readonly<ExternalPlaybackCapabilities>;
}
const report = (target: Owner, error: unknown) => {
    try {
        target.report(error);
    } catch (reportError) {
        console.warn('[Playback] session error reporter failed', reportError);
    }
};
let owner: Owner | null = null;
let releasing = false;
let revision = 0;
configurePlaybackRequestGuard((token) => !releasing && (token ? owner?.token === token : owner === null));
export const captureExternalPlaybackBoundary = () => {
    const started = revision;
    return () => started === revision;
};
const listeners = new Set<() => void>();
const notify = () =>
    listeners.forEach((fn) => {
        try {
            fn();
        } catch (error) {
            console.warn('[Playback] session subscriber failed', error);
        }
    });
export const subscribeExternalPlayback = (fn: () => void) => {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
};
export const hasExternalPlayback = () => owner !== null;
const DEFAULT_CAPABILITIES = Object.freeze({ canNext: true, canPrevious: true, canSeek: true });
export const getExternalPlaybackCapabilities = () => owner ? owner.capabilities ?? DEFAULT_CAPABILITIES : null;
export function setExternalPlaybackCapabilities(token: symbol, capabilities: ExternalPlaybackCapabilities) {
    if (!owner || owner.token !== token || releasing) throw new Error('playback-session-released');
    const current = getExternalPlaybackCapabilities()!;
    if (current.canNext === capabilities.canNext && current.canPrevious === capabilities.canPrevious
        && current.canSeek === capabilities.canSeek) return;
    owner.capabilities = Object.freeze({ ...capabilities });
    notify();
}
export const isExternalPlaybackOwner = (token: symbol) => !releasing && owner?.token === token;

/** Also invalidates delayed transport resumes when a lease reloads the same media URL. */
export function invalidateExternalPlaybackSource(token: symbol, reason: 'cancelled' | 'superseded' = 'cancelled') {
    if (!isExternalPlaybackOwner(token)) throw new Error('playback-session-released');
    revision++;
    invalidatePlaybackRequest(reason);
}

export function acquireExternalPlayback(options: Omit<Owner, 'token'>) {
    if (owner) throw new Error('external-playback-busy');
    invalidatePlaybackRequest();
    const token = Symbol('external-playback');
    owner = { ...options, token };
    revision++;
    notify();
    return token;
}

export function releaseExternalPlayback(token: symbol) {
    if (!owner || owner.token !== token || releasing) return;
    const previous = owner;
    // Store subscribers may run synchronously during cleanup. Keep the lease occupied
    // until restoration finishes so a new owner cannot be overwritten by the old one.
    releasing = true;
    revision++;
    invalidatePlaybackRequest();
    try {
        previous.cleanup();
    } catch (error) {
        report(previous, error);
    } finally {
        owner = null;
        releasing = false;
        notify();
    }
}

export function releaseExternalPlaybackForMod(modId: string) {
    if (owner?.modId === modId) releaseExternalPlayback(owner.token);
}
export function releaseAllExternalPlayback() {
    if (owner) releaseExternalPlayback(owner.token);
}

/** A failing owner is reported and released; the rejected command never falls through locally. */
export function routeExternalPlayback(intent: ExternalPlaybackIntent) {
    if (!owner) return false;
    if (releasing) return true;
    const capabilities = getExternalPlaybackCapabilities()!;
    if ((intent.type === 'next' && !capabilities.canNext)
        || (intent.type === 'previous' && !capabilities.canPrevious)
        || (intent.type === 'seek' && !capabilities.canSeek)) return true;
    const target = owner;
    const fail = (error: unknown) => {
        if (owner !== target) return;
        try {
            report(target, error);
        } finally {
            releaseExternalPlayback(target.token);
        }
    };
    try {
        Promise.resolve(target.dispatch(intent)).catch(fail);
    } catch (error) {
        fail(error);
    }
    return true;
}
