import type { CommandPaletteSurface } from './types';

// src/components/command-palette/surfaces/recommendationPreferencesSurface.ts
// 「偏好设置」命令的面板：平台的推荐偏好（面板本身在 recommendationPreferences/，这里只声明怎么挂进命令面板）。

export const recommendationPreferencesSurface: CommandPaletteSurface = {
    load: () => import('../../recommendationPreferences/RecommendationPreferencesPanel'),
    inputProps: () => ({ readOnly: true }),
    mapProps: ({ isDaylight, theme, close }) => ({ isDaylight, theme, onClose: close }),
};
