import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';

// src/components/modal/settings/LatticeSettingsSection.tsx
// 队列拼贴（海报墙）的外观设置，挂在外观页里。读 store 而不是接一串 props：这一区只属于
// useLatticeSettingsStore，再往 AppearanceSettingsSubview 的 props 里塞成对的值和 setter，
// 只会把那个已经上千行的文件继续撑大。

type LatticeSettingsSectionProps = {
    settingsCardClass: string;
    toggleOffBackgroundClass: string;
    theme?: Theme;
};

const LatticeSettingsSection: React.FC<LatticeSettingsSectionProps> = ({
    settingsCardClass,
    toggleOffBackgroundClass,
    theme,
}) => {
    const { t } = useTranslation();
    const latticeVignette = useLatticeSettingsStore(state => state.latticeVignette);
    const handleToggleLatticeVignette = useLatticeSettingsStore(state => state.handleToggleLatticeVignette);

    return (
        <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.latticeVignette')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.latticeVignetteDesc')}
                    </div>
                </div>
                <button
                    onClick={() => handleToggleLatticeVignette(!latticeVignette)}
                    className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!latticeVignette ? toggleOffBackgroundClass : ''}`}
                    style={{ backgroundColor: latticeVignette ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                    aria-pressed={latticeVignette}
                    aria-label={t('options.latticeVignette')}
                >
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${latticeVignette ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>
        </div>
    );
};

export default LatticeSettingsSection;
