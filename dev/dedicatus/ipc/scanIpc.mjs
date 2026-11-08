import fs from 'node:fs';
import path from 'node:path';
// dev/dedicatus/ipc/scanIpc.mjs
// 读出主进程注册的 IPC 通道和 preload 调用的通道（零依赖，按文本扫描）。D605（通道的信任级别与来源校验）和
// D606（preload 与主进程对得上）的契约测试用它。只认字符串字面量的通道名；循环里拼出来的（hifiIpc、modSystem）认不出。

const listCjs = (root, dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listCjs(root, relative);
    return entry.name.endsWith('.cjs') ? [relative] : [];
});

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** 收 `event` 的守卫开头：`if (!isX(event))` 或 `if (!isX(event.sender))`，前面允许有注释。 */
const GUARD_FIRST_STATEMENT = /^(?:async\s+)?(?:function\s*\w*\s*)?\(?\s*(?:event|_event|e)\b[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*if\s*\(\s*!\s*is\w+\(\s*(?:event|e)(?:\.sender)?\s*\)/;

/**
 * 校验来源的处理函数工厂：名字 → 定义它的文件、它交给 isTrusted 的是什么（event 还是 webContents）、
 * 工厂本身校验来源的那一句。契约测试读这些文件，确认工厂还在校验。
 * @type {Record<string, { file: string, trustedTakes: 'event' | 'webContents', check: RegExp }>}
 */
export const GUARD_FACTORIES = {
    createSenderGuardedHandler: { file: 'electron/ipcAccessGuard.cjs', trustedTakes: 'event', check: /if \(!isTrusted\(event\)\)/ },
    createCompanionRequestHandler: { file: 'electron/appleMusic/companionIpc.cjs', trustedTakes: 'webContents', check: /if \(!isTrusted\(event\.sender\)/ },
};

/**
 * 主进程注册的通道。
 * @returns {{ file: string, line: number, channel: string, kind: string, guarded: boolean, factory: string | null, isTrusted: string | null }[]}
 */
export function scanMainChannels(root) {
    const found = [];
    for (const file of listCjs(root, 'electron')) {
        if (file === 'electron/preload.cjs') continue;
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        for (const match of text.matchAll(/ipcMain\.(handle|on|handleOnce|once)\(\s*(['"`])([^'"`]+)\2\s*,\s*/g)) {
            const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 600);
            const factory = Object.keys(GUARD_FACTORIES).find(name => rest.startsWith(`${name}(`)) ?? null;
            found.push({
                file,
                line: lineOf(text, match.index),
                channel: match[3],
                kind: match[1],
                guarded: factory !== null || GUARD_FIRST_STATEMENT.test(rest),
                factory,
                isTrusted: factory ? (/isTrusted:\s*([\w.]+)/.exec(rest)?.[1] ?? null) : null,
            });
        }
    }
    return found;
}

/**
 * preload 调用的通道。
 * @returns {{ line: number, channel: string, kind: string }[]}
 */
export function scanPreloadChannels(root) {
    const text = fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8');
    return [...text.matchAll(/ipcRenderer\.(invoke|send|sendSync|on|once|removeListener|removeAllListeners)\(\s*(['"`])([^'"`]+)\2/g)]
        .map(match => ({ line: lineOf(text, match.index), channel: match[3], kind: match[1] }));
}
