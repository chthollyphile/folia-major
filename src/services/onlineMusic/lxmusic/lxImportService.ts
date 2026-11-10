// src/services/onlineMusic/lxmusic/lxImportService.ts
// 导入洛雪音源：在线导入（粘贴网址）与本地导入（选 .js / .json 文件）。

import { lxSourceStore } from './lxSourceStore';
import { LxSourceParseError, normalizeLxScript, validateLxScript } from './lxSourceParser';
import type { LxSource } from './lxTypes';

export type ImportResult =
    | { ok: true; source: LxSource }
    | { ok: false; error: string };

const importRaw = async (raw: string, sourceUrl?: string): Promise<ImportResult> => {
    try {
        const code = normalizeLxScript(raw);
        validateLxScript(code);
        const source = await lxSourceStore.addSource({ rawScript: code, sourceUrl });
        if (source.error) {
            return { ok: false, error: `音源「${source.meta.name}」加载失败：${source.error}` };
        }
        return { ok: true, source };
    } catch (err) {
        if (err instanceof LxSourceParseError) return { ok: false, error: err.message };
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
};

/** 在线导入：从网址拉取音源脚本。 */
export const importLxSourceFromUrl = async (url: string): Promise<ImportResult> => {
    const trimmed = url.trim();
    if (!/^https?:\/\//.test(trimmed)) return { ok: false, error: '请输入以 http(s):// 开头的音源网址。' };
    try {
        const resp = await fetch(trimmed, { mode: 'cors' });
        if (!resp.ok) return { ok: false, error: `下载失败：HTTP ${resp.status}` };
        const text = await resp.text();
        return importRaw(text, trimmed);
    } catch (err) {
        return { ok: false, error: `下载失败：${err instanceof Error ? err.message : String(err)}（可能是跨域受限或网址不可达）` };
    }
};

/** 本地导入：读取用户选中的文件。 */
export const importLxSourceFromFile = async (file: File): Promise<ImportResult> => {
    try {
        const text = await file.text();
        return importRaw(text);
    } catch (err) {
        return { ok: false, error: `读取文件失败：${err instanceof Error ? err.message : String(err)}` };
    }
};
