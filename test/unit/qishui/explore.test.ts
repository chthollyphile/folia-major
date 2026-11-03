import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { qishuiExplore, clearQishuiExplore } from '@/services/onlineMusic/qishui/qishuiExplore';
import { clearQishuiRecommendations, getQishuiFmCatalog } from '@/services/onlineMusic/qishui/qishuiRecommendations';
import { clearQishuiPlayback, readQishuiSongs } from '@/services/onlineMusic/qishui/qishuiPlayback';
import { createQishuiSceneCover } from '@/services/onlineMusic/qishui/qishuiSceneCover';
import { qishuiProvider } from '@/services/onlineMusic/qishui/qishuiProvider';
import { readQishuiSceneIcon, requestQishui } from '@/services/onlineMusic/qishui/qishuiTransport';
import type { ProviderExploreItem } from '@/types/onlineMusic';
import { track } from './fixtures';

// The explore stream across its "more" batches, what a sign-in that ran out drops, and scene artwork
// whose icon could not be read; the bridge is replaced by a stand-in.
vi.mock('@/services/onlineMusic/qishui/qishuiTransport', async original => ({
    ...await original<typeof import('@/services/onlineMusic/qishui/qishuiTransport')>(),
    requestQishui: vi.fn(),
    readQishuiSceneIcon: vi.fn(),
}));
const request = vi.mocked(requestQishui);
const batch = (ids: string[], hasMore = true) => ({ items: ids.map(id => track(id)), hasMore });
const idsOf = (items: ProviderExploreItem[]) => items.map(item => (item.kind === 'song' ? String(item.song.id) : item.collection.id));
beforeEach(() => {
    clearQishuiExplore(); clearQishuiRecommendations(); clearQishuiPlayback();
    request.mockReset();
    vi.mocked(readQishuiSceneIcon).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('Qishui explore stream', () => {
    it('shows each song once in a read, across its "more" batches and within one', async () => {
        request.mockResolvedValueOnce(batch(['1', '2', '2', '3']))
            .mockResolvedValueOnce(batch(['3', '4', '1', '5']))
            .mockResolvedValueOnce(batch(['5', '6'], false));
        const feed = await qishuiExplore.getFeed();
        const [section] = feed.sections;
        expect(section).toMatchObject({ id: 'stream' });
        expect(idsOf(section.items)).toEqual(['1', '2', '3']);
        const more = await qishuiExplore.getSectionItems!(section.moreCursor!);
        expect(idsOf(more.items)).toEqual(['4', '5']);
        const last = await qishuiExplore.getSectionItems!(more.moreCursor!);
        expect(idsOf(last.items)).toEqual(['6']);
        expect(last.moreCursor).toBeUndefined();
    });
    it('asks the stream again, a few times at most, while a batch brings only songs already shown', async () => {
        request.mockResolvedValueOnce(batch(['1', '2']))
            .mockResolvedValueOnce(batch(['1', '2']))
            .mockResolvedValueOnce(batch(['2', '3']));
        const [section] = (await qishuiExplore.getFeed()).sections;
        const more = await qishuiExplore.getSectionItems!(section.moreCursor!);
        expect(idsOf(more.items)).toEqual(['3']);
        expect(request).toHaveBeenCalledTimes(3);
        request.mockReset().mockResolvedValue(batch(['1', '2', '3']));
        const none = await qishuiExplore.getSectionItems!(more.moreCursor!);
        expect(none).toEqual({ items: [] });
        expect(request).toHaveBeenCalledTimes(3);
    });
    it('starts each read from the beginning anew, and answers the cursors of a read before with nothing', async () => {
        request.mockResolvedValue(batch(['1', '2']));
        const [first] = (await qishuiExplore.getFeed()).sections;
        const [again] = (await qishuiExplore.getFeed()).sections;
        expect(idsOf(again.items)).toEqual(['1', '2']);
        request.mockClear();
        expect(await qishuiExplore.getSectionItems!(first.moreCursor!)).toEqual({ items: [] });
        expect(request).not.toHaveBeenCalled();
    });
});

describe('Qishui sign-in that ran out', () => {
    it('drops the explore stream, the scene catalogue and the playability checks together', async () => {
        request.mockImplementation(async operation => {
            if (operation === 'feed') return batch(['1', '2']);
            if (operation === 'feed_modes') return [{ id: '7', name: 'Drive', group: 'Scenes' }];
            if (operation === 'check_tracks') return { statuses: [{ id: '1', riskResult: 0 }] };
            return null;
        });
        const [section] = (await qishuiExplore.getFeed()).sections;
        await getQishuiFmCatalog();
        const [song] = await readQishuiSongs([track('1')]);
        expect(qishuiProvider.playback!.getAvailability!(song)).toEqual({ state: 'playable' });
        request.mockClear();
        await getQishuiFmCatalog();
        expect(request).not.toHaveBeenCalled();

        await qishuiProvider.auth!.signInRanOut!();
        expect(qishuiProvider.playback!.getAvailability!(song)).toEqual({ state: 'unknown' });
        expect(await qishuiExplore.getSectionItems!(section.moreCursor!)).toEqual({ items: [] });
        await getQishuiFmCatalog();
        expect(request).toHaveBeenCalledExactlyOnceWith('feed_modes');
    });
    it('does not hand out radio cards from a scene catalogue read under the account before', async () => {
        let finish!: (rows: unknown) => void;
        request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const cards = qishuiProvider.recommendations!.getRecommendedCollections!(10);
        await qishuiProvider.auth!.signInRanOut!();
        finish([{ id: '7', name: 'Drive', group: 'Scenes' }]);
        expect(await cards).toEqual([]);
    });
});

describe('Qishui scene artwork', () => {
    it('keeps the artwork with its icon, and asks again after an icon that could not be read', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const iconUrl = 'https://p3-luna.douyinpic.com/img/scene.png';
        vi.mocked(readQishuiSceneIcon).mockRejectedValueOnce(new Error('Scene artwork is unavailable'))
            .mockResolvedValue('data:image/webp;base64,UklGRg==');
        const vector = await createQishuiSceneCover('scene-a', iconUrl);
        expect(decodeURIComponent(vector)).not.toContain('<image');
        const withIcon = await createQishuiSceneCover('scene-a', iconUrl);
        expect(decodeURIComponent(withIcon)).toContain('href="data:image/webp;base64,UklGRg=="');
        await createQishuiSceneCover('scene-a', iconUrl);
        expect(readQishuiSceneIcon).toHaveBeenCalledTimes(2);
    });
});
