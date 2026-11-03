import React from 'react';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme, ThemeMode } from '../../../types';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';
import { useThemeQuickEditorStore } from '../../../stores/useThemeQuickEditorStore';
import { PanelIconButton } from '../shell/PanelIconButton';
import { Segments } from '../shell/Segments';

// src/components/panelTab/controls/ThemeSourceRow.tsx
// 主题来源选择（默认 / AI / 自定义），旁边是快速编辑当前主题的按钮。
// 自定义主题不可用时保留占位而不是整格消失，避免这一行的宽度跳变。

interface ThemeSourceRowProps {
    themeSourceModel: ThemeSourceModel;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
}

/** The colour of a source's theme as a small dot; an outline alone for a source that has no theme yet. */
const SourceDot: React.FC<{ color?: string }> = ({ color }) => (
    <span
        className={`h-2 w-2 shrink-0 rounded-full ${color ? 'shadow-[inset_0_0_0_1px_var(--st-line2)]' : 'border border-dashed border-[var(--st-t3)]'}`}
        style={{ backgroundColor: color }}
    />
);

const ThemeSourceRow: React.FC<ThemeSourceRowProps> = ({
    themeSourceModel,
    onBgModeChange,
    hasCustomTheme,
    defaultTheme,
    daylightTheme,
    isDaylight,
}) => {
    const { t } = useTranslation();
    const openThemeQuickEditor = useThemeQuickEditorStore(state => state.openEditor);
    const aiThemeSource = themeSourceModel.options.ai;
    const customThemeSource = themeSourceModel.options.custom;
    const editableSource = themeSourceModel.editableSource;

    return (
        <div className="flex min-h-12 items-center gap-2">
            <Segments<ThemeMode>
                fill
                value={themeSourceModel.activeSource}
                onChange={onBgModeChange}
                options={[
                    {
                        value: 'default',
                        label: t('ui.default'),
                        icon: <SourceDot color={isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor} />,
                    },
                    {
                        value: 'ai',
                        label: t('ui.aiTheme'),
                        icon: <SourceDot color={aiThemeSource.available ? aiThemeSource.theme?.backgroundColor ?? 'rgba(114,119,134,0.4)' : undefined} />,
                        disabled: !aiThemeSource.available,
                    },
                    {
                        value: 'custom',
                        label: t('options.customTheme'),
                        icon: <SourceDot color={hasCustomTheme ? customThemeSource.theme?.accentColor ?? 'rgba(114,119,134,0.4)' : undefined} />,
                        disabled: !hasCustomTheme,
                        tip: hasCustomTheme ? undefined : t('options.customThemeUnavailable'),
                    },
                ]}
            />
            <PanelIconButton
                size="s"
                filled
                label={editableSource === 'custom'
                    ? t('options.customThemeQuickEditTitle')
                    : editableSource === 'ai'
                        ? t('options.aiThemeQuickEditTitle')
                        : t('options.themeQuickEditUnavailable')}
                disabled={!editableSource}
                onClick={() => {
                    if (editableSource) openThemeQuickEditor(editableSource);
                }}
            >
                <Palette size={15} />
            </PanelIconButton>
        </div>
    );
};

export default ThemeSourceRow;
