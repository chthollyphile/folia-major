import { registerPlaybackBackend } from '@/services/playbackBackend/registry';
import type { PlaybackBackendDefinition } from '@/services/playbackBackend/types';
import type { FoliumPlaybackBackendDefinition } from './contract';
import { createFoliumRegistry } from '../runtime/registry';
import { timeFoliumMod } from '../runtime/guard';

// The Folium adapter is the only mod-aware edge of the generic playback backend registry.

export const playbackBackendsRegistry = createFoliumRegistry<FoliumPlaybackBackendDefinition, {
    definition: PlaybackBackendDefinition;
    release?: () => void;
}>('playback.backends', {
    validate: (def, { modId }) => ({
        definition: {
            name: def.name,
            capabilities: def.capabilities,
            create: report => {
                const session = def.create(report);
                for (const name of ['open', 'play', 'pause', 'seek', 'setVolume', 'dispose'] as const) {
                    if (typeof session?.[name] !== 'function') throw new TypeError(`missing-backend-method:${name}`);
                }
                return {
                    open: source => timeFoliumMod(modId, 'backend open', () => session.open(source)),
                    play: () => timeFoliumMod(modId, 'backend play', () => session.play()),
                    pause: () => timeFoliumMod(modId, 'backend pause', () => session.pause()),
                    seek: seconds => timeFoliumMod(modId, 'backend seek', () => session.seek(seconds)),
                    setVolume: volume => timeFoliumMod(modId, 'backend volume', () => session.setVolume(volume)),
                    dispose: () => session.dispose(),
                };
            },
        },
    }),
    onAdd: entry => { entry.def.release = registerPlaybackBackend(entry.id, entry.def.definition); },
    onRemove: entry => entry.def.release?.(),
});
