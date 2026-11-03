import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { useDailyRecommendationModeStore } from './useDailyRecommendationModeStore';

// src/library/core/collection/dailyRecommendationLoad.service.ts
// 每日推荐的资源从头加载（打开、重试、暂停后再开）时取哪一份歌：上次看的是风格推荐、当前平台也有风格推荐，
// 就直接取风格推荐（只发这一个请求，不先出默认推荐再换），答复带回来的风格记进 useDailyRecommendationModeStore；
// 否则是默认推荐。

export const loadPreferredDailySongs = async (): Promise<SongResult[]> => {
    const store = useDailyRecommendationModeStore.getState();
    if (store.mode === 'style' && omni.getActiveCapabilities().dailyStyleRecommendations) {
        // 取之前先清掉：答复回来之前不该显示上一次（可能是上一个账号）的风格。
        store.noteStyleSelection(null);
        const answer = await omni.getDailyStyleSongs();
        useDailyRecommendationModeStore.getState().noteStyleSelection(answer.selection);
        return answer.songs;
    }
    return omni.getDailySongs();
};
