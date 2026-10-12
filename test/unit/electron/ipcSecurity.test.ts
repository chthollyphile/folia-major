import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/ipcSecurity.test.ts
//
// Behavioural contract for the two ways a main-process handler can hand more authority than the
// renderer was given:
//
//   - a channel that forwards a caller-supplied URL to shell.openExternal, where anything other
//     than http(s) becomes an OS protocol launch (file://, ms-settings:, or whatever the machine
//     has registered);
//   - a channel that answers, or drives an embedded API, without checking who asked.
//
// The first version of this file asserted source text and was not a real check: deleting the whole
// protocol-guard branch left every assertion green (caught in review). So the logic now lives in two
// modules that load without booting Electron — electron/externalUrlPolicy.cjs and
// electron/ipcAccessGuard.cjs — and these tests call that production code and assert that the
// rejected input never reaches the action (shell.openExternal / the bridge handler).
//
// main.cjs itself still cannot be imported: requiring it boots the whole app (windows, tray,
// embedded backends), which is how the other electron tests treat it too (linuxDesktopIntegration
// et al.). The last block therefore asserts only the wiring, and says so.

const rootDir = path.resolve(__dirname, '../../../');
const require = createRequire(import.meta.url);
const { resolveExternalUrl, createExternalUrlOpener } = require(
    path.join(rootDir, 'electron/externalUrlPolicy.cjs'),
);
const { createSenderGuardedHandler } = require(path.join(rootDir, 'electron/ipcAccessGuard.cjs'));

describe('resolveExternalUrl', () => {
    it('accepts http(s) and returns the parsed, normalised form', () => {
        expect(resolveExternalUrl('https://github.com/chthollyphile/folia-major/issues/1'))
            .toBe('https://github.com/chthollyphile/folia-major/issues/1');
        expect(resolveExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
        // 首尾空白先去掉再解析
        expect(resolveExternalUrl('  https://example.com/x  ')).toBe('https://example.com/x');
        // scheme 大小写不敏感（URL 会规范化成小写）
        expect(resolveExternalUrl('HTTPS://Example.com/Path')).toBe('https://example.com/Path');
    });

    it('rejects every scheme that would become an OS protocol launch', () => {
        for (const url of [
            'file:///C:/Windows/System32/calc.exe',
            'file:///etc/passwd',
            'ms-settings:windowsupdate',
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'vbscript:msgbox(1)',
            'shell:startup',
            'custom-app://do-something',
        ]) {
            expect(resolveExternalUrl(url), url).toBeNull();
        }
    });

    it('rejects anything unparseable or not a non-empty string', () => {
        for (const value of ['', '   ', 'not a url', 'github.com/x', null, undefined, 42, {}, []]) {
            expect(resolveExternalUrl(value as never)).toBeNull();
        }
    });
});

describe('createExternalUrlOpener', () => {
    it('http(s): hands the normalised URL to the opener', async () => {
        const openExternal = vi.fn(async () => undefined);
        const onBlocked = vi.fn();
        const openExternalUrl = createExternalUrlOpener({ openExternal, onBlocked });

        await expect(openExternalUrl('  https://example.com/x  ')).resolves.toBe(true);

        expect(openExternal).toHaveBeenCalledTimes(1);
        expect(openExternal).toHaveBeenCalledWith('https://example.com/x');
        expect(onBlocked).not.toHaveBeenCalled();
    });

    it('non-http(s): never calls the opener, resolves false, reports the block', async () => {
        const openExternal = vi.fn(async () => undefined);
        const onBlocked = vi.fn();
        const openExternalUrl = createExternalUrlOpener({ openExternal, onBlocked });

        for (const url of [
            'file:///C:/Windows/System32/calc.exe',
            'ms-settings:windowsupdate',
            'javascript:alert(1)',
        ]) {
            await expect(openExternalUrl(url), url).resolves.toBe(false);
        }

        // 这一条是评审要的行为证据：拦截分支一旦被删，openExternal 就会被调用，测试立刻红。
        expect(openExternal).not.toHaveBeenCalled();
        expect(onBlocked).toHaveBeenCalledTimes(3);
    });

    it('lets an opener failure propagate instead of swallowing it as false', async () => {
        const openExternal = vi.fn(async () => {
            throw new Error('no handler');
        });
        const openExternalUrl = createExternalUrlOpener({ openExternal });

        await expect(openExternalUrl('https://example.com')).rejects.toThrow('no handler');
    });
});

describe('createSenderGuardedHandler', () => {
    const makeEvent = (id = 1) => ({ sender: { id } });

    it('trusted sender: runs the handler, passes args through, returns its value', () => {
        const handler = vi.fn((_event: unknown, operation: string, params: unknown) => ({
            operation,
            params,
        }));
        const guarded = createSenderGuardedHandler({
            channel: 'kugou-api-request',
            isTrusted: (event: { sender: { id: number } }) => event.sender.id === 1,
            handler,
        });

        expect(guarded(makeEvent(1), 'song_url', { mid: 'm1' })).toEqual({
            operation: 'song_url',
            params: { mid: 'm1' },
        });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('untrusted sender with onUntrusted: never runs the handler, answers the restricted value', () => {
        const handler = vi.fn(() => 'should not run');
        const guarded = createSenderGuardedHandler({
            channel: 'kugou-api-status',
            isTrusted: () => false,
            onUntrusted: () => null,
            handler,
        });

        expect(guarded(makeEvent(2))).toBeNull();
        expect(handler).not.toHaveBeenCalled();
    });

    it('untrusted sender without onUntrusted: throws, and never runs the handler', () => {
        const handler = vi.fn(() => 'should not run');
        const guarded = createSenderGuardedHandler({
            channel: 'kugou-api-request',
            isTrusted: () => false,
            handler,
        });

        expect(() => guarded(makeEvent(2))).toThrow(/kugou-api-request/);
        expect(handler).not.toHaveBeenCalled();
    });

    it('matches ipcMain.handle calling convention: the event is the first argument', () => {
        const guarded = createSenderGuardedHandler({
            channel: 'obs-browser-source-get-status',
            isTrusted: (event: { sender: { id: number } }) => event.sender.id === 7,
            handler: () => ({ token: 'opaque' }),
        });

        expect(guarded(makeEvent(7))).toEqual({ token: 'opaque' });
        expect(() => guarded(makeEvent(8))).toThrow(/Untrusted renderer/);
    });
});

describe('main.cjs wiring', () => {
    const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

    it('routes both checks through the extractable modules', () => {
        // 只断言接线：行为归上面的测试。之所以留着，是因为校验逻辑一旦被内联回 main.cjs，
        // 那两条行为测试就会失去对产品路径的覆盖，这条会先红。
        expect(mainCjs).toContain("require('./externalUrlPolicy.cjs')");
        expect(mainCjs).toContain("require('./ipcAccessGuard.cjs')");
        expect(mainCjs).toContain('createExternalUrlOpener({');

        for (const channel of ['obs-browser-source-get-status', 'kugou-api-status', 'kugou-api-request']) {
            const site = mainCjs.match(new RegExp(`ipcMain\\.handle\\('${channel}'[\\s\\S]{0,400}`));
            expect(site, `no handler site for ${channel}`).not.toBeNull();
            expect(site?.[0], channel).toContain('createSenderGuardedHandler({');
        }
    });
});
