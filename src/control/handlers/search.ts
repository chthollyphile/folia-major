import { requireString } from '../errors';
import { searchSongs } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/search.ts
// folia_search: one normalised result page from the active/named provider, the local library, or both.

export const searchHandlers: Record<string, ControlHandler> = {
    folia_search: async (args, deps) => {
        const query = requireString(args.query, 'query');
        const source = typeof args.source === 'string' ? args.source : 'active';
        const provider = typeof args.provider === 'string' ? args.provider : undefined;
        const limit = typeof args.limit === 'number' ? args.limit : 10;
        const offset = typeof args.offset === 'number' ? args.offset : 0;
        const outcome = await searchSongs(deps, {
            query,
            source,
            ...(provider !== undefined ? { provider } : {}),
            limit,
            offset,
        });
        return {
            query,
            source,
            providerId: outcome.effectiveProviderId,
            limit,
            offset,
            total: outcome.total,
            hasMore: outcome.hasMore,
            // SongResult has no verified original/cover metadata; names are not evidence.
            items: outcome.items.map(item => ({ index: item.index, ...item.summary, recordingVersion: 'unknown' })),
        };
    },
};
