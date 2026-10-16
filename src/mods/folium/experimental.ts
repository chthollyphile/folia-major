import { createFoliumPlaybackSessions } from './externalPlayback';
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
    FoliumSong,
} from './contract';
import { fromFoliumLines, toFoliumLines, toFoliumSong } from './dto';
import { addFoliumEventHandler, dispatchFoliumHookAsync, hasFoliumEventHandlers } from './events';
import { createFoliumRegistry } from './registry';
import { omniProvidersRegistry } from './registries/omniProviders';
import { registerRemoteActions, remoteActionsRegistry } from './registries/remoteActions';
import { addPonderText, localizePonderTarget, ponderTextNamespace, removePonderText } from './ponderText';

// src/mods/folium/experimental.ts
// The unfrozen surfaces, each behind a manifest opt-in (`experimental`):
//   - omni.providers: register an online music source (registries/omniProviders);
//   - omni.hooks:     rewrite lyrics / swap audio URLs Omni resolved;
//   - playback.sessions: own source selection and queue intent with host-managed teardown.
//   - ponder.targets: add Ponder (in-app tutorial) targets for the mod's own UI.
//   - remote.actions: append host-rendered buttons in the remote window.
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

export const ponderTargetsRegistry = createFoliumRegistry<PonderTargetInput, StoredPonderTarget>('ponder.targets', {
    validate: (def, { id }) => {
        if (def.titleKey === undefined || !def.category || !Array.isArray(def.scenes)) {
            throw new Error('ponder.targets.register: titleKey, category and scenes are required');
        }
        const namespace = ponderTextNamespace(id);
        const { target, resources } = localizePonderTarget(def, namespace);
        return { target: { ...target, id: id as PonderTargetId }, namespace, resources };
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
        return { quality: 'standard', ...(source ?? {}), url: event.url, fetchedAt: Date.now() };
    },
});

/** The `folium.experimental` object for one mod (only the names it opted into are reachable). */
export const createFoliumExperimental = (mod: ModRuntimeInfo): Record<string, unknown> => ({
    ...(mod.experimental?.includes('playback.sessions') ? { 'playback.sessions': createFoliumPlaybackSessions(mod) } : {}),
    'omni.providers': Object.freeze({
        register: (def: FoliumOmniProviderDef) => omniProvidersRegistry.register(mod.id, def),
    }),
    'omni.hooks': Object.freeze({
        on: (
            type: 'lyricsResolved' | 'audioSourceResolved',
            handler: (event: FoliumOmniLyricsEvent & FoliumOmniAudioEvent) => void | Promise<void>,
            options?: { priority?: FoliumEventPriority },
        ) => {
            if (type !== 'lyricsResolved' && type !== 'audioSourceResolved') {
                throw new Error(`omni.hooks.on: unknown hook "${String(type)}"`);
            }
            return addFoliumEventHandler(mod.id, `omni.${type}` as 'omni.lyricsResolved', handler as never, options?.priority);
        },
    }),
    'ponder.targets': Object.freeze({
        register: (def: PonderTargetInput) => ponderTargetsRegistry.register(mod.id, def),
    }),
    'remote.actions': Object.freeze({
        register: (def: FoliumRemoteActionsDef) => registerRemoteActions(mod.id, def),
    }),
});
