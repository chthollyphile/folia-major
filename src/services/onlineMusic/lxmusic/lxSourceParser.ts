// src/services/onlineMusic/lxmusic/lxSourceParser.ts
// 解析 LX 自定义音源脚本：抽取头部 @name/@description/@version/@author/@homepage 注释，
// 并对脚本做基本校验（必须包含 globalThis.lx 的使用、必须有 inited 事件）。
// 真正的「运行 + 注册」在 lxRuntime.ts；这里只做静态解析与元数据抽取。

import type { LxSourceMeta, LxPlatformKey } from './lxTypes';

const HEADER_RE = /@(\w+)\s+(.+)/g;

const KNOWN_PLATFORMS: LxPlatformKey[] = ['wy', 'kg', 'tx', 'kw', 'mg', 'local'];

/** 从脚本头部注释里抽取 @name 等元信息。 */
export const parseLxHeader = (code: string): LxSourceMeta => {
    const meta: LxSourceMeta = { name: '未命名音源' };
    const header = code.slice(0, Math.min(code.length, 4000));
    let match: RegExpExecArray | null;
    HEADER_RE.lastIndex = 0;
    // 只扫开头的块注释，避免命中正文里的 @xxx。
    const block = header.match(/\/\*\*([\s\S]*?)\*\//);
    const target = block ? block[1] : header;
    const re = /@(\w+)\s+(.+)/g;
    while ((match = re.exec(target)) !== null) {
        const key = match[1];
        const value = match[2].trim();
        switch (key) {
            case 'name': meta.name = value.slice(0, 48); break;
            case 'description': meta.description = value.slice(0, 64); break;
            case 'version': meta.version = value.slice(0, 32); break;
            case 'author': meta.author = value.slice(0, 48); break;
            case 'homepage': meta.homepage = value.slice(0, 256); break;
            default: break;
        }
    }
    return meta;
};

export class LxSourceParseError extends Error {}

/**
 * 对脚本做基本合法性检查，不执行它。
 *
 * 注意：这里**不能**要求字面量 `globalThis.lx`。市面上大量音源是混淆过的，
 * 里面写的是 `globalThis['\x6c\x78']`（就是 lx），甚至整个 `lx` 都拆成变量拼接。
 * 早先按字面量校验，这类音源会在「导入」这一步就被误判成「不是洛雪音源」。
 * 真正的判定交给运行时：脚本跑完有没有 send(inited) 才作数。
 */
export const validateLxScript = (code: string): void => {
    const trimmed = code.trim();
    if (trimmed.length < 40) {
        throw new LxSourceParseError('脚本内容过短，看起来不是有效的洛雪音源。');
    }
    if (/^\s*<(!doctype|html)/i.test(trimmed)) {
        throw new LxSourceParseError('拿到的是一个网页，不是音源脚本。请确认链接指向 .js 文件。');
    }
    const looksLikeSource = /globalThis|EVENT_NAMES|\brequest\b|\bsend\b/.test(trimmed);
    if (!looksLikeSource) {
        throw new LxSourceParseError('没有发现洛雪音源的特征（globalThis / EVENT_NAMES / request / send），这不是自定义音源脚本。');
    }
};

/** 把脚本（可能是被包裹过的 .json 或纯 .js）规整成纯 JS 文本。 */
export const normalizeLxScript = (raw: string): string => {
    const text = raw.trim();
    // 某些「音源」以 JSON 形式分发：{ name, script } 或 { source, script }。
    if (text.startsWith('{') && text.endsWith('}')) {
        try {
            const obj = JSON.parse(text);
            const script = obj.script ?? obj.source ?? obj.code ?? obj.js;
            if (typeof script === 'string' && script.length > 0) return script;
            if (typeof obj.rawScript === 'string') return obj.rawScript;
        } catch {
            // 不是 JSON，按纯 JS 处理。
        }
    }
    return text;
};

export { KNOWN_PLATFORMS };
