import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { colorWithAlpha } from '@/components/visualizer/colorMix';
import type { FoliumLabel, FoliumMount, FoliumSetting, FoliumSettingAccess, FoliumSettingsPanelContext } from '../folium/contract';
import { toFoliumTheme } from '../folium/dto';
import { isFoliumSecretParam, resolveFoliumLabel } from './params';
import { FoliumParamFields, type FoliumParamFieldToken } from './FoliumParamFields';
import { FoliumSecretField, useFoliumSecretsState } from './FoliumSecretField';
import { FoliumMountHost, foliumEntryAttributes, type FoliumEntryKind } from '../runtime/FoliumMountHost';
import type { FoliumHostContext } from '../folium/helpers';
import { useFoliumListeners, useFoliumNotifyOnChange } from '../runtime/listeners';

// src/mods/params/FoliumSettingsCard.tsx
// The themed card for any schema-backed Folium surface (visualizer settings,
// tunings, settings sections). It renders the schema with the shared form, or
// — when the mod supplies a custom panel — mounts that panel in a ShadowRoot
// and hands it the same FoliumSettingAccess. Either way the schema is the single
// source of keys, defaults and validation, so there is only one store.
// Folium 1.7 `secret` fields (settings sections only) are drawn by
// FoliumSecretField, which talks to the main process; their values are not
// in that store, and "reset" leaves them alone.

interface FoliumSettingsCardProps {
    modId: string;
    where: string;
    entryKind: FoliumEntryKind;
    entryId: string;
    title: FoliumLabel;
    fallbackTitle: string;
    access: FoliumSettingAccess;
    customPanel?: FoliumMount<FoliumSettingsPanelContext>;
    theme: Theme;
    isDaylight: boolean;
    controlCardBg?: string;
    rangeInputClass?: string;
    description?: string;
}

const useFoliumParamValues = (access: FoliumSettingAccess) => useSyncExternalStore(access.onChange, access.get, access.get);

/*
 * Custom panel context. Built once per access + locale so a theme change does
 * not remount the panel; the panel reads the theme through getTheme() and
 * hears about changes through onChange.
 */
const useSettingsPanelContext = (
    access: FoliumSettingAccess,
    locale: string,
    theme: Theme,
    isDaylight: boolean,
): FoliumHostContext<FoliumSettingsPanelContext> => {
    const themeRef = useRef({ theme, isDaylight });
    themeRef.current = { theme, isDaylight };
    const listeners = useFoliumListeners('settings panel subscriber');
    const ctx = useMemo<FoliumHostContext<FoliumSettingsPanelContext>>(() => Object.freeze({
        locale,
        settings: access,
        getTheme: () => toFoliumTheme(themeRef.current.theme, themeRef.current.isDaylight),
        subscribe: listeners.subscribe,
    }), [access, locale]);
    useFoliumNotifyOnChange(listeners, [theme, isDaylight]);
    return ctx;
};

export const FoliumSettingsCard: React.FC<FoliumSettingsCardProps> = ({
    modId,
    where,
    entryKind,
    entryId,
    title,
    fallbackTitle,
    access,
    customPanel,
    theme,
    isDaylight,
    controlCardBg,
    rangeInputClass,
    description,
}) => {
    const { t, i18n } = useTranslation();
    const values = useFoliumParamValues(access);
    const panelContext = useSettingsPanelContext(access, i18n.language, theme, isDaylight);
    const hasSecrets = access.schema.some(isFoliumSecretParam);
    // Whether the section has anything "reset" would restore.
    const hasPlainFields = access.schema.some((param) => !isFoliumSecretParam(param));
    const secretsState = useFoliumSecretsState(modId, hasSecrets && !customPanel);
    const foliumTheme = useMemo(() => toFoliumTheme(theme, isDaylight), [theme, isDaylight]);

    /*
     * 卡片底色/描边由主题算出来，两个地方都要用（卡片容器与 token），所以只算一次。
     * theme 是对象 prop，父组件每次渲染都会换引用，因此这两行本身不 memo——
     * 真正要 memo 的是下面那个 token。
     */
    const fieldBg = colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34);
    const fieldBorder = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);
    /*
     * token 里带着 6 个内联 style 对象：每次渲染新建的话，父组件任何一次重渲染
     * （主题、昼夜、任何设置变化）都会让表单拿到新的 style 引用，
     * 于是所有字段的样式全部重算一遍。按输入 memo 掉，引用只随真正的依赖变。
     */
    const token: FoliumParamFieldToken = useMemo(() => ({
        label: 'text-xs opacity-70 truncate',
        readonlyLabel: 'text-xs opacity-60 font-mono',
        input: 'w-full rounded-lg px-2.5 py-1.5 text-xs outline-none min-w-0',
        inputStyle: { backgroundColor: fieldBg, border: `1px solid ${fieldBorder}`, color: 'var(--text-primary)' },
        rangeClass: rangeInputClass,
        rangeStyle: { accentColor: theme.accentColor },
        groupLabel: 'text-xs font-medium opacity-80 pt-2',
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
        dotOffStyle: { backgroundColor: colorWithAlpha(theme.primaryColor, 0.3) },
    }), [theme, isDaylight, rangeInputClass, fieldBg, fieldBorder]);

    const handleChange = (param: FoliumSetting, value: unknown) => access.set({ [param.key]: value });

    return (
        <div
            className="rounded-[24px] border p-4 space-y-4"
            style={{ backgroundColor: controlCardBg, borderColor: fieldBorder }}
            {...foliumEntryAttributes(modId, entryKind, entryId)}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {resolveFoliumLabel(title, i18n.language, fallbackTitle)}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {description ?? t('options.modVisualizerSettingsDesc')}
                </div>
            </div>

            {customPanel ? (
                <FoliumMountHost
                    modId={modId}
                    where={where}
                    entryKind={entryKind}
                    entryId={entryId}
                    mount={customPanel}
                    ctx={panelContext}
                    shadow
                    fill={false}
                    theme={foliumTheme}
                    className="w-full"
                />
            ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <FoliumParamFields
                        params={access.schema}
                        values={values}
                        token={token}
                        booleanLabels={{ on: t('options.modVisualizerSettingsOn'), off: t('options.modVisualizerSettingsOff') }}
                        theme={theme}
                        isDaylight={isDaylight}
                        onChange={handleChange}
                        renderSecretField={(param) => (
                            <FoliumSecretField modId={modId} param={param} state={secretsState} token={token} />
                        )}
                    />
                </div>
            )}

            {customPanel || hasPlainFields ? (
                <button
                    type="button"
                    onClick={() => access.reset()}
                    className="text-xs underline opacity-50 hover:opacity-80"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {t('options.modVisualizerSettingsReset')}
                </button>
            ) : null}
        </div>
    );
};
