import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ModCommandParam } from './types';
import { resolveModLabel } from './useModsStore';

// src/mods/ModParamFields.tsx
// The one param-form implementation in the mod system. Both callers render the
// same manifest schema — ModSurfaceRenderer (mod-panel commands) and
// ModVisualizerSettingsPanel (visualizer settings) — so the field markup lives
// here and neither can drift from the other.
//
// It is presentation-only: values, persistence and side effects stay with the
// caller. Styling comes from `token` so each surface can match its own shell
// (the mod panel is dark chrome, the settings panel follows the app theme).

export interface ModParamFieldToken {
    label: string;
    readonlyLabel: string;
    input: string;
    /** Style applied to text/select inputs (colour, background, border). */
    inputStyle?: React.CSSProperties;
    rangeClass?: string;
    rangeStyle?: React.CSSProperties;
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

interface ModParamFieldsProps {
    params: ModCommandParam[];
    values: Record<string, unknown>;
    disabled?: boolean;
    token: ModParamFieldToken;
    /** Renders the boolean toggle labels; defaults to the shared on/off keys. */
    booleanLabels?: { on: string; off: string };
    onChange: (param: ModCommandParam, value: unknown) => void;
}

/*
 * Field-level validation of a declared param schema. The loader passes params
 * through as declared (Array.isArray only), so every malformed entry — missing
 * key, unknown type, NaN default, duplicate key — has to be rejected here. One
 * implementation serves both command params and visualizer settings, so the two
 * schema kinds cannot accept different shapes.
 *
 * Returns a renderable list: keys are unique and non-empty, types are known, and
 * numeric bounds/defaults are finite (a NaN would blank a range input).
 *
 * One rule for numeric defaults: a declared `defaultValue` must be a finite
 * number, otherwise the whole entry is dropped. `'12'` is not accepted — a
 * string default would be coerced into `Number(value ?? '12' ?? 0)` at render
 * time, which reads as "strings are fine" to the next person editing a schema.
 */
const PARAM_TYPES = ['number', 'text', 'boolean', 'select'] as const;

export const sanitizeModParams = (params: ModCommandParam[] | undefined): ModCommandParam[] => {
    if (!Array.isArray(params)) return [];
    const seen = new Set<string>();
    const out: ModCommandParam[] = [];
    params.forEach((param) => {
        if (!param || typeof param !== 'object' || typeof param.key !== 'string' || !param.key) return;
        if (seen.has(param.key)) return;
        seen.add(param.key);
        const type = PARAM_TYPES.includes(param.type) ? param.type : 'number';
        const fallback = param.defaultValue;
        // Numeric fields need a finite default/bound, otherwise the slider lands on NaN.
        if (type === 'number' && fallback !== undefined && !(typeof fallback === 'number' && Number.isFinite(fallback))) return;
        out.push({
            ...param,
            type,
            min: typeof param.min === 'number' && Number.isFinite(param.min) ? param.min : undefined,
            max: typeof param.max === 'number' && Number.isFinite(param.max) ? param.max : undefined,
            step: typeof param.step === 'number' && Number.isFinite(param.step) && param.step > 0 ? param.step : undefined,
            options: type === 'select' && Array.isArray(param.options)
                ? param.options.filter((option) => option && typeof option === 'object' && typeof option.value === 'string')
                : [],
        });
    });
    return out;
};

/*
 * 没声明 step 的 numeric 参数用什么步进：整数型（像素、帧率、条数）按 1，倍率型按 0.01。
 *
 * 判据是**声明的 step 缺席时，这个旋钮是不是整数语义**，而不是一个和几何无关的跨度常数：
 * 按跨度推会让 `min:0,max:99.9` 落到 0.01、`min:0,max:100` 落到 1，两条手感只差 0.1 的
 * 上界。整数判据是「上下界都是整数」——像素/帧率/条数天然是整数，倍率型（0.6~1.4、
 * 0~3）上下界带小数，正好分在两边；没声明上下界时按整数处理（缺省 0~100，与写死
 * step 之前的缺省值 1 一致）。
 *
 * `sample-transparent-mov-export` 的「宽度 320~3840 / 高度 180~2160 / 帧率 10~60」
 * 走这一条回到整数手感：一屏 ~350px 的滑块表达 3520 个值，0.01 拖不到具体数值。
 * 表单与 sanitize 共用这一份推导，两边不会给出不同的步长。
 */
const DEFAULT_STEP_INTEGER = 1;
const DEFAULT_STEP_FRACTIONAL = 0.01;

const isIntegerBound = (value: number | undefined, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Number.isInteger(value) : Number.isInteger(fallback)
);

export const resolveModParamStep = (param: Pick<ModCommandParam, 'step' | 'min' | 'max'>): number => {
    if (typeof param.step === 'number' && Number.isFinite(param.step) && param.step > 0) return param.step;
    // 上下界**都**是整数才当整数型；缺省的 0 / 100 本身是整数，所以没声明上下界时落在 1。
    return isIntegerBound(param.min, 0) && isIntegerBound(param.max, 100)
        ? DEFAULT_STEP_INTEGER
        : DEFAULT_STEP_FRACTIONAL;
};

export const formatModParamNumber = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
};

export const ModParamFields: React.FC<ModParamFieldsProps> = ({
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
    const safeParams = React.useMemo(() => sanitizeModParams(params), [params]);

    return (
        <>
            {safeParams.map((param) => {
                const label = resolveModLabel(param.label, i18n.language, param.key);
                const value = values[param.key];
                const numericValue = typeof value === 'number' ? value : Number(value ?? param.defaultValue ?? 0);
                const fullRow = param.type !== 'boolean';
                return (
                    <label key={param.key} className={`flex flex-col gap-1 min-w-0 ${fullRow ? 'col-span-2' : ''}`}>
                        {param.type === 'number' ? (
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <span className={token.label} title={label}>{label}</span>
                                <span className={`${token.readonlyLabel} tabular-nums shrink-0 min-w-[2.5rem] text-right`}>
                                    {Number.isFinite(numericValue) ? formatModParamNumber(numericValue) : '—'}
                                </span>
                            </div>
                        ) : (
                            <span className={token.label} title={label}>{label}</span>
                        )}

                        {param.type === 'number' ? (
                            <input
                                type="range"
                                className={token.rangeClass ?? 'w-full h-1.5 appearance-none rounded-full bg-white/10 cursor-pointer disabled:opacity-40 min-w-0'}
                                style={token.rangeStyle}
                                value={Number.isFinite(numericValue) ? numericValue : (param.min ?? 0)}
                                min={param.min ?? 0}
                                max={param.max ?? 100}
                                step={resolveModParamStep(param)}
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
                                        {resolveModLabel(option.label, i18n.language, option.value)}
                                    </option>
                                ))}
                            </select>
                        ) : null}
                    </label>
                );
            })}
        </>
    );
};
