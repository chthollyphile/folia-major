// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { OnlineFailure } from '@/services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';

// test/unit/playback/externalPlayerConsent.test.ts
// 本机播放器那三种失败在界面上怎么走：用户还没同意重开他自己那个播放器时问一次；找不到客户端或
// 客户端里的播放器时说明原因，并给「改回标准播放」。问与撤销都只经 preload 的那一个通道。

const rootDir = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const shown = (playerCause: string): OnlineFailure => onlineFailureOf(
    { operation: 'audio', providerId: 'spotify' },
    { detail: { case: 'not-configured', playerCause: playerCause as never } },
);

beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
});

describe('what a player cause asks the listener to do', () => {
    it('asks before closing and reopening their player, and nothing else does', async () => {
        const { playerCauseAction } = await import('@/services/onlineMusic/failure/externalPlayerConsent');
        expect(playerCauseAction(shown('player-restart-consent'))).toBe('restart-consent');
        expect(playerCauseAction(shown('player-not-installed'))).toBe('change-way');
        expect(playerCauseAction(shown('player-not-found'))).toBe('change-way');
        // A failure that names no player cause is none of these.
        expect(playerCauseAction(onlineFailureOf({ operation: 'audio' }, { detail: { case: 'no-audio' } }))).toBeNull();
    });

    it('names what went wrong in the player, not in the song', async () => {
        const { playerCauseTextKeys } = await import('@/services/onlineMusic/failure/externalPlayerConsent');
        expect(playerCauseTextKeys('player-not-installed')).toEqual({
            title: 'failure.externalPlayerNotInstalled',
            note: 'failure.noteExternalPlayerNotInstalled',
        });
        expect(playerCauseTextKeys('player-not-found')).toEqual({
            title: 'failure.externalPlayerNotFound',
            note: 'failure.noteExternalPlayerNotFound',
        });
        expect(playerCauseTextKeys('player-restart-consent')).toBeNull();
    });
});

describe('the agreement itself', () => {
    const load = async (consent: (grant?: boolean) => Promise<boolean>) => {
        Object.defineProperty(window, 'electron', {
            value: { platform: 'win32', externalPlayerRestartConsent: consent },
            configurable: true,
            writable: true,
        });
        vi.resetModules();
        return import('@/services/onlineMusic/failure/externalPlayerConsent');
    };

    it('reads the listener\'s answer, grants it, and takes it back', async () => {
        const consent = vi.fn(async (grant?: boolean) => grant === true);
        const module = await load(consent);

        await module.readExternalPlayerRestartConsent();
        expect(consent).toHaveBeenLastCalledWith();
        expect(await module.grantExternalPlayerRestartConsent()).toBe(true);
        expect(consent).toHaveBeenLastCalledWith(true);
        await module.revokeExternalPlayerRestartConsent();
        // Taking it back writes a no, which is what clears it: the main process keeps only a yes.
        expect(consent).toHaveBeenLastCalledWith(false);
    });

    it('answers no on a page that has no desktop app behind it', async () => {
        Object.defineProperty(window, 'electron', { value: undefined, configurable: true, writable: true });
        vi.resetModules();
        const module = await import('@/services/onlineMusic/failure/externalPlayerConsent');
        // 问不到就是问不到：不问作答，也不把「问不到」说成「没同意过」。设置里那一行据此不画成关。
        expect(await module.readExternalPlayerRestartConsent()).toBeNull();
        expect(await module.grantExternalPlayerRestartConsent()).toBe(false);
        expect(await module.revokeExternalPlayerRestartConsent()).toBeNull();
    });

    it('answers what the main process keeps after taking a yes back, not what was asked for', async () => {
        // 设置里那一行画的是「主进程现在记着什么」，不是「刚才按了什么」。主进程没能删掉那次同意
        // 时它仍然是同意着的，撤销要把这个事实答回来，否则开关画成关而 Folia 之后照样不问你。
        const module = await load(async (grant?: boolean) => (grant === false ? true : true));
        expect(await module.revokeExternalPlayerRestartConsent()).toBe(true);

        const revoked = await load(async (grant?: boolean) => grant === true);
        expect(await revoked.revokeExternalPlayerRestartConsent()).toBe(false);
    });

    it('says nothing was confirmed when the answer never came', async () => {
        // 通道抛了（例如窗口不是设置里那一行信任的那个）：撤销没有发生，不能答成「已经不是同意着了」。
        const module = await load(async () => { throw new Error('Untrusted renderer'); });
        expect(await module.revokeExternalPlayerRestartConsent()).toBeNull();
        expect(await module.readExternalPlayerRestartConsent()).toBeNull();
    });

    it('keeps only a yes, and a no clears what was kept', () => {
        // main.cjs 不能导入（require 它会启动应用），所以它交给模块的东西钉在这里。
        const { registerRestartConsentIpc } = require(path.join(rootDir, 'electron/restartConsent.cjs'));
        const values = new Map<string, unknown>();
        const store = {
            get: (key: string) => values.get(key),
            set: (key: string, value: unknown) => { values.set(key, value); },
            delete: (key: string) => { values.delete(key); },
        };
        let handler: ((event: unknown, granted?: unknown) => unknown) | null = null;
        registerRestartConsentIpc({ ipcMain: { handle: (_channel: string, answer: typeof handler) => { handler = answer; } }, isTrustedSender: () => true, store });

        expect(handler!({}, true)).toBe(true);
        expect(values.get('externalPlayerRestartConsented')).toBe(true);
        // 撤销：写 false 清掉那一次同意；不带参数的调用只问，什么都不改。
        expect(handler!({}, false)).toBe(false);
        expect(values.has('externalPlayerRestartConsented')).toBe(false);
        expect(handler!({}, true)).toBe(true);
        expect(handler!({}, undefined)).toBe(true);
        expect(values.has('externalPlayerRestartConsented')).toBe(true);
    });
});

describe('the way back to the standard way', () => {
    it('is asked of the provider, so the words of it name no platform', async () => {
        const leave = vi.fn(async () => undefined);
        vi.doMock('@/services/onlineMusic/omni', () => ({
            omni: { leaveExternalPlaybackForStandard: leave },
        }));
        vi.resetModules();
        const { changeExternalPlaybackWay } = await import('@/services/onlineMusic/failure/externalPlayerConsent');
        await changeExternalPlaybackWay({ providerId: 'spotify' } as OnlineFailure);
        expect(leave).toHaveBeenCalledWith('spotify');
        vi.doUnmock('@/services/onlineMusic/omni');
    });
});
