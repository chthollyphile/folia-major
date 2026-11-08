import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '../modal/settings/kit';
import { PanelButton } from '../panelTab/shell/PanelButton';
import { openRecommendationPreferences, useRecommendationPreferencesEntry } from './recommendationPreferencesEntry';

// src/components/recommendationPreferences/FmRecommendationPreferencesButton.tsx
// 私人 FM 页签顶上那一行的「偏好设置」：平台声明了私人 FM 的入口才出现，打开命令面板里的偏好面板。
// 和模式按钮同一种样子；平台的私人 FM 没有模式时，这一行就只有它。

export const FmRecommendationPreferencesButton: React.FC = () => {
    const { t } = useTranslation();
    const offered = useRecommendationPreferencesEntry('personal-fm');
    if (!offered) return null;
    const label = t('recommendationPreferences.open');
    return (
        <Tooltip text={label} className="inline-flex max-w-full">
            <PanelButton icon={SlidersHorizontal} onClick={openRecommendationPreferences} data-testid="fm-recommendation-preferences">
                {label}
            </PanelButton>
        </Tooltip>
    );
};
