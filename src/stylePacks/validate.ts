import { STYLE_PACK_SCHEMA } from './schema.ts';
import { CODE_PACK_SCHEMA } from './code/schema.ts';
import type { AnyStylePack } from './code/contract';

// Bounded validation; invalid imports never replace the currently selected pack.
export const MAX_PACK_BYTES = 4 * 1024 * 1024;
export interface PackIssue { path: string; code: string }
type Rule = { type?: string | string[]; const?: unknown; enum?: string[]; pattern?: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; items?: Rule; required?: string[]; properties?: Record<string, Rule>; additionalProperties?: boolean | Rule; maxProperties?: number };

function check(value: unknown, rule: Rule, path: string, issues: PackIssue[]): void {
    const fail = (code: string) => issues.push({ path, code });
    if ('const' in rule && value !== rule.const) return void fail('const');
    const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).includes(kind)) return void fail('type');
    if (typeof value === 'string') {
        if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail('pattern');
        if (rule.enum && !rule.enum.includes(value)) fail('enum');
        const length = Array.from(value).length;
        if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity)) fail('length');
    } else if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)) fail('range');
    } else if (Array.isArray(value)) {
        if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) return void fail('count');
        value.forEach((item, index) => rule.items && check(item, rule.items, `${path}[${index}]`, issues));
    } else if (kind === 'object') {
        const object = value as Record<string, unknown>;
        if (Object.keys(object).length > (rule.maxProperties ?? Infinity)) fail('count');
        for (const key of rule.required ?? []) if (!Object.hasOwn(object, key)) issues.push({ path: `${path}.${key}`, code: 'required' });
        for (const [key, item] of Object.entries(object)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) { issues.push({ path: `${path}.${key}`, code: 'key' }); continue; }
            const child = rule.properties && Object.hasOwn(rule.properties, key) ? rule.properties[key] : undefined;
            if (child) check(item, child, `${path}.${key}`, issues);
            else if (typeof rule.additionalProperties === 'object') check(item, rule.additionalProperties, `${path}.${key}`, issues);
            else if (rule.additionalProperties === false) issues.push({ path: `${path}.${key}`, code: 'unknown' });
        }
    }
}

export function validateStylePack(value: unknown): PackIssue[] {
    const issues: PackIssue[] = [];
    const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
    check(value, version === 2 ? CODE_PACK_SCHEMA : STYLE_PACK_SCHEMA, '$', issues);
    if (issues.length) return issues;
    const pack = value as AnyStylePack;
    if (pack.schemaVersion === 2) {
        const ids = new Set<string>();
        pack.assets?.forEach((asset, i) => {
            if (ids.has(asset.id)) issues.push({ path: `$.assets[${i}].id`, code: 'duplicate' });
            ids.add(asset.id);
            if (asset.data.length % 4 !== 0) issues.push({ path: `$.assets[${i}].data`, code: 'base64' });
        });
        return issues;
    }
    for (const [name, layers] of [['layers', pack.layers], ['portraitLayers', pack.portraitLayers]] as const) {
        const ids = new Set<string>();
        layers?.forEach((layer, index) => {
            const path = `$.${name}[${index}]`;
            if (ids.has(layer.id)) issues.push({ path: `${path}.id`, code: 'duplicate' });
            ids.add(layer.id);
            if (layer.x + layer.width > 100 || layer.y + layer.height > 100) issues.push({ path, code: 'bounds' });
            if ((layer.kind === 'text' || layer.kind === 'lyrics') && !layer.source) issues.push({ path: `${path}.source`, code: 'required' });
            if (layer.source === 'literal' && !layer.text) issues.push({ path: `${path}.text`, code: 'required' });
        });
    }
    return issues;
}

export class StylePackError extends Error {
    readonly issues: PackIssue[];
    constructor(issues: PackIssue[]) {
        super(issues.map(issue => `${issue.path}: ${issue.code}`).join('\n'));
        this.issues = issues;
        this.name = 'StylePackError';
    }
}

export function parseStylePack(text: string): AnyStylePack {
    if (new TextEncoder().encode(text).length > MAX_PACK_BYTES) throw new StylePackError([{ path: '$', code: 'size' }]);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new StylePackError([{ path: '$', code: 'json' }]); }
    const issues = validateStylePack(value);
    if ((value as { schemaVersion?: unknown } | null)?.schemaVersion === 1 && new TextEncoder().encode(text).length > 65536) issues.push({ path: '$', code: 'size' });
    if (issues.length) throw new StylePackError(issues);
    return value as AnyStylePack;
}

export async function readStylePack(file: File): Promise<AnyStylePack> {
    if (file.size > MAX_PACK_BYTES) throw new StylePackError([{ path: '$', code: 'size' }]);
    return parseStylePack(await file.text());
}

/** Pretty-print when it fits, otherwise retain a valid compact round trip. */
export function formatStylePack(pack: AnyStylePack): string {
    const pretty = JSON.stringify(pack, null, 2);
    return new TextEncoder().encode(pretty).length <= (pack.schemaVersion === 1 ? 65536 : MAX_PACK_BYTES) ? pretty : JSON.stringify(pack);
}
