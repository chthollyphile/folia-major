import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { ColorField } from '@/components/modal/settings/kit/ColorField';
import type { FoliumSetting } from '../folium/contract';
import { formatFoliumParamNumber, isFoliumSecretParam, resolveFoliumLabel, resolveFoliumParamDefault, resolveFoliumParamStep, sanitizeFoliumParams } from './params';
import { FoliumSelectField } from './FoliumSelectField';

// src/mods/params/FoliumParamFields.tsx
// The one param-form implementation in the mod system. Every schema-backed
// surface renders through it — command cards in the mods panel, visualizer
// settings, tunings and settings sections — so the field markup lives here and
// no surface can drift from the others.
//
// It is presentation-only: values, persistence and side effects stay with the
// caller. Styling comes from `token` so each surface can match its own shell
// (the mod panel is dark chrome, the settings panel follows the app theme).
// A choice uses the host CustomSelect (FoliumSelectField), a colour the settings
// kit's ColorField, as the app's settings do.

export interface FoliumParamFieldToken {
    label: string;
    readonlyLabel: string;
    input: string;
    /** Style applied to text/select inputs (colour, background, border). */
    inputStyle?: React.CSSProperties;
    rangeClass?: string;
    rangeStyle?: React.CSSProperties;
    groupLabel?: string;
    toggleOn: string;
    toggleOff: string;
    dotOn: string;
    dotOff: string;
    /** Optional inline styles for the boolean toggle (theme-driven surfaces). */
    toggleOnStyle?: React.CSSProperties;
    toggleOffStyle?: React.CSSProperties;
    dotOnStyle?: React.CSSProperties;
    dotOffStyle?: React.CSSProperties;
}

interface FoliumParamFieldsProps {
    params: readonly FoliumSetting[];
    /** Values with defaults already merged (see mergeFoliumParamValues). */
    values: Readonly<Record<string, unknown>>;
    disabled?: boolean;
    token: FoliumParamFieldToken;
    /** Renders the boolean toggle labels; defaults to the shared on/off keys. */
    booleanLabels?: { on: string; off: string };
    /**
     * Colours the select menu. It is portaled to document.body, out of reach
     * of the surface's CSS variables, so it needs the theme handed over.
     */
    theme?: Theme;
    isDaylight?: boolean;
    onChange: (param: FoliumSetting, value: unknown) => void;
    /**
     * Folium 1.7: draws a `secret` field (only settings sections have one). Its value is not in `values`
     * and never reaches `onChange`: the row talks to the main process itself (FoliumSecretField). Without
     * it a `secret` field is left out.
     */
    renderSecretField?: (param: FoliumSetting) => React.ReactNode;
}

/*
 * Groups fields by their `group` label, keeping declaration order both for the
 * groups and inside each group. Ungrouped fields form a leading headless group.
 */
const groupParams = (params: FoliumSetting[], language: string) => {
    const groups: { title: string | null; params: FoliumSetting[] }[] = [];
    const byTitle = new Map<string | null, FoliumSetting[]>();
    params.forEach((param) => {
        const title = param.group ? resolveFoliumLabel(param.group, language, '') || null : null;
        let bucket = byTitle.get(title);
        if (!bucket) {
            bucket = [];
            byTitle.set(title, bucket);
            groups.push({ title, params: bucket });
        }
        bucket.push(param);
    });
    return groups;
};

const FoliumParamField: React.FC<{
    param: FoliumSetting;
    value: unknown;
    disabled: boolean;
    token: FoliumParamFieldToken;
    onLabel: string;
    offLabel: string;
    language: string;
    theme?: Theme;
    isDaylight?: boolean;
    onChange: (param: FoliumSetting, value: unknown) => void;
}> = ({ param, value, disabled, token, onLabel, offLabel, language, theme, isDaylight, onChange }) => {
    const label = resolveFoliumLabel(param.label, language, param.key);
    const labelId = useId();
    const description = param.description ? resolveFoliumLabel(param.description, language, '') : '';
    const title = description ? `${label}\n${description}` : label;
    const numericValue = typeof value === 'number' ? value : Number(param.defaultValue ?? param.min ?? 0);
    // A switch and a colour swatch are small: two of them share a row.
    const fullRow = param.type !== 'boolean' && param.type !== 'color';
    /*
     * A select row is a <div>, not a <label>: a label around the trigger button
     * forwards clicks on its text to the button (with the menu open, the
     * mousedown closes it and the click reopens it) and folds the text into the
     * button's accessible name. The trigger is named by aria-labelledby instead:
     * this row's label span (labelId) followed by the value the trigger shows.
     */
    const Row = param.type === 'select' ? 'div' : 'label';
    return (
        <Row className={`flex flex-col gap-1 min-w-0 ${fullRow ? 'col-span-2' : ''}`} title={title}>
            {param.type === 'number' ? (
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className={token.label}>{label}</span>
                    <span className={`${token.readonlyLabel} tabular-nums shrink-0 min-w-[2.5rem] text-right`}>
                        {Number.isFinite(numericValue) ? formatFoliumParamNumber(numericValue) : '—'}
                    </span>
                </div>
            ) : (
                <span id={param.type === 'select' ? labelId : undefined} className={token.label}>{label}</span>
            )}

            {param.type === 'number' ? (
                <input
                    type="range"
                    className={token.rangeClass ?? 'w-full h-1.5 appearance-none rounded-full bg-white/10 cursor-pointer disabled:opacity-40 min-w-0'}
                    style={token.rangeStyle}
                    value={Number.isFinite(numericValue) ? numericValue : (param.min ?? 0)}
                    min={param.min ?? 0}
                    max={param.max ?? 100}
                    step={resolveFoliumParamStep(param)}
                    disabled={disabled}
                    onChange={(event) => onChange(param, event.target.valueAsNumber)}
                />
            ) : null}
            {param.type === 'text' ? (
                <input
                    type="text"
                    className={token.input}
                    style={token.inputStyle}
                    value={typeof value === 'string' ? value : ''}
                    placeholder={param.placeholder}
                    disabled={disabled}
                    onChange={(event) => onChange(param, event.target.value)}
                />
            ) : null}
            {param.type === 'boolean' ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(param, !value)}
                    className={`flex items-center gap-2 w-fit px-2.5 py-1 rounded-lg text-xs transition-colors ${
                        value ? token.toggleOn : token.toggleOff
                    } disabled:opacity-50`}
                    style={value ? token.toggleOnStyle : token.toggleOffStyle}
                >
                    <span
                        className={`w-1.5 h-1.5 rounded-full ${value ? token.dotOn : token.dotOff}`}
                        style={value ? token.dotOnStyle : token.dotOffStyle}
                    />
                    {value ? onLabel : offLabel}
                </button>
            ) : null}
            {param.type === 'select' ? (
                <FoliumSelectField
                    param={param}
                    value={value}
                    label={label}
                    labelId={labelId}
                    language={language}
                    disabled={disabled}
                    inputClassName={token.input}
                    inputStyle={token.inputStyle}
                    theme={theme}
                    isDaylight={isDaylight}
                    onChange={onChange}
                />
            ) : null}
            {param.type === 'color' ? (
                <ColorField
                    value={typeof value === 'string' ? value : String(resolveFoliumParamDefault(param))}
                    label={label}
                    onChange={(next) => onChange(param, next)}
                />
            ) : null}
        </Row>
    );
};

export const FoliumParamFields: React.FC<FoliumParamFieldsProps> = ({
    params,
    values,
    disabled = false,
    token,
    booleanLabels,
    theme,
    isDaylight,
    onChange,
    renderSecretField,
}) => {
    const { t, i18n } = useTranslation();
    // 走 t：以前这里直接把 i18n key 当文案，于是所有布尔开关在任何语言下都显示 "mods.enabled"。
    const onLabel = booleanLabels?.on ?? t('mods.enabled');
    const offLabel = booleanLabels?.off ?? t('mods.disabled');
    const groups = React.useMemo(
        // The registries already dropped a `secret` field wherever one is not allowed.
        () => groupParams(sanitizeFoliumParams(params, undefined, { allowSecret: true }), i18n.language),
        [params, i18n.language],
    );

    return (
        <>
            {groups.map((group, index) => (
                <React.Fragment key={group.title ?? `__ungrouped_${index}`}>
                    {group.title ? (
                        <div className={`col-span-2 ${token.groupLabel ?? 'text-[11px] font-medium opacity-70 pt-1'}`}>
                            {group.title}
                        </div>
                    ) : null}
                    {group.params.map((param) => (isFoliumSecretParam(param) ? (
                        <React.Fragment key={param.key}>{renderSecretField?.(param) ?? null}</React.Fragment>
                    ) : (
                        <FoliumParamField
                            key={param.key}
                            param={param}
                            value={values[param.key]}
                            disabled={disabled}
                            token={token}
                            onLabel={onLabel}
                            offLabel={offLabel}
                            language={i18n.language}
                            theme={theme}
                            isDaylight={isDaylight}
                            onChange={onChange}
                        />
                    )))}
                </React.Fragment>
            ))}
        </>
    );
};
