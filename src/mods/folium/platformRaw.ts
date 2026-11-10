import type { JsonValue } from '@/types/onlineMusic';
import { OnlineProviderError } from '@/types/onlineMusic';
import { omni } from '@/services/onlineMusic/omni';
import type { ModRuntimeInfo } from '../types';
import type {
    FoliumAccountState,
    FoliumJsonValue,
    FoliumPlatformDescription,
    FoliumPlatformErrorCode,
    FoliumPlatformResponse,
    FoliumPlatformService,
} from './contract';
import { readFoliumAccountState } from './account';
import type { FoliumStoppedCheck } from './api';
import { isFoliumRequestQuotaError, runFoliumRequest } from './omni/requestQuota';

// src/mods/folium/platformRaw.ts
// The experimental `platform.raw` (Folium 1.7, #788): a platform's own backend endpoints, called as the
// account signed in to Folia, for what Omni does not offer yet. Main window only (loaded with
// experimental.ts). Everything goes through Omni (`omni.requestProviderRaw`), which hands the call to
// the platform's adapter; the platform keeps the table of which endpoints read, which write and which
// are never open, and the adapter adds the session. Here: the mod's permissions against that table, its
// arguments, a cap on how often one mod may call, dropping an answer that comes after the account
// changed, and the platform's failures as the contract's codes.
//
// The cap is the allowance per mod id that `folium.omni` shares (omni/requestQuota.ts): 120 requests a
// minute and 8 under way at once. platform.raw does not join the allowance per source across all mods,
// and sets no answer time limit of the host's: the platform's transport gives these requests one.

/**
 * What `folium.omni` offers for the omni method a platform's endpoint does (the `omni` of its row in the
 * platform's table), for the developer log. A method not here has no typed interface yet; reading a
 * collection by id (`getCollectionDetail`, `getCollectionTracks`) is not here because those collections
 * are playlists on some platforms, and `folium.omni` opens no playlists.
 */
const FOLIUM_OMNI_MEMBERS: ReadonlyMap<string, string> = new Map([
    ['getSongDetail', 'folium.omni.resolveSongs'],
    ['getLyrics', 'folium.omni.getLyrics'],
    ['searchSongs', 'folium.omni.searchSongs'],
    ['getAlbumDetail', 'folium.omni.resolveCollection (an album\'s songs: folium.omni.getTracks)'],
    ['getArtistDetail', 'folium.omni.resolveCollection'],
    ['getArtistSongs', 'folium.omni.getTracks'],
    ['getArtistAlbums', 'folium.omni.getArtistAlbums'],
]);
/** The most `params` may weigh, as JSON. */
const MAX_PARAMS_LENGTH = 16 * 1024;
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A rejection with one of the contract's codes, as the code and as the message. */
const platformError = (code: FoliumPlatformErrorCode): Error => Object.assign(new Error(code), { code });

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const isJsonValue = (value: unknown, depth: number): boolean => {
    if (depth > 16) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
    return isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
};

/* The parameters as Omni takes them, or a TypeError that says what is wrong with them. */
const checkParams = (params: unknown, reserved: readonly string[]): Record<string, JsonValue> => {
    if (params === undefined) return {};
    if (!isPlainObject(params)) throw new TypeError('invalid-params: params must be a plain object');
    for (const [name, value] of Object.entries(params)) {
        if (!PARAM_NAME.test(name)) throw new TypeError(`invalid-params: "${name}" is no parameter name (letters, digits and _)`);
        if (reserved.includes(name)) throw new TypeError(`invalid-params: "${name}" is set by the host`);
        if (!isJsonValue(value, 0)) throw new TypeError(`invalid-params: "${name}" is not a JSON value`);
    }
    if (JSON.stringify(params).length > MAX_PARAMS_LENGTH) throw new TypeError('invalid-params: params are over 16 KB as JSON');
    return params as Record<string, JsonValue>;
};

/*
 * A platform's failure as a contract code. `signedIn`: an account was signed in when the request was
 * sent, which tells a session that ran out from no session at all.
 */
const codeOfFailure = (error: unknown, signedIn: boolean): FoliumPlatformErrorCode => {
    if (error instanceof OnlineProviderError) {
        if (error.code === 'auth-required') return signedIn ? 'session-expired' : 'not-signed-in';
        if (error.code === 'subscription-required') return 'vip-required';
        if (error.code === 'unsupported') return 'unsupported';
        if (error.httpStatus === 429 || error.retryAfterMs !== undefined) return 'rate-limited';
    }
    return 'network';
};

/**
 * `folium.experimental['platform.raw']` for one mod. `stopped` refuses calls after the activation was torn
 * down; `onRelease` receives the function that ends it, which aborts the requests still under way.
 */
export const createFoliumPlatformService = (
    mod: ModRuntimeInfo,
    stopped: FoliumStoppedCheck = () => false,
    onRelease: (release: () => void) => void = () => {},
): FoliumPlatformService => {
    // The requests under way or waiting, aborted when the activation ends: each then rejects with `aborted`.
    const underWay = new Set<AbortController>();
    onRelease(() => {
        underWay.forEach((controller) => controller.abort(new DOMException('The mod stopped', 'AbortError')));
        underWay.clear();
    });
    // Endpoints this mod has called, for the log line said once per endpoint.
    const told = new Set<string>();

    const describe = (providerId: string): FoliumPlatformDescription => {
        const info = typeof providerId === 'string' ? omni.getRawRequestInfo(providerId) : null;
        return info
            ? Object.freeze({ supported: true, backend: Object.freeze({ name: info.backend.name, version: info.backend.version }) })
            : Object.freeze({ supported: false });
    };

    const request = async (
        providerId: string,
        endpoint: string,
        params?: Record<string, FoliumJsonValue>,
        options?: { signal?: AbortSignal },
    ): Promise<FoliumPlatformResponse> => {
        if (typeof providerId !== 'string' || typeof endpoint !== 'string') {
            throw new TypeError('invalid-arguments: providerId and endpoint must be strings');
        }
        const signal = options?.signal;
        if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('invalid-arguments: options.signal must be an AbortSignal');
        if (stopped('experimental platform.raw.request') || signal?.aborted) throw platformError('aborted');

        const info = omni.getRawRequestInfo(providerId);
        if (!info) throw platformError('unsupported');
        const rule = omni.describeRawEndpoint(providerId, endpoint);
        if (!rule || rule.access === 'denied') {
            console.warn(`[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: refused, the platform does not open this endpoint`);
            throw platformError('endpoint-denied');
        }
        const needed = rule.access === 'write'
            ? [`platform.${providerId}.read`, `platform.${providerId}.write`]
            : [`platform.${providerId}.read`];
        const missing = needed.find((permission) => !mod.permissions.includes(permission));
        if (missing) throw platformError(`permission-denied:${missing}`);
        const sent = checkParams(params, info.reservedParams);
        // The values too, as the platform reads them: one it puts into the upstream path must not lead
        // the session-bearing request to another endpoint (`id: '../../logout'`).
        const problem = omni.checkRawParams(providerId, endpoint, sent);
        if (problem !== null) throw new TypeError(`invalid-params: ${problem}`);

        // Said once per endpoint, when the mod first calls it, refused by the allowance or not.
        if (!told.has(`${providerId}\n${endpoint}`)) {
            told.add(`${providerId}\n${endpoint}`);
            const typed = rule.omni ? FOLIUM_OMNI_MEMBERS.get(rule.omni) : undefined;
            console.info(typed
                ? `[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: Omni already offers this (omni.${rule.omni}), and Folium has it as ${typed}: use that instead`
                : rule.omni
                    ? `[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: Omni already offers this (omni.${rule.omni}); Folium has no typed interface for it yet`
                    : `[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: first call (${rule.access})`);
        }

        // Aborted by the caller's signal or by the end of the activation, whichever comes first, also while
        // it waits for a place.
        const controller = new AbortController();
        const abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true });
        underWay.add(controller);
        // The account the request is made as, read when it is sent. An answer that comes after a switch
        // of the provider or the account is dropped: it may be the previous account's.
        const sentAs = { generation: 0, before: null as FoliumAccountState | null };
        let body: JsonValue;
        try {
            // The allowance answers `aborted` at once when the controller aborts; the request itself is
            // aborted too (it gets the same signal), and its place comes back once it has stopped.
            body = await runFoliumRequest({
                modId: mod.id,
                providerId,
                origin: 'host',
                perSource: false,
                signal: controller.signal,
                answerWithinMs: null,
                what: `platform.raw ${providerId} ${endpoint}`,
            }, () => {
                sentAs.generation = omni.getActiveRequestGeneration();
                sentAs.before = readFoliumAccountState(providerId);
                return omni.requestProviderRaw(providerId, endpoint, sent, controller.signal);
            });
        } catch (error) {
            if (controller.signal.aborted) throw platformError('aborted');
            // The allowance's own refusal (`rate-limited`), already said in the developer log.
            if (isFoliumRequestQuotaError(error)) throw error;
            if ((error as { code?: unknown } | null)?.code === 'aborted') throw error;
            const code = codeOfFailure(error, sentAs.before?.status === 'signed-in');
            console.warn(`[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: ${code}`, error);
            throw platformError(code);
        } finally {
            underWay.delete(controller);
            signal?.removeEventListener('abort', abort);
        }
        const after = readFoliumAccountState(providerId);
        if (sentAs.generation !== omni.getActiveRequestGeneration() || (after?.accountKey ?? null) !== (sentAs.before?.accountKey ?? null)) {
            console.warn(`[Folium:${mod.id}] platform.raw ${providerId} ${endpoint}: the account changed while it was under way; the answer is dropped`);
            throw platformError('account-changed');
        }
        return Object.freeze({ body, accountKey: after?.accountKey ?? null });
    };

    return Object.freeze({ describe, request });
};
