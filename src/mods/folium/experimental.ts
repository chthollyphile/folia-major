import type { SongResult } from '@/types';
import type { PonderTargetDefinition, PonderTargetId } from '@/types/ponder';
import { registerPonderTarget, unregisterPonderTarget } from '@/components/ponder/ponderRegistry';
import { installOmniResultHooks } from '@/services/hostExtensionHooks';
import type { ModRuntimeInfo } from '../types';
import type {
    FoliumEventPriority,
    FoliumOmniAudioEvent,
    FoliumOmniLyricsEvent,
    FoliumOmniProviderDef,
    FoliumRemoteActionsDef,
    FoliumRemoteActionsHandle,
    FoliumSong,
} from './contract';
import { fromFoliumLines, toFoliumLines, toFoliumSong } from './dto';
import { addFoliumEventHandler, dispatchFoliumHookAsync, hasFoliumEventHandlers } from './events';
import { createFoliumRegistry } from '../runtime/registry';
import { gateFoliumCallback } from '../runtime/guard';
import { omniProvidersRegistry } from './registries/omniProviders';
import { registerRemoteActions, remoteActionsRegistry } from './registries/remoteActions';
import { addPonderText, localizePonderTarget, ponderTextNamespace, removePonderText } from './ponderText';
import { inertFoliumHandle, type FoliumStoppedCheck } from './api';
import { FOLIUM_EXPERIMENTAL } from './shared';
import { createFoliumPlatformService } from './platformRaw';

// src/mods/folium/experimental.ts
// The unfrozen surfaces, each behind a manifest opt-in (`experimental`):
//   - omni.providers: register an online music source (registries/omniProviders);
//   - omni.hooks:     rewrite lyrics / swap audio URLs Omni resolved;
//   - ponder.targets: add Ponder (in-app tutorial) targets for the mod's own UI.
//   - remote.actions: append host-rendered buttons in the remote window.
//   - platform.raw:   call a platform's own backend endpoints through Omni (platformRaw.ts, Folium 1.7).
// player.layout opts into FoliumStageContext.getLayout(), not a separate service.
// Loaded lazily and only in the main window, so the export bundle never pulls
// in the provider registry. These can change in any folium minor.

/*
 * Ponder targets pass through the host definition shape — exactly why this is
 * experimental. The id gets the `<modid>:` prefix. Text fields (titleKey,
 * summaryKey, scene titleKey, action labelKey, anchor labelKey, caption
 * textKey) take literal text or a per-language label instead of i18n keys; see
 * ponderText.ts for how they reach the host's t().
 */
type PonderTargetInput = { id: string } & Record<string, unknown>;

interface StoredPonderTarget {
    target: PonderTargetDefinition;
    namespace: string;
    resources: Record<string, Record<string, string>>;
}

/*
 * `isAvailable` (on a target and on a scene) is the mod's own function, and
 * the host asks it from hover and render paths. It goes through the gate; one
 * that throws reads as not given, which means "always applies".
 */
const gatePonderPredicates = (target: PonderTargetDefinition, modId: string): PonderTargetDefinition => {
    const gate = (isAvailable: () => boolean, where: string) => (
        gateFoliumCallback(modId, where, isAvailable) as () => boolean
    );
    return {
        ...target,
        ...(typeof target.isAvailable === 'function'
            ? { isAvailable: gate(target.isAvailable, `ponder target ${target.id} isAvailable`) }
            : {}),
        scenes: target.scenes.map((scene) => (
            typeof scene.isAvailable === 'function'
                ? { ...scene, isAvailable: gate(scene.isAvailable, `ponder target ${target.id} scene ${scene.id} isAvailable`) }
                : scene
        )),
    };
};

export const ponderTargetsRegistry = createFoliumRegistry<PonderTargetInput, StoredPonderTarget>('ponder.targets', {
    validate: (def, { modId, id }) => {
        if (def.titleKey === undefined || !def.category || !Array.isArray(def.scenes)) {
            throw new Error('ponder.targets.register: titleKey, category and scenes are required');
        }
        const namespace = ponderTextNamespace(id);
        const { target, resources } = localizePonderTarget(def, namespace);
        return { target: gatePonderPredicates({ ...target, id: id as PonderTargetId }, modId), namespace, resources };
    },
    onAdd: (entry) => {
        addPonderText(entry.def.namespace, entry.def.resources);
        if (!registerPonderTarget(entry.def.target)) {
            removePonderText(entry.def.namespace, entry.def.resources);
            throw new Error(`ponder.targets.register: target "${entry.id}" already exists`);
        }
    },
    onRemove: (entry) => {
        unregisterPonderTarget(entry.def.target.id);
        removePonderText(entry.def.namespace, entry.def.resources);
    },
});

/** Registries owned by this module, for teardown alongside the stable ones. */
export const EXPERIMENTAL_REGISTRIES = [omniProvidersRegistry, ponderTargetsRegistry, remoteActionsRegistry];

// ---- omni.hooks: installed once, active only while some mod listens

const omniSong = (song: SongResult): FoliumSong => toFoliumSong(song) as FoliumSong;

installOmniResultHooks({
    isActive: (kind) => hasFoliumEventHandlers(kind === 'lyrics' ? 'omni.lyricsResolved' : 'omni.audioSourceResolved'),
    lyrics: async (song, result) => {
        const originalHost = result.lyrics?.lines ?? [];
        const originalDtos = toFoliumLines(originalHost);
        const event: FoliumOmniLyricsEvent = { song: omniSong(song), lines: originalDtos, isPureMusic: result.isPureMusic };
        await dispatchFoliumHookAsync('omni.lyricsResolved', event);
        if (event.lines === originalDtos || !Array.isArray(event.lines)) return result;
        const lines = fromFoliumLines(originalHost, originalDtos, event.lines);
        return { ...result, lyrics: { ...(result.lyrics ?? {}), lines } };
    },
    audio: async (song, source) => {
        const event: FoliumOmniAudioEvent = { song: omniSong(song), url: source?.url ?? null };
        await dispatchFoliumHookAsync('omni.audioSourceResolved', event);
        if (event.url === (source?.url ?? null)) return source;
        if (typeof event.url !== 'string' || !/^https?:\/\//.test(event.url)) return source;
        // A URL the mod chose is not the clip its provider may have marked.
        return { quality: 'standard', ...(source ?? {}), url: event.url, fetchedAt: Date.now(), preview: false };
    },
});

/**
 * The `folium.experimental` object for one mod (only the names it opted into are reachable).
 * `stopped` is the activation's own check (api.ts): after a teardown every call here is refused.
 * `onRelease` receives what to do when the activation ends (platform.raw aborts its requests then).
 */
export const createFoliumExperimental = (
    mod: ModRuntimeInfo,
    stopped: FoliumStoppedCheck = () => false,
    onRelease: (release: () => void) => void = () => {},
): Record<string, unknown> => ({
    [FOLIUM_EXPERIMENTAL.omniProviders]: Object.freeze({
        register: (def: FoliumOmniProviderDef) => (
            stopped('experimental omni.providers.register')
                ? inertFoliumHandle(mod.id, def?.id)
                : omniProvidersRegistry.register(mod.id, def)
        ),
    }),
    [FOLIUM_EXPERIMENTAL.omniHooks]: Object.freeze({
        on: (
            type: 'lyricsResolved' | 'audioSourceResolved',
            handler: (event: FoliumOmniLyricsEvent & FoliumOmniAudioEvent) => void | Promise<void>,
            options?: { priority?: FoliumEventPriority },
        ) => {
            if (type !== 'lyricsResolved' && type !== 'audioSourceResolved') {
                throw new Error(`omni.hooks.on: unknown hook "${String(type)}"`);
            }
            if (stopped('experimental omni.hooks.on')) return () => {};
            return addFoliumEventHandler(mod.id, `omni.${type}` as 'omni.lyricsResolved', handler as never, options?.priority);
        },
    }),
    [FOLIUM_EXPERIMENTAL.ponderTargets]: Object.freeze({
        register: (def: PonderTargetInput) => (
            stopped('experimental ponder.targets.register')
                ? inertFoliumHandle(mod.id, def?.id)
                : ponderTargetsRegistry.register(mod.id, def)
        ),
    }),
    [FOLIUM_EXPERIMENTAL.remoteActions]: Object.freeze({
        register: (def: FoliumRemoteActionsDef): FoliumRemoteActionsHandle => (
            stopped('experimental remote.actions.register')
                ? Object.freeze({ ...inertFoliumHandle(mod.id, def?.id), invalidate: () => {} })
                : registerRemoteActions(mod.id, def)
        ),
    }),
    [FOLIUM_EXPERIMENTAL.platformRaw]: createFoliumPlatformService(mod, stopped, onRelease),
});
