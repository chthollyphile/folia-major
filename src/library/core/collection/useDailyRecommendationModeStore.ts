import { create } from 'zustand';
import type { DailyStyleSelection } from '../../../types/onlineMusic';
import { getStoredString, setStoredString } from '../../../stores/storagePrimitives';

// src/library/core/collection/useDailyRecommendationModeStore.ts
// 每日推荐上次看的是默认推荐还是风格推荐（#938）：记在本机，下次打开每日推荐直接是那一种（平台没有风格推荐时
// 照常是默认推荐）。另记最近一次风格推荐的风格（不存盘）：每日推荐由资源加载，控制器从这里知道那份歌是哪些风格；
// 每次取风格推荐都整个覆盖（答复没说风格就是 null），控制器换成功的也写回，所以不会留着上一个账号的。

const DAILY_RECOMMENDATION_MODE_STORAGE_KEY = 'folia.dailyRecommendations.mode';

export type DailyRecommendationMode = 'default' | 'style';

const readStoredMode = (): DailyRecommendationMode => {
    try {
        return getStoredString(DAILY_RECOMMENDATION_MODE_STORAGE_KEY, 'default') === 'style' ? 'style' : 'default';
    } catch {
        return 'default';
    }
};

type DailyRecommendationModeState = {
    mode: DailyRecommendationMode;
    /** 最近一次风格推荐的风格；还没有、正在取或答复没说时为 null。 */
    styleSelection: DailyStyleSelection | null;
    setMode: (mode: DailyRecommendationMode) => void;
    noteStyleSelection: (selection: DailyStyleSelection | null) => void;
};

export const useDailyRecommendationModeStore = create<DailyRecommendationModeState>((set, get) => ({
    mode: readStoredMode(),
    styleSelection: null,
    setMode: (mode) => {
        if (get().mode === mode) return;
        set({ mode });
        try {
            setStoredString(DAILY_RECOMMENDATION_MODE_STORAGE_KEY, mode);
        } catch {
            // Keep the choice for this session when storage is unavailable.
        }
    },
    noteStyleSelection: (selection) => {
        if (get().styleSelection !== selection) set({ styleSelection: selection });
    },
}));
