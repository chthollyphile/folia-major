import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, IPC_DYNAMIC_PREFIXES } from '../../../../dev/dedicatus/ipcChannels.mjs';
import { GUARD_FACTORIES, scanMainChannels, scanPreloadChannels } from '../../../../dev/dedicatus/ipc/scanIpc.mjs';

// test/unit/dedicatus/contracts/ipc.test.ts
// D605：主进程每个 IPC 通道都登记了信任级别（dev/dedicatus/ipcChannels.mjs）；只给第一方窗口的通道必须真的校验来源；
// 平台请求通道不能任意窗口都调；交给守卫工厂的判断函数收的东西要对（#874：把收 webContents 的函数当成收 event 的
// isTrusted，判断恒为 false）；守卫工厂本身还在校验。
// D606：preload 调的通道主进程都注册了（invoke ↔ handle、send ↔ on），否则运行时报 No handler。

const ROOT = path.resolve(__dirname, '../../../..');
const main = scanMainChannels(ROOT);
const preload = scanPreloadChannels(ROOT);
const isDynamic = (channel: string) => Object.keys(IPC_DYNAMIC_PREFIXES).some(prefix => channel.startsWith(prefix));

/** 收 webContents（不是 event）的判断函数。 */
const TAKES_WEB_CONTENTS = ['isTrustedMainWindowContents', 'isTrustedRemoteControlContents', 'isTrustedMainWindowRequest'];
/** 名字以 -request 结尾、但不是平台请求的通道。 */
const NOT_PLATFORM_REQUESTS: Record<string, string> = { 'transcode-fallback-request': '本地转码的回退，不连平台' };

describe('D605 IPC channels and who may call them', () => {
    it('finds the channels it guards, so the scan still matches something', () => {
        expect(main.length).toBeGreaterThan(100);
        expect(main.some(entry => entry.channel === 'kugou-api-request' && entry.guarded)).toBe(true);
        for (const name of Object.keys(GUARD_FACTORIES)) {
            expect(main.some(entry => entry.factory === name), `${name} 还在用，扫描认得出它`).toBe(true);
        }
    });

    it('registers every channel the main process handles, and only those', () => {
        const handled = new Set(main.map(entry => entry.channel));
        expect(main.filter(entry => !Object.hasOwn(IPC_CHANNELS, entry.channel)).map(entry => `${entry.file}:${entry.line} ${entry.channel}`), 'D605：新通道先在 dev/dedicatus/ipcChannels.mjs 登记信任级别').toEqual([]);
        expect(Object.keys(IPC_CHANNELS).filter(channel => !handled.has(channel)), 'D605：登记表里有已经不存在的通道').toEqual([]);
    });

    it('checks the sender of every first-party channel', () => {
        const unguarded = main.filter(entry => Object.hasOwn(IPC_CHANNELS, entry.channel) && IPC_CHANNELS[entry.channel].level === 'first-party' && !entry.guarded);
        expect(unguarded.map(entry => `${entry.file}:${entry.line} ${entry.channel}`), 'D605：第一方通道要经登记的守卫工厂（GUARD_FACTORIES），或第一条语句就校验 event.sender').toEqual([]);
    });

    it('keeps the guard factories checking the sender', () => {
        const broken = Object.entries(GUARD_FACTORIES)
            .filter(([, factory]) => !factory.check.test(readFileSync(path.join(ROOT, factory.file), 'utf8')))
            .map(([name, factory]) => `${factory.file} ${name}`);
        expect(broken, 'D605：守卫工厂不再校验来源了；改了写法就同步 scanIpc.mjs 的 GUARD_FACTORIES').toEqual([]);
    });

    it('lets no window but a first-party one send platform requests', () => {
        const open = Object.entries(IPC_CHANNELS)
            .filter(([channel, entry]) => /-request$/.test(channel) && !Object.hasOwn(NOT_PLATFORM_REQUESTS, channel) && entry.level === 'any');
        expect(open.map(([channel]) => channel), 'D605：平台请求通道不能是 any').toEqual([]);
    });

    it('passes each guard factory a check that takes what the factory hands it', () => {
        const wrong = main.filter(entry => {
            if (!entry.factory || !entry.isTrusted) return false;
            const takesWebContents = TAKES_WEB_CONTENTS.includes(entry.isTrusted);
            return GUARD_FACTORIES[entry.factory].trustedTakes === 'event' ? takesWebContents : !takesWebContents;
        });
        expect(wrong.map(entry => `${entry.file}:${entry.line} ${entry.factory} ← ${entry.isTrusted}`), 'D605：isTrusted 收的东西和工厂交给它的不一致（#874）').toEqual([]);
    });
});

describe('D606 preload and the main process agree on the channels', () => {
    it('reads what preload calls, so the scan still matches something', () => {
        expect(preload.filter(entry => entry.kind === 'invoke').length).toBeGreaterThan(50);
        expect(preload.some(entry => entry.kind === 'send')).toBe(true);
        expect(preload.some(entry => entry.channel === 'kugou-api-request')).toBe(true);
    });

    it('handles every channel preload invokes or sends', () => {
        const handles = new Set(main.filter(entry => entry.kind.startsWith('handle')).map(entry => entry.channel));
        const listens = new Set(main.filter(entry => entry.kind === 'on' || entry.kind === 'once').map(entry => entry.channel));
        const missing = preload
            .filter(entry => !isDynamic(entry.channel))
            .filter(entry => (entry.kind === 'invoke' && !handles.has(entry.channel)) || (entry.kind === 'send' && !listens.has(entry.channel)))
            .map(entry => `electron/preload.cjs:${entry.line} ${entry.kind} ${entry.channel}`);
        expect(missing, 'D606：preload 调的通道主进程没有注册，运行时会报 No handler').toEqual([]);
    });
});
