import { useSyncExternalStore } from 'react';
import { omni } from '../../services/onlineMusic/omni';
import { openCommandPaletteCommand } from '../../stores/useAppViewStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import type { RecommendationPreferenceEntry } from '../../types/onlineMusic';
import { RECOMMENDATION_PREFERENCES_COMMAND_ID } from '../command-palette/commands/recommendationPreferencesCommand';
import { offersRecommendationPreferencesAt, selectPreferencesAccountKey } from './useRecommendationPreferencesStore';

// src/components/recommendationPreferences/recommendationPreferencesEntry.ts
// 各处的「偏好设置」入口共用的两样：这一处该不该出现（当前平台声明了这个入口、已经登录），和打开同一个面板
// （命令面板里的「偏好设置」）。换平台、换账号、平台列表变了都会重新判断。

/** 打开偏好面板。 */
export const openRecommendationPreferences = (): void => {
    openCommandPaletteCommand(RECOMMENDATION_PREFERENCES_COMMAND_ID);
};

/** 这个入口现在出不出现。 */
export const useRecommendationPreferencesEntry = (entry: RecommendationPreferenceEntry): boolean => {
    // 只为了在账号这一侧变化时重新渲染；判断本身每次现读。
    useOnlineProviderAccountStore(selectPreferencesAccountKey);
    return useSyncExternalStore(omni.subscribeProviders, () => offersRecommendationPreferencesAt(entry));
};
