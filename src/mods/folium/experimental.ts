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
    FoliumSong,
} from './contract';
import { fromFoliumLines, toFoliumLines, toFoliumSong } from './dto';
import { addFoliumEventHandler, dispatchFoliumHookAsync, hasFoliumEventHandlers } from './events';
import { createFoliumRegistry } from './registry';
import { omniProvidersRegistry } from './registries/omniProviders';

// src/mods/folium/experimental.ts
// The unfrozen surfaces, each behind a manifest opt-in (`experimental`):
//   - omni.providers: register an online music source (registries/omniProviders);
//   - omni.hooks:     rewrite lyrics / swap audio URLs Omni resolved;
//   - ponder.targets: add Ponder (in-app tutorial) targets for the mod's own UI.
// Loaded lazily and only in the main window, so the export bundle never pulls
// in the provider registry. These can change in any folium minor.

/*
 * Ponder targets pass through the host definition shape — exactly why this is
 * experimental. The id gets the `<modid>:` prefix; `titleKey`/`summaryKey`
 * may be literal text, since a mod has no i18n keys of its own.
 */
type PonderTargetInput = Omit<PonderTargetDefinition, 'id'> & { id: string };

export const ponderTargetsRegistry = createFoliumRegistry<PonderTargetInput, PonderTargetDefinition>('ponder.targets', {
    validate: (def, { id }) => {
        if (typeof def.titleKey !== 'string' || !def.category || !Array.isArray((def as PonderTargetDefinition).scenes)) {
            throw new Error('ponder.targets.register: titleKey, category and scenes are required');
        }
        return { ...(def as unknown as PonderTargetDefinition), id: id as PonderTargetId };
    },
    onAdd: (entry) => {
        if (!registerPonderTarget(entry.def)) {
            throw new Error(`ponder.targets.register: target "${entry.id}" already exists`);
        }
    },
    onRemove: (entry) => {
        unregisterPonderTarget(entry.def.id);
    },
});

/** Registries owned by this module, for teardown alongside the stable ones. */
export const EXPERIMENTAL_REGISTRIES = [omniProvidersRegistry, ponderTargetsRegistry];

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
});
