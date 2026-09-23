import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ModCommandParam } from './types';
import type { Theme } from '@/types';
import { resolveModLabel } from './useModsStore';
import { useModVisualizerSettingsStore } from './modVisualizerSettings';
import { ModParamFields, sanitizeModParams, type ModParamFieldToken } from './ModParamFields';
import { colorWithAlpha } from '@/components/visualizer/colorMix';

// src/mods/ModVisualizerSettingsPanel.tsx
// Settings form for a mod-contributed visualizer: the manifest declares
// visualizers[].settings with the same param shape as commands, this panel
// renders it inside the lyrics-animation settings (right under the mode
// picker), and values persist per mode in modVisualizerSettings.ts.
//
// Field markup is shared with the mod panel (ModParamFields); only the token
// differs, because this panel follows the app theme while the mod panel is dark
// chrome. Coloring therefore derives from `theme` + `isDaylight`.

interface ModVisualizerSettingsPanelProps {
    mode: string;
    settings: ModCommandParam[];
    label: Record<string, string | undefined>;
    fallbackLabel: string;
    theme: Theme;
    isDaylight: boolean;
    controlCardBg?: string;
    rangeInputClass?: string;
}

export const ModVisualizerSettingsPanel: React.FC<ModVisualizerSettingsPanelProps> = ({
    mode,
    settings,
    label,
    fallbackLabel,
    theme,
    isDaylight,
    controlCardBg,
    rangeInputClass,
}) => {
    const { t, i18n } = useTranslation();
    const values = useModVisualizerSettingsStore((state) => state.byMode[mode]);
    const setValues = useModVisualizerSettingsStore((state) => state.setValues);
    const resetMode = useModVisualizerSettingsStore((state) => state.resetMode);
    const current = values ?? {};

    const handleChange = (param: ModCommandParam, value: unknown) => setValues(mode, { [param.key]: value });

    /*
     * 卡片底色/描边由主题算出来，两个地方都要用（卡片容器与 token），所以只算一次。
     * theme 是对象 prop，父组件每次渲染都会换引用，因此这两行本身不 memo——
     * 真正要 memo 的是下面那个 token。
     */
    const fieldBg = colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34);
    const fieldBorder = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);
    /*
     * token 里带着 6 个内联 style 对象：每次渲染新建的话，父组件任何一次重渲染
     * （主题、昼夜、任何设置变化）都会让 `ModParamFields` 拿到新的 style 引用，
     * 于是所有字段的样式全部重算一遍。按输入 memo 掉，引用只随真正的依赖变。
     */
    const token: ModParamFieldToken = React.useMemo(() => {
        return {
            label: 'text-xs opacity-70 truncate',
            readonlyLabel: 'text-xs opacity-60 font-mono',
            input: 'w-full rounded-lg px-2.5 py-1.5 text-xs outline-none min-w-0',
            inputStyle: { backgroundColor: fieldBg, border: `1px solid ${fieldBorder}`, color: 'var(--text-primary)' },
            rangeClass: rangeInputClass,
            rangeStyle: { accentColor: theme.accentColor },
            toggleOn: '',
            toggleOff: '',
            dotOn: '',
            dotOff: '',
            toggleOnStyle: {
                backgroundColor: colorWithAlpha(theme.accentColor, isDaylight ? 0.18 : 0.24),
                border: `1px solid ${fieldBorder}`,
                color: 'var(--text-primary)',
            },
            toggleOffStyle: {
                backgroundColor: fieldBg,
                border: `1px solid ${fieldBorder}`,
                color: 'var(--text-primary)',
            },
            dotOnStyle: { backgroundColor: theme.accentColor },
            dotOffStyle: { backgroundColor: colorWithAlpha(theme.primaryColor, isDaylight ? 0.3 : 0.3) },
        };
    }, [theme, isDaylight, rangeInputClass, fieldBg, fieldBorder]);

    return (
        <div
            className="rounded-[24px] border p-4 space-y-4"
            style={{ backgroundColor: controlCardBg, borderColor: fieldBorder }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {resolveModLabel(label, i18n.language, fallbackLabel)}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.modVisualizerSettingsDesc')}
                </div>
            </div>

            <div className="space-y-3">
                <ModParamFields
                    params={settings}
                    values={current}
                    token={token}
                    booleanLabels={{ on: t('options.modVisualizerSettingsOn'), off: t('options.modVisualizerSettingsOff') }}
                    onChange={handleChange}
                />
            </div>

            <button
                type="button"
                onClick={() => resetMode(mode)}
                className="text-xs underline opacity-50 hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}
            >
                {t('options.modVisualizerSettingsReset')}
            </button>
        </div>
    );
};

/*
 * Registry-facing factory: turns a mod's declared settings schema into the
 * `renderSettingsPanel` hook. Kept here rather than inline at the registry build
 * site so the mod bridge only wires a contribution, not form internals.
 * Returns undefined when nothing renderable is declared (the gate runs the same
 * sanitizer the form does, so an all-malformed schema shows no panel instead of
 * an empty one).
 */
export const createModVisualizerSettingsPanel = (
    descriptor: {
        mode: string;
        settings: ModCommandParam[] | undefined;
        label: Record<string, string | undefined>;
        fallbackLabel: string;
    },
): ((props: {
    theme: Theme;
    isDaylight: boolean;
    controlCardBg: string;
    rangeInputClass: string;
}) => React.ReactNode) | undefined => {
    const settings = sanitizeModParams(descriptor.settings);
    if (settings.length === 0) return undefined;
    return (props) => (
        <ModVisualizerSettingsPanel
            mode={descriptor.mode}
            settings={settings}
            label={descriptor.label}
            fallbackLabel={descriptor.fallbackLabel}
            theme={props.theme}
            isDaylight={props.isDaylight}
            controlCardBg={props.controlCardBg}
            rangeInputClass={props.rangeInputClass}
        />
    );
};
