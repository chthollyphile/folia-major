import React from 'react';
import { useTranslation } from 'react-i18next';
import type { FoliumParam } from './contract';
import { formatFoliumParamNumber, resolveFoliumLabel, resolveFoliumParamStep, sanitizeFoliumParams } from './params';

// src/mods/folium/FoliumParamFields.tsx
// The one param-form implementation in the mod system. Every schema-backed
// surface renders through it — command cards in the mods panel, visualizer
// settings, tunings and settings sections — so the field markup lives here and
// no surface can drift from the others.
//
// It is presentation-only: values, persistence and side effects stay with the
// caller. Styling comes from `token` so each surface can match its own shell
// (the mod panel is dark chrome, the settings panel follows the app theme).

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
    params: readonly FoliumParam[];
    /** Values with defaults already merged (see mergeFoliumParamValues). */
    values: Readonly<Record<string, unknown>>;
    disabled?: boolean;
    token: FoliumParamFieldToken;
    /** Renders the boolean toggle labels; defaults to the shared on/off keys. */
    booleanLabels?: { on: string; off: string };
    onChange: (param: FoliumParam, value: unknown) => void;
}

/*
 * Groups fields by their `group` label, keeping declaration order both for the
 * groups and inside each group. Ungrouped fields form a leading headless group.
 */
const groupParams = (params: FoliumParam[], language: string) => {
    const groups: { title: string | null; params: FoliumParam[] }[] = [];
    const byTitle = new Map<string | null, FoliumParam[]>();
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
    param: FoliumParam;
    value: unknown;
    disabled: boolean;
    token: FoliumParamFieldToken;
    onLabel: string;
    offLabel: string;
    language: string;
    onChange: (param: FoliumParam, value: unknown) => void;
}> = ({ param, value, disabled, token, onLabel, offLabel, language, onChange }) => {
    const label = resolveFoliumLabel(param.label, language, param.key);
    const description = param.description ? resolveFoliumLabel(param.description, language, '') : '';
    const title = description ? `${label}\n${description}` : label;
    const numericValue = typeof value === 'number' ? value : Number(param.defaultValue ?? param.min ?? 0);
    const fullRow = param.type !== 'boolean';
    return (
        <label className={`flex flex-col gap-1 min-w-0 ${fullRow ? 'col-span-2' : ''}`} title={title}>
            {param.type === 'number' ? (
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className={token.label}>{label}</span>
                    <span className={`${token.readonlyLabel} tabular-nums shrink-0 min-w-[2.5rem] text-right`}>
                        {Number.isFinite(numericValue) ? formatFoliumParamNumber(numericValue) : '—'}
                    </span>
                </div>
            ) : (
                <span className={token.label}>{label}</span>
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
                <select
                    className={token.input}
                    style={token.inputStyle}
                    value={typeof value === 'string' ? value : String(param.defaultValue ?? '')}
                    disabled={disabled}
                    onChange={(event) => onChange(param, event.target.value)}
                >
                    {(param.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                            {resolveFoliumLabel(option.label, language, option.value)}
                        </option>
                    ))}
                </select>
            ) : null}
        </label>
    );
};

export const FoliumParamFields: React.FC<FoliumParamFieldsProps> = ({
    params,
    values,
    disabled = false,
    token,
    booleanLabels,
    onChange,
}) => {
    const { t, i18n } = useTranslation();
    // 走 t：以前这里直接把 i18n key 当文案，于是所有布尔开关在任何语言下都显示 "mods.enabled"。
    const onLabel = booleanLabels?.on ?? t('mods.enabled');
    const offLabel = booleanLabels?.off ?? t('mods.disabled');
    const groups = React.useMemo(
        () => groupParams(sanitizeFoliumParams(params), i18n.language),
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
                    {group.params.map((param) => (
                        <FoliumParamField
                            key={param.key}
                            param={param}
                            value={values[param.key]}
                            disabled={disabled}
                            token={token}
                            onLabel={onLabel}
                            offLabel={offLabel}
                            language={i18n.language}
                            onChange={onChange}
                        />
                    ))}
                </React.Fragment>
            ))}
        </>
    );
};
