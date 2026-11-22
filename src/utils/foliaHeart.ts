import { omni } from '../services/onlineMusic/omni';
import type { SongResult } from '../types';
import { getPlaybackSourceRef } from './appPlaybackGuards';

// src/utils/foliaHeart.ts
// 红心归谁管（Folia 聚合歌单规格 §7、§11 第 4 条），只有这一份判断：
// - 本地歌：进出 Folia 的「我喜欢的音乐」；
// - 在线音源没有账号收藏能力（看能力声明，不认音源 id）：同样进出「我喜欢的音乐」，点亮状态也取自它；
// - 在线音源有账号收藏能力：红心只反映平台账号（哪怕这首歌经收藏框进过 Folia 的「我喜欢的音乐」）；
// - Navidrome：星标。
// 音源此刻没登记（模组停用、卸下、还没起来）时没有能力声明可读，说不出它有没有收藏能力：不进 Folia，红心照旧置灰，
// 免得把本该点给平台账号的红心记到 Folia 里。
// 「这首歌点不了红心」另有原因时（音源有收藏能力、但这一条是视频之类）不算进 Folia：按钮照旧置灰。

/** 这首歌的红心进出 Folia 的「我喜欢的音乐」。 */
export const likesGoToFolia = (song: SongResult | null | undefined): boolean => {
    if (!song) return false;
    const source = getPlaybackSourceRef(song);
    if (source.kind === 'local') return true;
    return source.kind === 'online'
        && omni.getProviderNaming(source.providerId) !== null
        && !omni.sourceHasLikes(source.providerId);
};
