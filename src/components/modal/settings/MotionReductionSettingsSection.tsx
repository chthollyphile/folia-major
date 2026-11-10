import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import {
    MOTION_SURFACE_IDS,
    useMotionSettingsStore,
    type MotionSurfaceId,
} from '../../../stores/useMotionSettingsStore';

// src/components/modal/settings/MotionReductionSettingsSection.tsx
// 「降低动态效果」的控制面：一个跟随系统的总开关，加每个受影响界面各自的降级开关。
//
// 读 store 而不是接一串 props，和 GridViewSettingsSection 同一个路子，
// 这样命令面板的 surface 能直接复用这一个组件，不必再维护一份会漂移的 UI 副本。

type MotionReductionSettingsSectionProps = {
    settingsCardClass: string;
    settingsDividerClass: string;
    toggleOffBackgroundClass: string;
    theme?: Theme;
};

/** 每个面对应的文案 key，顺序即面板里的展示顺序。 */
const SURFACE_LABEL_KEYS: Record<MotionSurfaceId, { label: string; desc: string }> = {
    lattice: { label: 'options.reduceMotionLattice', desc: 'options.reduceMotionLatticeDesc' },
    transitionOverlay: { label: 'options.reduceMotionTransitionOverlay', desc: 'options.reduceMotionTransitionOverlayDesc' },
    collectionMorph: { label: 'options.reduceMotionCollectionMorph', desc: 'options.reduceMotionCollectionMorphDesc' },
    monetBackground: { label: 'options.reduceMotionMonetBackground', desc: 'options.reduceMotionMonetBackgroundDesc' },
    uiMicroMotion: { label: 'options.reduceMotionUiMicroMotion', desc: 'options.reduceMotionUiMicroMotionDesc' },
    settingsScroll: { label: 'options.reduceMotionSettingsScroll', desc: 'options.reduceMotionSettingsScrollDesc' },
};

const MotionReductionSettingsSection: React.FC<MotionReductionSettingsSectionProps> = ({
    settingsCardClass,
    settingsDividerClass,
    toggleOffBackgroundClass,
    theme,
}) => {
    const { t } = useTranslation();
    const surfaces = useMotionSettingsStore(state => state.reducedMotionSurfaces);
    const followSystem = useMotionSettingsStore(state => state.followSystemReducedMotion);
    const systemPrefers = useMotionSettingsStore(state => state.systemPrefersReducedMotion);
    const toggleSurface = useMotionSettingsStore(state => state.handleToggleReducedMotionSurface);
    const toggleFollowSystem = useMotionSettingsStore(state => state.handleToggleFollowSystemReducedMotion);

    const renderToggleRow = (
        label: string,
        description: string,
        active: boolean,
        onChange: (next: boolean) => void,
        forcedBySystem = false,
    ) => (
        <div className="flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                    {description}
                </div>
                {forcedBySystem && (
                    <div className="text-[11px] opacity-40 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.reduceMotionForcedBySystem')}
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={() => onChange(!active)}
                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!active ? toggleOffBackgroundClass : ''}`}
                style={{ backgroundColor: active ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                aria-pressed={active}
                aria-label={label}
            >
                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
        </div>
    );

    // 跟随系统打开且系统确实要求降级时，每一面都已经被压住了，此时再显示自己的开关为「关」
    // 会让人以为动效还在。所以那种情况下逐项开关照常可点，但补一行说明是谁在压它。
    const forcedBySystem = followSystem && systemPrefers;

    return (
        <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
            {/* 标题交给外面：实验室面板有自己的分区标题，命令面板的输入行会显示命令名。
                这里只留那句解释，因为「默认不再跟随系统」这件事必须说一次。 */}
            <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                {t('options.reduceMotionSectionDesc')}
            </div>

            <div className={`border-t pt-4 ${settingsDividerClass}`}>
                {renderToggleRow(
                    t('options.reduceMotionFollowSystem'),
                    t('options.reduceMotionFollowSystemDesc'),
                    followSystem,
                    toggleFollowSystem,
                )}
            </div>

            <div className={`border-t pt-4 space-y-4 ${settingsDividerClass}`}>
                {MOTION_SURFACE_IDS.map(surface => (
                    <React.Fragment key={surface}>
                        {renderToggleRow(
                            t(SURFACE_LABEL_KEYS[surface].label),
                            t(SURFACE_LABEL_KEYS[surface].desc),
                            surfaces[surface],
                            next => toggleSurface(surface, next),
                            forcedBySystem && !surfaces[surface],
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

export default MotionReductionSettingsSection;
