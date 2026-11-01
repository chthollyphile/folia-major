import { beforeEach, describe, expect, it, vi } from 'vitest';

// The renderer half of a Stage API search at one omni provider: it asks that provider through omni
// and hands each song back with its reference, or the failure.

const omniMock = vi.hoisted(() => ({ searchProviderSongs: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));
vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: { artists: Array<{ name: string }>; album?: { name: string }; durationMs: number; coverUrl?: string }) => ({
        artists: song.artists,
        album: song.album ?? { id: 0, name: '' },
        durationMs: song.durationMs,
        coverUrl: song.coverUrl,
        aliases: [],
        translatedNames: [],
    }),
}));

const { answerStageSearch } = await import('@/components/app/stage/useStagePlayerSearchBridge');

const complete = vi.fn(async () => true);

beforeEach(() => {
    omniMock.searchProviderSongs.mockReset();
    complete.mockClear();
    vi.stubGlobal('window', { electron: { completeStagePlayerSearchRequest: complete } });
});

describe('answerStageSearch', () => {
    it('searches the named provider on its own session and hands back each song with its reference', async () => {
        omniMock.searchProviderSongs.mockResolvedValue({
            items: [
                { id: 97773, name: '晴天', artists: [{ id: 1, name: '周杰伦' }, { id: 2, name: '' }], album: { id: 3, name: '叶惠美' }, durationMs: 269000, coverUrl: 'https://example.com/c.jpg' },
                { id: 'abc', name: '', artists: [], durationMs: 0 },
            ],
        });

        await answerStageSearch({ requestId: 's1', providerId: 'qq', query: '晴天', limit: 3 });

        expect(omniMock.searchProviderSongs).toHaveBeenCalledWith('qq', '晴天', { limit: 3, offset: 0 }, { session: 'stage-api' });
        expect(complete).toHaveBeenCalledWith({
            requestId: 's1',
            ok: true,
            songs: [
                { songId: 97773, title: '晴天', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000, coverUrl: 'https://example.com/c.jpg', provider: 'qq', songRef: 'qq:97773' },
                { songId: 'abc', title: 'Unknown Song', artists: [], album: '', durationMs: null, coverUrl: null, provider: 'qq', songRef: 'qq:abc' },
            ],
        });
    });

    it('hands back the failure when the provider cannot search', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        omniMock.searchProviderSongs.mockRejectedValue(new Error('Online music provider is not registered: nowhere'));

        await answerStageSearch({ requestId: 's2', providerId: 'nowhere', query: 'x', limit: 1 });

        expect(complete).toHaveBeenCalledWith({
            requestId: 's2',
            ok: false,
            error: 'Online music provider is not registered: nowhere',
        });
    });
});
