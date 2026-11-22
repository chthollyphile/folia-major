import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/utils/foliaHeart.test.ts
// 红心归谁管：本地歌、没有账号收藏能力的在线音源的歌进 Folia 的「我喜欢的音乐」；有收藏能力的音源、Navidrome 不进。
// 看的是音源声明的能力，不认音源 id。

const omniMock = vi.hoisted(() => ({
    sourceHasLikes: vi.fn<(providerId: string) => boolean>(() => false),
    canLikeSong: vi.fn(() => false),
    getProviderLabel: vi.fn((providerId: string) => providerId),
    getProviderNaming: vi.fn<(providerId: string) => { displayName: string; shortName: string } | null>(providerId => (
        providerId === 'not-registered' ? null : { displayName: providerId, shortName: providerId }
    )),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

import { likesGoToFolia } from '@/utils/foliaHeart';
import { resolveLikeAvailability } from '@/utils/playerLikeAvailability';

const online = (providerId: string) => ({ id: 7, name: 'O', sourceRef: { kind: 'online', providerId, mediaId: '7' } } as unknown as SongResult);
const local = { id: 1, name: 'L', isLocal: true, localRef: { songId: 'l1' }, sourceRef: { kind: 'local', mediaId: 'l1' } } as unknown as SongResult;
const navidrome = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: { id: 'n1' }, sourceRef: { kind: 'navidrome', mediaId: 'n1' } } as unknown as SongResult;

describe('likesGoToFolia', () => {
    beforeEach(() => {
        omniMock.sourceHasLikes.mockReset();
        omniMock.sourceHasLikes.mockImplementation(providerId => providerId === 'with-likes');
        omniMock.canLikeSong.mockReturnValue(false);
    });

    it('takes local songs', () => {
        expect(likesGoToFolia(local)).toBe(true);
    });

    it('takes songs of a source that keeps no likes, whatever the source is called', () => {
        expect(likesGoToFolia(online('no-likes'))).toBe(true);
        expect(likesGoToFolia(online('another-one'))).toBe(true);
        expect(omniMock.sourceHasLikes).toHaveBeenCalledWith('no-likes');
    });

    it('leaves a source with likes of its own, and Navidrome, alone', () => {
        expect(likesGoToFolia(online('with-likes'))).toBe(false);
        expect(likesGoToFolia(navidrome)).toBe(false);
        expect(likesGoToFolia(null)).toBe(false);
    });

    it('leaves a source that is not registered alone: there is no declaration to read', () => {
        expect(likesGoToFolia(online('not-registered'))).toBe(false);
        expect(resolveLikeAvailability(online('not-registered'), false, false).disabled).toBe(true);
    });

    it('makes the heart available for a song of a source without likes', () => {
        // 有收藏能力、但这一首点不了（canLikeSong 说不行）：照旧置灰。没有收藏能力：可用，进 Folia。
        expect(resolveLikeAvailability(online('with-likes'), false, false).disabled).toBe(true);
        expect(resolveLikeAvailability(online('no-likes'), false, false).disabled).toBe(false);
    });
});
