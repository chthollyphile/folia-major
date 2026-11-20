import i18n from '../../../i18n/config';
import type { RecommendationPresentation } from '../../../types/onlineMusic';

// 猜你喜欢电台和每日30首归探索页；真正的私人 FM 保留在电台页。
export const getQqRecommendationPresentation = () => ({
    homeTab: 'explore',
    personalFmHomeTab: 'radio',
    dailySongs: { name: i18n.t('home.daily30') },
} satisfies RecommendationPresentation);
