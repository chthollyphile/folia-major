import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFoliumApi, experimentalLines } from '../../../dev/dedicatus/checks/foliumApi.mjs';
import { checkForeignCredentials } from '../../../dev/dedicatus/checks/foreignCredentials.mjs';
import { startupClosure } from '../../../dev/dedicatus/checks/startupWeight.mjs';
import { PLAYBACK_TOKENS } from '../../../dev/dedicatus/playbackTokens.mjs';
import { checkModIntegration } from '../../../dev/dedicatus/checks/modIntegration.mjs';
import { parseDiff } from '../../../dev/dedicatus/diff.mjs';
import plugin from '../../../dev/dedicatus/eslint/plugin.mjs';
import { REGISTERED_SITES } from '../../../dev/dedicatus/registeredSites.mjs';
import { RESTRICTED_APIS } from '../../../dev/dedicatus/restrictedApis.mjs';
import { WINDOW_REBUILD } from '../../../dev/dedicatus/windowRebuild.mjs';
import { edgeKey } from '../../../dev/mcp/ts-code-map/graph/modules.mjs';

// test/unit/dedicatus/projectRules.test.ts
// 从 issue / PR / 文档里整理出的 Dedicatus 项目规则（plan 里的候选清单）：
// 模组接入点（D307）、读取别的应用的凭据（D611），以及登记表驱动的限制写法（restricted-apis：D445、D508、D607、D608、D609）。
// ESLint 规则用 RuleTester 跑，需要隔离的 lint 环境（npm run lint:install），没装时跳过。

const ROOT = path.resolve(__dirname, '../../..');
const inRepo = (file: string) => path.join(ROOT, file);

describe('D307 mod integration points', () => {
    const graph = (edges: [string, string, boolean?][]) => {
        const forward = new Map<string, Set<string>>();
        const typeOnly = new Set<string>();
        for (const [from, to, typeOnlyEdge] of edges) {
            if (!forward.has(from)) forward.set(from, new Set());
            forward.get(from)?.add(to);
            if (typeOnlyEdge) typeOnly.add(edgeKey(from, to));
        }
        return { forward, typeOnly };
    };

    it('reports app code reaching into src/mods unless it is a registered integration point', () => {
        const findings = checkModIntegration(graph([
            ['src/components/New.tsx', 'src/mods/runtime/x.ts'],
            ['src/components/Typed.tsx', 'src/mods/folium/contract.ts', true],
            ['src/App.tsx', 'src/mods/runtime/x.ts'],
            ['src/mods/folium/api.ts', 'src/mods/runtime/x.ts'],
            ['test/unit/x.test.ts', 'src/mods/runtime/x.ts'],
        ]), ['src/App.tsx']);
        expect(findings.map(finding => finding.key)).toEqual(['D307:src/components/New.tsx->src/mods/runtime/x.ts']);
    });
});

describe('D611 reading another app\'s credentials', () => {
    it('reports added lines that decrypt or read another app\'s stored secrets', () => {
        const files = parseDiff([
            'diff --git a/electron/x.cjs b/electron/x.cjs',
            '--- a/electron/x.cjs',
            '+++ b/electron/x.cjs',
            '@@ -0,0 +1,4 @@',
            "+const state = fs.readFileSync(path.join(home, 'Local State'));",
            '+const key = JSON.parse(state).os_crypt.encrypted_key;',
            '+const plain = safeStorage.decryptString(buffer);',
            "+run('[System.Security.Cryptography.ProtectedData]::Unprotect($bytes)');",
            'diff --git a/test/unit/x.test.ts b/test/unit/x.test.ts',
            '--- a/test/unit/x.test.ts',
            '+++ b/test/unit/x.test.ts',
            '@@ -0,0 +1 @@',
            "+const fixture = 'Local State';",
        ].join('\n'));
        expect(checkForeignCredentials(files).map(finding => finding.line)).toEqual([1, 2, 4]);
    });
});

describe('D513 Folium stable interface', () => {
    const types = [
        '// ---------------------------------------------------------------- Services',
        'export interface FoliumPlayback {',
        '    play(): void;',
        '    /** EXPERIMENTAL (`player.layout`): the layout. */',
        '    layout(): void;',
        '}',
        '// ---------------------------------------------------------------- Experimental',
        'export interface FoliumLayoutRect { x: number }',
    ].join('\n');

    it('tells experimental lines from stable ones', () => {
        const flags = experimentalLines(types);
        expect([3, 5, 8].map(line => flags[line])).toEqual([false, true, true]);
    });

    it('keeps the members of an experimental declaration experimental, and finds lower-case experimental members', () => {
        const text = readFileSync(path.join(ROOT, 'mods/folium.d.ts'), 'utf8');
        const lines = text.split('\n');
        const flags = experimentalLines(text);
        const after = (anchor: string, needle: string) => {
            const start = lines.findIndex(line => line.includes(anchor));
            expect(start, anchor).toBeGreaterThan(-1);
            const offset = lines.slice(start).findIndex(line => line.includes(needle));
            expect(offset, needle).toBeGreaterThan(-1);
            return flags[start + offset + 1];
        };
        // 带 EXPERIMENTAL 的声明里，各有文档注释的成员
        expect(after('export interface FoliumOmniLyricsEvent', 'lines: readonly FoliumLine[]')).toBe(true);
        expect(after('export interface FoliumOmniAudioEvent', 'url: string | null')).toBe(true);
        // 稳定声明里注释写着小写 experimental 的成员；同一声明里的稳定成员不受影响
        expect(after('export interface FoliumHookEvents', "'omni.lyricsResolved'")).toBe(true);
        expect(after('export interface FoliumHookEvents', "'lyrics.transform'")).toBe(false);
        expect(after('export interface FoliumBeforePlayEvent', 'cancel(): void')).toBe(false);
        // 注释只是提到 experimental 这个词的稳定成员
        expect(after('export interface FoliumEvents', 'on<K extends keyof FoliumEventMap>(')).toBe(false);
    });

    it('reports a changed stable member unless the major version moved, and a new one unless the minor did', () => {
        const files = parseDiff([
            'diff --git a/mods/folium.d.ts b/mods/folium.d.ts',
            '--- a/mods/folium.d.ts',
            '+++ b/mods/folium.d.ts',
            '@@ -3 +3,2 @@',
            '-    play(): void;',
            '+    play(at: number): void;',
            '+    pause(): void;',
        ].join('\n'));
        const after = types.replace('    play(): void;', '    play(at: number): void;\n    pause(): void;');
        const read = (version: string, text: string) => (file: string) => (file === 'mods/folium.d.ts' ? text : `{ "version": ${version} }`);
        const same = checkFoliumApi(files, { readBase: read('{ "major": 1, "minor": 8 }', types), readCurrent: read('{ "major": 1, "minor": 8 }', after) });
        expect(same.map(finding => finding.key)).toEqual(['D513:removed:play(): void;', 'D513:added']);
        const minor = checkFoliumApi(files, { readBase: read('{ "major": 1, "minor": 8 }', types), readCurrent: read('{ "major": 1, "minor": 9 }', after) });
        expect(minor.map(finding => finding.key)).toEqual(['D513:removed:play(): void;']);
        const major = checkFoliumApi(files, { readBase: read('{ "major": 1, "minor": 8 }', types), readCurrent: read('{ "major": 2, "minor": 0 }', after) });
        expect(major).toEqual([]);
    });

    it('lets a minor bump rewrite the version line itself', () => {
        const versionLine = (minor: number) => `export declare const FOLIUM_VERSION: { readonly major: 1; readonly minor: ${minor} };`;
        const files = parseDiff([
            'diff --git a/mods/folium.d.ts b/mods/folium.d.ts',
            '--- a/mods/folium.d.ts',
            '+++ b/mods/folium.d.ts',
            '@@ -1,2 +1,3 @@',
            `-${versionLine(8)}`,
            `+${versionLine(9)}`,
            ' export interface FoliumPlayback {',
            '+    pause(): void;',
        ].join('\n'));
        const before = [versionLine(8), 'export interface FoliumPlayback {', '}'].join('\n');
        const after = [versionLine(9), 'export interface FoliumPlayback {', '    pause(): void;', '}'].join('\n');
        const read = (minor: number, text: string) => (file: string) => (file === 'mods/folium.d.ts' ? text : `{ "version": { "major": 1, "minor": ${minor} } }`);
        expect(checkFoliumApi(files, { readBase: read(8, before), readCurrent: read(9, after) })).toEqual([]);
        // 版本行改了、foliumShared.json 的小版本却没跟上：新增的那一行照报。
        const stale = checkFoliumApi(files, { readBase: read(8, before), readCurrent: read(8, after) });
        expect(stale.map(finding => finding.key)).toEqual(['D513:added']);
    });
});

describe('D306 startup closure', () => {
    it('follows static value imports only', () => {
        const forward = new Map([
            ['src/index.tsx', new Set(['src/a.ts', 'src/lazy.ts', 'src/types.ts'])],
            ['src/bootstrap.tsx', new Set(['src/b.ts'])],
            ['src/a.ts', new Set(['src/c.ts'])],
        ]);
        const graph = {
            forward,
            typeOnly: new Set([edgeKey('src/index.tsx', 'src/types.ts')]),
            dynamic: new Set([edgeKey('src/index.tsx', 'src/lazy.ts')]),
        };
        expect([...startupClosure(graph)].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/bootstrap.tsx', 'src/c.ts', 'src/index.tsx']);
    });
});

type RuleTesterClass = {
    new (config: object): { run: (name: string, rule: unknown, tests: object) => void };
    describe: unknown;
    it: unknown;
    itOnly: unknown;
};
const RUNTIME = path.resolve(__dirname, '../../../dev/dedicatus/lint/package.json');
const hasRuntime = existsSync(path.resolve(__dirname, '../../../dev/dedicatus/lint/node_modules/eslint'));
/**
 * 装了 ESLint 隔离环境才注册这一组。不能用 describe.skipIf：vitest 跳过一组时仍会执行它的回调（为了收集里面的测试），
 * 回调开头解析 eslint 就会抛错。单测任务没装这个环境，这些用例在 CI 的 Lint 任务里跑。
 */
const describeWithLintRuntime = (name: string, body: () => Promise<void>) => {
    if (hasRuntime) describe(name, body);
    else describe.skip(name, () => { it.skip('需要先 npm run lint:install', () => undefined); });
};

describeWithLintRuntime('dedicatus project rules (ESLint)', async () => {
    const eslintEntry = createRequire(RUNTIME).resolve('eslint');
    // eslint 只装在隔离环境里，根目录的 tsc 解析不到它的类型：这里只描述用到的那一点。
    const { RuleTester } = await import(pathToFileURL(eslintEntry).href) as { RuleTester: RuleTesterClass };
    RuleTester.describe = describe;
    RuleTester.it = it;
    RuleTester.itOnly = it.only;
    const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
    const options = [{ entries: RESTRICTED_APIS }];
    const restricted = (code: string, file: string, count = 1) => ({
        code, filename: inRepo(file), options, errors: Array.from({ length: count }, () => ({ messageId: 'restricted' })),
    });

    tester.run('dedicatus/restricted-apis', plugin.rules['restricted-apis'], {
        valid: [
            // 例外：统一入口本身、#594 的明文例外、组件（由 D411 管）
            { code: 'const ok = safeStorage.isEncryptionAvailable();', filename: inRepo('electron/osEncryption.cjs'), options },
            { code: 'const ok = safeStorage.isEncryptionAvailable();', filename: inRepo('electron/aiCredentialStore.cjs'), options },
            { code: "localStorage.setItem('k', 'v');", filename: inRepo('src/stores/storagePrimitives.ts'), options },
            { code: "localStorage.setItem('k', 'v');", filename: inRepo('src/components/x/Panel.tsx'), options },
            { code: "const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });", filename: inRepo('src/utils/lyrics/icuFolia/segmenter.ts'), options },
            { code: "const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });", filename: inRepo('src/utils/lyrics/x.ts'), options },
            { code: "window.open(url, '_blank');", filename: inRepo('src/utils/system/outsideLink.ts'), options },
            { code: 'const store = { localStorage: 1 }; store.localStorage = 2;', filename: inRepo('src/services/x.ts'), options },
        ],
        invalid: [
            restricted("localStorage.getItem('k'); window.sessionStorage.clear();", 'src/services/x.ts', 2),
            restricted('const value = ipcRenderer.sendSync(channel);', 'electron/preload.cjs'),
            restricted('event.returnValue = state;', 'electron/main.cjs'),
            restricted('const ok = safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 1;', 'electron/spotify/session.cjs', 2),
            restricted('await shell.openExternal(url);', 'electron/main.cjs'),
            restricted('window.open(url); window.electron?.openExternalUrl(url);', 'src/components/x/Link.tsx', 2),
            restricted("const words = new Segmenter(undefined, { granularity: 'word' });", 'src/utils/lyrics/x.ts'),
        ],
    });

    const sitesOptions = [{ entries: REGISTERED_SITES }];
    const unregistered = (code: string, file: string, count = 1) => ({
        code, filename: inRepo(file), options: sitesOptions, errors: Array.from({ length: count }, () => ({ messageId: 'unregistered' })),
    });
    tester.run('dedicatus/registered-sites', plugin.rules['registered-sites'], {
        valid: [
            // D121：登记过的函数依据平台记录给出下架；比较、类型表不算“给出”
            { code: "export const resolveNeteaseSongAvailability = (song) => ({ state: 'unavailable', reason: 'taken-down' });", filename: inRepo('src/services/onlineMusic/netease/netease.ts'), options: sitesOptions },
            { code: "if (shown.case === 'taken-down') present(shown);", filename: inRepo('src/services/onlineMusic/qq/qqProvider.ts'), options: sitesOptions },
            // 查询也是读
            { code: "const down = reasons.includes('taken-down') || DOWN.has('taken-down') || isFailureCase(failure, 'taken-down'); const text = TEXTS['taken-down'];", filename: inRepo('src/components/x/Thing.tsx'), options: sitesOptions },
            // D442：DEV 守卫里的调试挂件
            { code: 'if (import.meta.env.DEV) window.__debug = state;', filename: inRepo('src/services/x.ts'), options: sitesOptions },
            { code: 'window.__debug = state;', filename: inRepo('src/dev/probe.ts'), options: sitesOptions },
        ],
        invalid: [
            // #619 之前的写法：网络失败也说成下架
            unregistered("const classify = (error) => ({ code: error.offline ? 'taken-down' : 'network' });", 'src/services/onlineMusic/kugou/kugouProvider.ts'),
            // 同一函数同一行 state 和 reason 两个选择器都命中，只报一次（#891 演习）
            unregistered("const availability = () => ({ state: 'unavailable', reason: 'taken-down' });", 'src/services/onlineMusic/kugou/kugouProvider.ts'),
            // 箭头函数直接返回、先存进变量、成员赋值
            unregistered("const classify = (offline) => offline ? 'taken-down' : 'network';\nconst reason = cut ? 'taken-down' : 'auth';\nfailure.case = 'taken-down';", 'src/services/onlineMusic/kugou/kugouProvider.ts', 3),
            // 登记的是 playSong：同一个 hook 里别的 useCallback 不放行
            unregistered("function usePlaybackQueueController() { const playSong = useCallback(async () => present({ case: 'taken-down' }), []); const skip = useCallback(() => present({ case: 'taken-down' }), []); }", 'src/components/app/playback/start/usePlaybackQueueController.ts'),
            // #874 的写法：读了一部分就说读完了
            unregistered('async function getUserPlaylists() { return { playlists, whole: true }; }', 'src/services/onlineMusic/qq/qqProvider.ts'),
            unregistered('window.__iceStats = stats;\nglobalThis.__probe = 1;', 'src/components/visualizer/x.ts', 2),
            // 守卫写反了，或者“开发环境或者某个开关”：正式包里照样会挂
            unregistered('if (!import.meta.env.DEV) { window.__debug = state; }', 'src/services/x.ts'),
            unregistered('if (import.meta.env.DEV || flag) window.__debug = state;', 'src/services/x.ts'),
            unregistered("Object.assign(window, { __debug: state });\nwindow['__probe'] = 1;", 'src/services/x.ts', 2),
        ],
    });

    // TS 写法要用 TS 的解析器：#987 的原代码是 `(window as unknown as {...}).__iceStats = iceStats`
    const { default: tsParser } = await import(pathToFileURL(createRequire(RUNTIME).resolve('@typescript-eslint/parser')).href) as { default: unknown };
    const tsTester = new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' } });
    tester.run('dedicatus/registered-sites (DEV guards)', plugin.rules['registered-sites'], {
        valid: [
            { code: 'function install() { if (!import.meta.env.DEV) return; window.__debug = state; }', filename: inRepo('src/services/x.ts'), options: sitesOptions },
            { code: 'if (!import.meta.env.DEV) {} else { window.__debug = state; }', filename: inRepo('src/services/x.ts'), options: sitesOptions },
            { code: 'import.meta.env.DEV && (window.__debug = state);', filename: inRepo('src/services/x.ts'), options: sitesOptions },
        ],
        invalid: [
            unregistered('function install() { if (!import.meta.env.DEV) log(); window.__debug = state; }', 'src/services/x.ts'),
        ],
    });
    tsTester.run('dedicatus/registered-sites (TS)', plugin.rules['registered-sites'], {
        valid: [
            { code: 'if (import.meta.env.DEV) (window as unknown as { __iceStats: unknown }).__iceStats = iceStats;', filename: inRepo('src/components/visualizer/x.ts'), options: sitesOptions },
        ],
        invalid: [
            unregistered('(window as unknown as { __iceStats: unknown }).__iceStats = iceStats;', 'src/components/visualizer/x.ts'),
            unregistered('(window as any).__folia_probe = currentTime;', 'src/App.tsx'),
        ],
    });

    tester.run('dedicatus/window-rebuild-handoff', plugin.rules['window-rebuild-handoff'], {
        valid: [
            { code: 'async function rebuild() { const handoff = await requestWindowPlaybackHandoff(); recreateMainWindowWithTransparencyMode(true, handoff); }', filename: inRepo('electron/main.cjs'), options: [WINDOW_REBUILD] },
            { code: 'async function setMainWindowTransparentMode(enabled, handoff = null) { recreateMainWindowWithTransparencyMode(enabled, handoff); }', filename: inRepo('electron/main.cjs'), options: [WINDOW_REBUILD] },
            { code: 'recreateMainWindowWithTransparencyMode(true, null);', filename: inRepo('electron/other.cjs'), options: [WINDOW_REBUILD] },
        ],
        invalid: [
            // #1128 之前的写法：主进程自己发起的重建用空快照
            { code: 'async function onDisplayRemoved() { recreateMainWindowWithTransparencyMode(true, null); }', filename: inRepo('electron/main.cjs'), options: [WINDOW_REBUILD], errors: [{ messageId: 'missing' }] },
            { code: 'async function rebuild(snapshot) { recreateMainWindowWithTransparencyMode(true, snapshot); }', filename: inRepo('electron/main.cjs'), options: [WINDOW_REBUILD], errors: [{ messageId: 'missing' }] },
        ],
    });

    const notifierOptions = [{ notifiers: ['setStatusMessage', 'toast', 'setError'] }];
    const raw = (code: string) => ({ code, options: notifierOptions, errors: [{ messageId: 'raw' }] });
    tester.run('dedicatus/error-text-in-ui', plugin.rules['error-text-in-ui'], {
        valid: [
            { code: "try { run(); } catch (error) { console.warn('[A]', error); setStatusMessage({ type: 'error', text: t('errors.loadFailed') }); }", options: notifierOptions },
            { code: 'setStatusMessage(result.message);', options: notifierOptions },
            { code: "try { run(); } catch (error) { const text = t('errors.loadFailed'); setError(text); }", options: notifierOptions },
        ],
        invalid: [
            raw('try { run(); } catch (error) { setStatusMessage(error.message); }'),
            raw('load().catch(e => toast(`失败：${e.message}`));'),
            // 仓库里最常见的形状：传对象；先存进变量；三元；errorMessage() 返回的也是原文
            raw("try { run(); } catch (error) { setStatusMessage({ type: 'error', text: error.message }); }"),
            raw('try { run(); } catch (error) { const text = error.message; setError(text); }'),
            raw("try { run(); } catch (error) { setError(error instanceof Error ? error.message : t('errors.unknown')); }"),
            raw('try { run(); } catch (error) { setError(errorMessage(error)); }'),
            raw('try { run(); } catch (error) { toast(`${error}`); }'),
            raw('try { run(); } catch (error) { setError(error?.message.trim()); }'),
        ],
    });

    const playbackFile = inRepo('src/components/app/playback/start/usePlay.ts');
    const tokenOptions = [PLAYBACK_TOKENS];
    tester.run('dedicatus/stale-after-await', plugin.rules['stale-after-await'], {
        valid: [
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); if (!stillWanted()) return; setAudioSrc(url); }' },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const atStart = wholeQueueWritesSoFar(); const songs = await load(); if (wholeQueueWritesSoFar() !== atStart) return; setPlayQueue(songs); }' },
            // 互斥分支、以 return 结束的分支里的 await 不算在写入之前
            { filename: playbackFile, options: tokenOptions, code: 'async function fail(shown) { const stillWanted = startPlay(); if (shown.down) await presentTakenDown(shown); else presentOnlineFailure(shown); }' },
            { filename: playbackFile, options: tokenOptions, code: 'async function fail(song) { const stillWanted = startPlay(); if (song.down) { await presentTakenDown(song); return; } presentOnlineFailure(song); }' },
            // 没拿令牌的 async 函数不查；别的文件不查
            { filename: playbackFile, options: tokenOptions, code: 'async function refresh() { const songs = await load(); setPlayQueue(songs); }' },
            { filename: inRepo('src/services/x.ts'), options: tokenOptions, code: 'async function play() { const stillWanted = startPlay(); await x(); setPlayQueue([]); }' },
            // 写入函数自己收了令牌；只引用了别的复核写法的小函数也算复核
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); showSong(song, { stillWanted }); }' },
            { filename: playbackFile, options: tokenOptions, code: 'function play(song) { const stillWanted = startPlay(); const overtaken = () => askedSongKeyRef.current !== song.key; void (async () => { const meta = await readMeta(song); if (overtaken()) return; setLyrics(meta.lyrics); })(); }' },
            // hook 里只是声明了令牌 ref，和它无关的 async 闭包、.then 回调不查
            { filename: inRepo('src/components/app/playback/useStagePlaybackController.ts'), options: tokenOptions, code: 'function useStage() { const stageLyricsLoadIdRef = useRef(0); const refresh = useCallback(async () => { const songs = await load(); setPlayQueue(songs); }, []); fetchCover().then(url => setCachedCoverUrl(url)); }' },
            // switch 的判断值也是复核
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); switch (stillWanted()) { case false: return; default: setAudioSrc(url); } }' },
            // 令牌交给了被等待的函数（过期时回空值），之后判了它的结果（#1109 的 adoptRunningTrack）
            { filename: playbackFile, options: tokenOptions, code: 'async function adopt(song, stillWanted) { const track = await resolveRunningTrack(song, () => stillWanted()); if (!track) return false; makeSongCurrent(track); }' },
            // #1109 的真实写法：交的是只引用了 askedSongKeyRef 的复核函数；令牌放在对象里交；写入在 if (结果) 的成立分支里
            { filename: playbackFile, options: tokenOptions, code: 'function restore(song) { const stillWanted = startRestore(); const overtaken = () => askedSongKeyRef.current !== song.key; const adopt = async () => { const track = await resolveRunningTrack(song, () => !overtaken()); if (!track) return false; makeSongCurrent(track); }; }' },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song, stillWanted) { const url = await resolveUrl(song, { isCurrent: stillWanted }); if (url) setAudioSrc(url); }' },
        ],
        invalid: [
            // #796 / #1016 那类：等待之后不问令牌就写
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); setAudioSrc(url); }', errors: [{ messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'async function restore(stillWanted) { const queue = await readQueue(); if (!stillWanted()) return; const lyrics = await readLyrics(); setLyrics(lyrics); }', errors: [{ messageId: 'stale' }] },
            // 外层拿了令牌的 async 闭包、.then 回调：一样是等待之后
            { filename: playbackFile, options: tokenOptions, code: 'function play(song) { const stillWanted = startPlay(); void (async () => { const meta = await readMeta(song); setLyrics(meta.lyrics); })(); }', errors: [{ messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'function play(song) { const stillWanted = startPlay(); readMeta(song).then(meta => setLyrics(meta.lyrics)); }', errors: [{ messageId: 'stale' }] },
            // #619 那类：try 里复核了，等待抛错时 catch 里的失败提示照样写给了新歌
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); try { const url = await fetchUrl(song); if (!stillWanted()) return; setAudioSrc(url); } catch (error) { presentOnlineFailure(error); } }', errors: [{ messageId: 'stale' }] },
            // 循环的回边：第二轮的写入在上一轮的等待之后
            { filename: playbackFile, options: tokenOptions, code: 'async function fill(stillWanted) { for (const song of songs) { setPlayQueue(next); await prefetch(song); } }', errors: [{ messageId: 'stale' }] },
            // 读到令牌但没拿它判断，不算复核
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); stillWanted.abandon(); setAudioSrc(url); }', errors: [{ messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const url = await fetchUrl(song); const stale = !stillWanted(); setAudioSrc(url); }', errors: [{ messageId: 'stale' }] },
            // await 写在写入的实参里
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); setLyrics(await load(song)); setPlayQueue((await loadQueue()).songs); }', errors: [{ messageId: 'stale' }, { messageId: 'stale' }] },
            // 令牌交给的是里面的调用，不是写入函数自己
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const x = await load(); setCurrentSong(pick(x, stillWanted)); }', errors: [{ messageId: 'stale' }] },
            // 令牌交给了被等待的函数，但没判结果就写：过期时写进去的是空值
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); setLyrics(await fetchLyrics(song, stillWanted)); }', errors: [{ messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song) { const stillWanted = startPlay(); const lyrics = await fetchLyrics(song, stillWanted); setLyrics(lyrics); }', errors: [{ messageId: 'stale' }] },
            // 判结果只复核产生它的那次 await；判断写在写入的实参里不算；令牌没当判断交出去不算
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song, stillWanted) { const track = await resolve(song, stillWanted); const lyrics = await loadLyrics(track); if (!track) return; setLyrics(lyrics); }', errors: [{ messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song, stillWanted) { const track = await resolve(song, stillWanted); setLyrics(track ? track.lyrics : null); setCurrentSong(track ?? fallback); }', errors: [{ messageId: 'stale' }, { messageId: 'stale' }] },
            { filename: playbackFile, options: tokenOptions, code: 'async function play(song, stillWanted) { const r = await fetchLyrics(song, { onProgress: () => console.log(stillWanted) }); if (!r) return; setLyrics(r); }', errors: [{ messageId: 'stale' }] },
        ],
    });

    tester.run('dedicatus/restricted-apis (D312)', plugin.rules['restricted-apis'], {
        valid: [{ code: 'const rewritten = wholeQueueWritesSoFar() !== atStart;', filename: playbackFile, options }],
        invalid: [restricted('const replaced = live.playQueue !== playQueue;', 'src/components/app/playback/start/usePlay.ts', 2)],
    });

    const jsx = { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } };
    tester.run('dedicatus/hot-callback-state', plugin.rules['hot-callback-state'], {
        valid: [
            { code: "function C() { const [line, setLine] = useState(0); useMotionValueEvent(time, 'change', t => { const next = find(t); if (next !== line) setLine(next); }); }" },
            { code: 'function C() { const [size, setSize] = useState(0); useEffect(() => setSize(1), []); }' },
            // frontend-runtime-guardrails 推荐的两种写法：自己比较新旧值的函数式更新、没变就提前返回
            { code: "function C() { const [line, setLine] = useState(0); useMotionValueEvent(time, 'change', t => { const next = find(t); setLine(prev => (prev === next ? prev : next)); }); }" },
            { code: 'function C() { const [h, setH] = useState(0); const tick = () => { const next = measure(); if (next === last.current) return; last.current = next; setH(next); }; requestAnimationFrame(tick); }' },
        ],
        invalid: [
            { code: "function C() { const [time, setTime] = useState(0); useMotionValueEvent(clock, 'change', t => setTime(t)); }", errors: [{ messageId: 'unguarded' }] },
            // 具名的帧循环和内联的帧回调都算
            { code: 'function C() { const [h, setH] = useState(0); const loop = () => { setH(measure()); requestAnimationFrame(loop); }; requestAnimationFrame(() => setH(1)); }', errors: [{ messageId: 'unguarded' }, { messageId: 'unguarded' }] },
            { code: 'const ro = new ResizeObserver(entries => useLayoutStore.getState().setHeight(entries[0].contentRect.height));', errors: [{ messageId: 'unguarded' }] },
            // MotionValue 的 .on('change')、从 store 取出来的写入函数、具名的 handler
            { code: "function C() { const setProgress = usePlayerStore(s => s.setProgress); useEffect(() => time.on('change', v => setProgress(v)), []); }", errors: [{ messageId: 'unguarded' }] },
            { code: "function C() { const [t, setT] = useState(0); const onChange = useCallback(v => setT(v), []); useMotionValueEvent(clock, 'change', onChange); }", errors: [{ messageId: 'unguarded' }] },
        ],
    });

    tester.run('dedicatus/effect-cleanup', plugin.rules['effect-cleanup'], {
        valid: [
            { code: 'useEffect(() => { const id = setInterval(tick, 500); return () => clearInterval(id); }, []);' },
            { code: 'useEffect(() => { const timer = setTimeout(done, 100); }, []);' },
            { code: 'useEffect(() => subscribe(listener), []);' },
            { code: 'useEffect(() => { if (!el) return undefined; const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect(); }, [el]);' },
            { code: 'useEffect(() => { const off = store.subscribe(listener); return off; }, []);' },
            // 注册本身就在 return 里
            { code: 'useEffect(() => { if (!open) return undefined; paint(); return clock.subscribe(paint); }, [open]);' },
        ],
        invalid: [
            // #987 / #304 那类：常驻的 interval、监听没有释放
            { code: 'useEffect(() => { setInterval(sample, 500); }, []);', errors: [{ messageId: 'missing' }] },
            { code: "useLayoutEffect(() => { window.addEventListener('mousemove', move, true); }, []);", errors: [{ messageId: 'missing' }] },
            // 只有注册之前的提前返回，或者返回 undefined，不算 cleanup
            { code: 'useEffect(() => { if (!el) return undefined; const id = setInterval(sample, 500); }, [el]);', errors: [{ messageId: 'missing' }] },
            { code: "useEffect(() => { window.addEventListener('resize', fit); return undefined; }, []);", errors: [{ messageId: 'missing' }] },
        ],
    });

    tester.run('dedicatus/ui-literal-text', plugin.rules['ui-literal-text'], {
        valid: [
            { ...jsx, code: "const A = () => <p title={t('a.title')}>{t('a.body')}</p>;" },
            { ...jsx, code: 'const A = () => <span>· 3 / 4 ·</span>;' },
            { ...jsx, code: 'const A = () => <b>Folia</b>;', options: [{ allow: ['Folia'] }] },
            // #689 演习：地址栏的示例值、带括号的产品名、单位
            { ...jsx, code: 'const A = () => <><input placeholder="localhost:8765" /><input placeholder="https://example.com/loop.mp4" /><input placeholder="http://127.0.0.1" /></>;' },
            { ...jsx, code: 'const A = () => <span>OpenSubsonic ({count})</span>;', options: [{ allow: ['OpenSubsonic'] }] },
            { ...jsx, code: 'const A = () => <div>Now Playing</div>;', options: [{ allow: ['Now Playing', 'Now'] }] },
            { ...jsx, code: 'const A = () => <span>{gain} dB · {freq} Hz</span>;', options: [{ allow: ['dB', 'Hz'] }] },
        ],
        invalid: [
            { ...jsx, code: 'const A = () => <p>Biography</p>;', errors: [{ messageId: 'literal' }] },
            { ...jsx, code: 'const A = () => <input placeholder="搜索歌曲" />;', errors: [{ messageId: 'literal' }] },
            // 名字去掉以后还剩要翻译的字；名字只在完整的词上认
            { ...jsx, code: 'const A = () => <p>Spotify 登录</p>;', errors: [{ messageId: 'literal' }], options: [{ allow: ['Spotify'] }] },
            { ...jsx, code: 'const A = () => <p>Disclaimer</p>;', errors: [{ messageId: 'literal' }], options: [{ allow: ['Dis'] }] },
        ],
    });
});
