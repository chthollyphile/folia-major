import { SlidersHorizontal } from 'lucide-react';
import { defineCommand } from '../commandFactories';
import { recommendationPreferencesSurface } from '../surfaces/recommendationPreferencesSurface';
import type { CommandPaletteCommand } from '../types';

// src/components/command-palette/commands/recommendationPreferencesCommand.ts
// 平台账号上的推荐偏好（能力 `recommendationPreferences`）：打开就是偏好面板。只在当前平台支持、已经登录时出现；
// 探索页、私人 FM、每日推荐上的入口打开的也是这一条。

/** 各处的入口按这个 id 打开同一个面板。 */
export const RECOMMENDATION_PREFERENCES_COMMAND_ID = 'playback-recommendation-preferences';

export const recommendationPreferencesCommand: CommandPaletteCommand = defineCommand({
    id: RECOMMENDATION_PREFERENCES_COMMAND_ID,
    group: 'playback',
    title: 'Preferences',
    description: 'Adjust the preferences kept on your account that steer what is recommended',
    // 不放「推荐」「fm」这类别的命令也在用的开头，免得输入一半就进了这一条；标题和它的拼音由命令面板自己认。
    keywords: ['recommendation preferences', 'music preferences', 'taste', '推荐偏好', '音乐偏好', '口味'],
    icon: SlidersHorizontal,
    requiresInput: true,
    surface: recommendationPreferencesSurface,
    isAvailable: context => context?.playback.isRecommendationPreferencesOffered() ?? false,
    placeholder: context => context.shared.t('commandPalette.recommendationPreferencesPlaceholder', 'Adjust your preferences below'),
    execute: () => false,
});
