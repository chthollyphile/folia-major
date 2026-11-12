// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/core/dailyRecommendationLoad.test.ts
// 每日推荐的资源按上次看的那种加载（#938）：风格推荐只在平台有它时才取，答复带回来的风格记下来。

const omni = vi.hoisted(() => ({
    getActiveCapabilities: vi.fn(() => ({ dailyStyleRecommendations: true })),
    getDailySongs: vi.fn(async () => [{ id: 'default' }]),
    getDailyStyleSongs: vi.fn(async () => ({ songs: [{ id: 'style' }], selection: { groupId: '1000', tagIds: ['10004'] } })),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni }));

import { loadPreferredDailySongs } from '@/library/core/collection/dailyRecommendationLoad.service';
import { useDailyRecommendationModeStore } from '@/library/core/collection/useDailyRecommendationModeStore';

describe('loadPreferredDailySongs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        useDailyRecommendationModeStore.setState({ mode: 'default', styleSelection: null });
    });

    it('loads the default list unless the style list was the last one seen', async () => {
        expect(await loadPreferredDailySongs()).toEqual([{ id: 'default' }]);
        expect(omni.getDailyStyleSongs).not.toHaveBeenCalled();
    });

    it('loads the style list in one request and notes its styles', async () => {
        useDailyRecommendationModeStore.getState().setMode('style');
        expect(localStorage.getItem('folia.dailyRecommendations.mode')).toBe('style');
        expect(await loadPreferredDailySongs()).toEqual([{ id: 'style' }]);
        expect(omni.getDailySongs).not.toHaveBeenCalled();
        expect(useDailyRecommendationModeStore.getState().styleSelection).toEqual({ groupId: '1000', tagIds: ['10004'] });
    });

    it('replaces the noted styles with whatever the answer says, none included', async () => {
        useDailyRecommendationModeStore.setState({ mode: 'style', styleSelection: { groupId: '1000', tagIds: ['10015'] } });
        omni.getDailyStyleSongs.mockResolvedValueOnce({ songs: [], selection: null as unknown as { groupId: string; tagIds: string[] } });
        await loadPreferredDailySongs();
        expect(useDailyRecommendationModeStore.getState().styleSelection).toBeNull();
    });

    it('falls back to the default list on a provider without style recommendations', async () => {
        useDailyRecommendationModeStore.getState().setMode('style');
        omni.getActiveCapabilities.mockReturnValueOnce({ dailyStyleRecommendations: undefined as unknown as true });
        expect(await loadPreferredDailySongs()).toEqual([{ id: 'default' }]);
    });
});
