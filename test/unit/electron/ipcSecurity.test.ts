import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
const { createApprovedMpvPathStore, isReservedHifiSettingKey, LEGACY_MANUAL_PATH_SETTING_KEY } = require(
    path.join(rootDir, 'electron/hifi/approvedMpvPath.cjs'),
) as {
    createApprovedMpvPathStore: (options: { getUserDataPath: () => string }) => {
        get: () => string | null;
        set: (value: string | null) => void;
        filePath: () => string;
    };
    isReservedHifiSettingKey: (key: unknown) => boolean;
    LEGACY_MANUAL_PATH_SETTING_KEY: string;
};
const { registerHifiIpc } = require(path.join(rootDir, 'electron/hifi/hifiIpc.cjs')) as {
    registerHifiIpc: (options: Record<string, unknown>) => unknown;
};

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

// The approved manual mpv path is the one value that lets main run a program of the renderer's
// choosing, so it must not be writable through the generic save-settings channel. save-settings
// writes key/value pairs into the shared electron-store (config.json in userData); the approval
// lives in a file of its own next to it. These tests write that config.json the way save-settings
// would and run the real hifiIpc over the real approval store.
describe('HiFi: the approved manual mpv path is out of save-settings\' reach', () => {
    const userDataDirs: string[] = [];
    afterEach(() => {
        for (const dir of userDataDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    const makeUserData = () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'folia-hifi-approval-'));
        userDataDirs.push(dir);
        return dir;
    };

    // What save-settings(key, value) does to the shared store, were the key let through.
    const writeSharedSetting = (userData: string, key: string, value: unknown) => {
        const file = path.join(userData, 'config.json');
        const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
        writeFileSync(file, JSON.stringify({ ...current, [key]: value }));
    };

    // main's start: the approval store over userData, and hifiIpc reading it at registration.
    const startMain = (userData: string) => {
        const approved = createApprovedMpvPathStore({ getUserDataPath: () => userData });
        const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
        const detect = vi.fn(async ({ manualPath }: { manualPath: string | null }) => ({
            available: true, source: manualPath ? 'manual' : 'path', path: manualPath ?? '/usr/bin/mpv', version: '0.41.0',
        }));
        registerHifiIpc({
            ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
            isTrustedSender: () => true,
            session: { configure: vi.fn(async () => {}) },
            runtime: { detect, getCachedStatus: () => null },
            installer: {},
            dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/opt/mpv/bin/mpv'] })) },
            getMainWindow: () => null,
            webContentsFromId: () => null,
            getApprovedMpvPath: () => approved.get(),
            setApprovedMpvPath: (value: string | null) => approved.set(value),
            platform: 'linux',
            logInfo: () => {},
            logWarn: () => {},
        });
        const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({ sender: { id: 1 } }, ...args);
        return { approved, detect, invoke };
    };

    it('save-settings(\'hifi_mpv_manual_path\', …) neither approves a path nor gets it probed', async () => {
        expect(LEGACY_MANUAL_PATH_SETTING_KEY).toBe('hifi_mpv_manual_path');
        // The handler refuses the key before it reaches the store.
        expect(isReservedHifiSettingKey('hifi_mpv_manual_path')).toBe(true);
        expect(isReservedHifiSettingKey('hifi_mpv_manual_path_x')).toBe(false);

        // Even a value already in the shared store (written before the refusal existed) is not read.
        const userData = makeUserData();
        writeSharedSetting(userData, 'hifi_mpv_manual_path', '/tmp/evil');
        const main = startMain(userData);
        expect(main.approved.get()).toBeNull();
        await main.invoke('hifi:get-runtime-status');
        expect(main.detect).toHaveBeenCalledWith({ manualPath: null });
        expect(main.detect.mock.calls.every(([options]) => options.manualPath === null)).toBe(true);
    });

    it('only the file dialog approves; the approval survives a restart and a save-settings write cannot change it', async () => {
        const userData = makeUserData();
        const first = startMain(userData);
        await expect(first.invoke('hifi:pick-runtime-path')).resolves.toBe('/opt/mpv/bin/mpv');
        expect(first.approved.filePath()).toBe(path.join(userData, 'hifi-runtime', 'approved-mpv-path.json'));

        writeSharedSetting(userData, 'hifi_mpv_manual_path', '/tmp/evil');
        const restarted = startMain(userData);
        expect(restarted.approved.get()).toBe('/opt/mpv/bin/mpv');
        await restarted.invoke('hifi:get-runtime-status');
        expect(restarted.detect).toHaveBeenLastCalledWith({ manualPath: '/opt/mpv/bin/mpv' });

        // Clearing it through configure removes the file.
        await restarted.invoke('hifi:configure', {
            mpvPath: null, audioDevice: 'auto', exclusive: false, dsdMode: 'pcm', softwareVolume: false, volume: 100, muted: false,
        });
        expect(restarted.approved.get()).toBeNull();
        expect(existsSync(restarted.approved.filePath())).toBe(false);
    });

    it('a broken approval file counts as no approval', async () => {
        const userData = makeUserData();
        const main = startMain(userData);
        await main.invoke('hifi:pick-runtime-path');
        writeFileSync(main.approved.filePath(), '{"path": "/opt/mp');
        const restarted = startMain(userData);
        await restarted.invoke('hifi:get-runtime-status');
        expect(restarted.detect).toHaveBeenLastCalledWith({ manualPath: null });
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

    it('registers the HiFi channels with the main-window check', () => {
        // 通道逐个的守卫和校验由 hifiIpc.test.ts 对产品代码测；这里只钉 main.cjs 交进去的是主窗口的判定。
        const hifiIpc = readFileSync(path.join(rootDir, 'electron/hifi/hifiIpc.cjs'), 'utf8');
        expect(mainCjs).toContain("require('./hifi/hifiIpc.cjs')");
        const site = mainCjs.match(/registerHifiIpc\(\{[\s\S]{0,400}/);
        expect(site, 'no registerHifiIpc call').not.toBeNull();
        expect(site?.[0]).toContain('isTrustedSender: event => isTrustedMainWindowContents(event.sender)');
        expect(hifiIpc).toContain("require('../ipcAccessGuard.cjs')");
        expect(hifiIpc).toContain('createSenderGuardedHandler({');
    });

    it('keeps the approved manual mpv path in a file of main\'s own, which save-settings refuses to write', () => {
        // 渲染端经 configure 只能选用或清掉主进程从文件框拿到的路径；批准不在 save-settings 写的共享 electron-store 里。
        // 行为由上面那组测试对产品代码测；这里只钉 main.cjs 交进去的是那个单独的文件，save-settings 拒写旧键。
        expect(mainCjs).toContain("require('./hifi/approvedMpvPath.cjs')");
        expect(mainCjs).toContain('const hifiApprovedMpvPath = createApprovedMpvPathStore({ getUserDataPath: getHifiUserDataPath });');
        const site = mainCjs.match(/registerHifiIpc\(\{[\s\S]{0,900}?\}\);/);
        expect(site, 'no registerHifiIpc call').not.toBeNull();
        expect(site?.[0]).toContain('getApprovedMpvPath: () => hifiApprovedMpvPath.get()');
        expect(site?.[0]).toContain('setApprovedMpvPath: value => hifiApprovedMpvPath.set(value)');
        expect(site?.[0]).not.toMatch(/\bstore\.(get|set|delete)\(/);

        const saveSettings = mainCjs.match(/ipcMain\.handle\('save-settings'[\s\S]*?store\.set\(key, nextValue\);/)?.[0] ?? '';
        expect(saveSettings, 'no save-settings handler').not.toBe('');
        expect(saveSettings).toMatch(/\|\| isReservedHifiSettingKey\(key\)\) \{\n\s*return getPublicSettings\(\);/);
    });
});
