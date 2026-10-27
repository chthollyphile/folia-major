import { omni } from '../../services/onlineMusic/omni';
import type { LocalSong } from '../../types';
import { ControlError, requireString } from '../errors';
import { filterLocalSongs, summarizeLocalSong } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/library.ts
// The imported local library (list / search / play) and the online provider registry.

const listLocalSongs = (localSongs: LocalSong[], offset: number, limit: number) => {
    const page = localSongs.slice(offset, offset + limit);
    return {
        items: page.map((song, index) => ({ index: offset + index, ...summarizeLocalSong(song) })),
        total: localSongs.length,
        offset,
        limit,
    };
};

export const libraryHandlers: Record<string, ControlHandler> = {
    folia_library: async (args, deps) => {
        const action = requireString(args.action, 'action');
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        const localSongs = deps.localSongs;

        if (action === 'list') {
            return listLocalSongs(localSongs, offset, limit);
        }

        if (action === 'search') {
            const query = requireString(args.query, 'query');
            const matches = filterLocalSongs(localSongs, query);
            const page = matches.slice(offset, offset + limit);
            return {
                query,
                items: page.map((song, index) => ({ index: offset + index, ...summarizeLocalSong(song) })),
                total: matches.length,
                offset,
                limit,
            };
        }

        if (action === 'play') {
            const id = requireString(args.id, 'id');
            const song = localSongs.find(candidate => candidate.id === id);
            if (!song) {
                throw new ControlError('no_song', `Local song "${id}" is not in the library`, { id });
            }
            await deps.playLocalSong(song);
            return { playing: true, song: summarizeLocalSong(song) };
        }

        throw new ControlError('bad_request', `Unknown library action "${action}"`, {
            actions: ['list', 'search', 'play'],
        });
    },

    folia_providers: () => {
        const providers = omni.getProviderSummaries().map((summary) => {
            let capabilities: unknown = null;
            try {
                capabilities = omni.getProviderCapabilities(summary.providerId);
            } catch (error) {
                console.warn('[Control] Could not read provider capabilities:', error);
            }
            return {
                id: summary.providerId,
                displayName: summary.displayName,
                shortName: summary.shortName,
                status: summary.status,
                requiresAccount: summary.requiresAccount ?? false,
                availability: summary.availability,
                user: summary.user
                    ? { id: summary.user.id, nickname: summary.user.nickname, avatarUrl: summary.user.avatarUrl ?? null }
                    : null,
                capabilities,
            };
        });
        return { providers, total: providers.length };
    },
};
