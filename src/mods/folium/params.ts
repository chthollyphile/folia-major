import type { FoliumParam, FoliumParamType } from './contract';

// src/mods/folium/params.ts
// The one implementation of FoliumParam semantics: schema sanitizing, default
// merging, value validation on write, and slider step inference. Settings
// sections, visualizer settings, tunings and command params all go through it,
// so no two surfaces can disagree on what a schema means.

const PARAM_TYPES: readonly FoliumParamType[] = ['number', 'text', 'boolean', 'select'];

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/*
 * Field-level validation of a declared schema. Mods pass schemas as plain
 * objects, so every malformed entry — missing key, unknown type, NaN default,
 * duplicate key — is rejected here and never reaches a form or a store.
 *
 * A numeric `defaultValue` must be a finite number; `'12'` drops the entry.
 * A select keeps only well-formed options and drops the entry when none remain.
 */
export const sanitizeFoliumParams = (params: unknown): FoliumParam[] => {
    if (!Array.isArray(params)) return [];
    const seen = new Set<string>();
    const out: FoliumParam[] = [];
    params.forEach((raw) => {
        if (!raw || typeof raw !== 'object') return;
        const param = raw as Partial<FoliumParam>;
        if (typeof param.key !== 'string' || !param.key || seen.has(param.key)) return;
        const type = PARAM_TYPES.includes(param.type as FoliumParamType) ? param.type as FoliumParamType : null;
        if (!type) return;
        const fallback = param.defaultValue;
        if (type === 'number' && fallback !== undefined && !isFiniteNumber(fallback)) return;
        if (type === 'boolean' && fallback !== undefined && typeof fallback !== 'boolean') return;
        if ((type === 'text' || type === 'select') && fallback !== undefined && typeof fallback !== 'string') return;
        const options = type === 'select' && Array.isArray(param.options)
            ? param.options.filter((option) => option && typeof option === 'object' && typeof option.value === 'string')
            : undefined;
        if (type === 'select' && (!options || options.length === 0)) return;
        let min = isFiniteNumber(param.min) ? param.min : undefined;
        let max = isFiniteNumber(param.max) ? param.max : undefined;
        if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
        seen.add(param.key);
        out.push({
            key: param.key,
            type,
            label: param.label && typeof param.label === 'object' ? param.label : {},
            description: param.description && typeof param.description === 'object' ? param.description : undefined,
            group: param.group && typeof param.group === 'object' ? param.group : undefined,
            defaultValue: fallback,
            min,
            max,
            step: isFiniteNumber(param.step) && param.step > 0 ? param.step : undefined,
            placeholder: typeof param.placeholder === 'string' ? param.placeholder : undefined,
            options,
        });
    });
    return out;
};

/** The value a field has before the user touched it. */
export const resolveFoliumParamDefault = (param: FoliumParam): unknown => {
    if (param.defaultValue !== undefined) return param.defaultValue;
    switch (param.type) {
        case 'number': return param.min ?? 0;
        case 'boolean': return false;
        case 'select': return param.options?.[0]?.value ?? '';
        default: return '';
    }
};

/*
 * Coerces one incoming value to what the schema allows, or returns undefined
 * to reject it. Numbers are clamped into [min, max]; selects must name a
 * declared option; booleans and text must already have the right type.
 */
export const coerceFoliumParamValue = (param: FoliumParam, value: unknown): unknown => {
    switch (param.type) {
        case 'number': {
            if (!isFiniteNumber(value)) return undefined;
            let next = value;
            if (param.min !== undefined) next = Math.max(param.min, next);
            if (param.max !== undefined) next = Math.min(param.max, next);
            return next;
        }
        case 'boolean':
            return typeof value === 'boolean' ? value : undefined;
        case 'select':
            return typeof value === 'string' && param.options?.some((option) => option.value === value) ? value : undefined;
        default:
            return typeof value === 'string' ? value : undefined;
    }
};

/** Keeps only the keys the schema declares, each coerced; invalid entries are dropped. */
export const filterFoliumParamPatch = (schema: readonly FoliumParam[], patch: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    schema.forEach((param) => {
        if (!(param.key in patch)) return;
        const coerced = coerceFoliumParamValue(param, patch[param.key]);
        if (coerced !== undefined) out[param.key] = coerced;
    });
    return out;
};

/*
 * Stored values merged over defaults. Stored values are re-validated too: a
 * schema that tightened its range or dropped an option since the value was
 * saved must not leak a now-invalid value into the mod.
 */
export const mergeFoliumParamValues = (
    schema: readonly FoliumParam[],
    stored: Record<string, unknown> | undefined,
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    schema.forEach((param) => {
        const saved = stored && param.key in stored ? coerceFoliumParamValue(param, stored[param.key]) : undefined;
        out[param.key] = saved !== undefined ? saved : resolveFoliumParamDefault(param);
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
    isFiniteNumber(value) ? Number.isInteger(value) : Number.isInteger(fallback)
);

export const resolveFoliumParamStep = (param: Pick<FoliumParam, 'step' | 'min' | 'max'>): number => {
    if (isFiniteNumber(param.step) && param.step > 0) return param.step;
    // 上下界**都**是整数才当整数型；缺省的 0 / 100 本身是整数，所以没声明上下界时落在 1。
    return isIntegerBound(param.min, 0) && isIntegerBound(param.max, 100)
        ? DEFAULT_STEP_INTEGER
        : DEFAULT_STEP_FRACTIONAL;
};

export const formatFoliumParamNumber = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1);
    return value.toFixed(2);
};

/** Resolves a label map for the active language with a deterministic fallback chain. */
export const resolveFoliumLabel = (
    label: Record<string, string | undefined> | undefined,
    language: string,
    fallback: string,
): string => {
    if (!label) return fallback;
    return label[language] ?? label['zh-CN'] ?? label.en ?? fallback;
};
