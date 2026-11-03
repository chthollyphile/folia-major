import { removeFromCache } from '../../../../services/db';
import { omni } from '../../../../services/onlineMusic/omni';
import type { CollectionMutationDeps } from './collectionMutations.service';
import { useDailyRecommendationModeStore } from '../useDailyRecommendationModeStore';

// src/library/core/collection/mutations/collectionMutationDeps.service.ts
// 变更动作层的默认装配：在线变更走 omni，缓存走应用缓存。单测直接注入假的依赖，不经过这里，
// 所以不需要 mock 整个 omni（与 createCollectionResource 的做法相同）。

export const collectionMutationDeps: CollectionMutationDeps = {
    omni,
    removeCacheEntry: removeFromCache,
    dailyMode: {
        read: () => {
            const { mode, styleSelection } = useDailyRecommendationModeStore.getState();
            return { prefersStyle: mode === 'style', styleSelection };
        },
        setPrefersStyle: prefersStyle => useDailyRecommendationModeStore.getState().setMode(prefersStyle ? 'style' : 'default'),
        noteStyleSelection: selection => useDailyRecommendationModeStore.getState().noteStyleSelection(selection),
        subscribe: listener => useDailyRecommendationModeStore.subscribe(listener),
    },
};
