import { omni } from '../../../services/onlineMusic/omni';
import type { SongResult } from '../../../types';
import type { OnlineHomeDiscoverDeps } from './onlineHomeDiscoverFeed';

// src/library/core/services/onlineHomeDiscoverDeps.ts
// 发现页资源的默认装配：四段数据都经 omni（按当前 provider 调用，provider 切换后它自己会拒绝旧应答）。
// 单测直接给资源注入假 deps，不经过这里。

export const onlineHomeDiscoverDeps: OnlineHomeDiscoverDeps = {
    getPersonalFm: () => omni.getPersonalFm(),
    getRecommendationRowSongs: (section, options) => omni.getRecommendationRowSongs(section, options),
};

export type DiscoverSeedSong = { id: string | number; providerId: string; name?: string };

/** 从「此刻在听」的那首里挑出种子：必须与当前音源同源，跨源时没有种子（相似段整段不出）。 */
export const resolveDiscoverSeed = (
    currentTrack: SongResult | null | undefined,
    providerId: string,
): DiscoverSeedSong | null => (
    currentTrack
    && currentTrack.sourceRef?.kind === 'online'
    && currentTrack.sourceRef.providerId === providerId
        ? { id: currentTrack.id, providerId, ...(currentTrack.name ? { name: currentTrack.name } : {}) }
        : null
);
