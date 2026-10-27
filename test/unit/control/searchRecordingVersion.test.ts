import { expect, it, vi } from 'vitest';
const { searchSongs } = vi.hoisted(() => ({ searchSongs: vi.fn() }));
vi.mock('../../../src/control/helpers', () => ({ searchSongs }));
import { searchHandlers } from '../../../src/control/handlers/search';
import type { ControlHandlerDeps } from '../../../src/control/types';

// Verify the actual renderer response consumed by HTTP/MCP and the CLI JSON mode.
it('search preserves song identity while marking unverified recording versions unknown', async () => {
    searchSongs.mockResolvedValue({ effectiveProviderId: 'qishui', total: 2, hasMore: false, items: [
        { index: 0, summary: { id: 'a', title: 'Song (Original)', artist: 'Original Artist' } },
        { index: 1, summary: { id: 'b', title: 'Song (Cover)', artist: 'Cover Artist' } },
    ] });
    const result = await searchHandlers.folia_search({ query: 'Song', provider: 'qishui' }, {} as ControlHandlerDeps) as { items: Array<Record<string, unknown>> };
    expect(result.items).toEqual([
        { index: 0, id: 'a', title: 'Song (Original)', artist: 'Original Artist', recordingVersion: 'unknown' },
        { index: 1, id: 'b', title: 'Song (Cover)', artist: 'Cover Artist', recordingVersion: 'unknown' },
    ]);
});
