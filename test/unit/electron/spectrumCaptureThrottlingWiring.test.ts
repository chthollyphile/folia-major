import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/spectrumCaptureThrottlingWiring.test.ts
// 后台节流只在整机声音真的被采着时才让路：main.cjs 里让路的那条理由只有 externalSpectrumCaptureActive，
// 而这个标记只在 display-media handler 把系统声音交出去的那一刻才立起来，采集一结束（渲染层报告、页面
// 没了、导航走了）就清掉并让节流重新按设置生效。没在采集时，上游那条"设了 后台节流 就照做"的行为一点
// 没变，窗口的 webPreferences 也还是上游的 backgroundThrottling: false。
//
// main.cjs 不能 require（会把整个应用拉起来）：几段产品代码从源码里原样取出来，把它用到的名字当参数
// 传进去执行，测的是产品代码本身。

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

const standDownBody = mainCjs.match(/getStandDownReason: \(\) => \{\n([\s\S]*?)\n {2}\},\n\}\);/)?.[1] ?? '';
const spectrumBranch = mainCjs.match(/if \(route === DISPLAY_MEDIA_ROUTE_SPECTRUM\) \{\n([\s\S]*?)\n {4}\}/)?.[1] ?? '';
const forgetBody = mainCjs.match(/const forgetExternalSpectrumCapture = \(\) => \{\n([\s\S]*?)\n\};\n/)?.[1] ?? '';

/** `getStandDownReason` 的产品代码，参数就是它读的那几个名字。 */
const standDown = (deps: Record<string, unknown>) => {
    const names = Object.keys(deps);
    const factory = new Function(...names, `return () => {\n${standDownBody}\n};`);
    return factory(...Object.values(deps)) as () => string | null;
};

const reasonsWith = (over: Record<string, unknown> = {}) => standDown({
    isWallpaperModeEnabled: () => false,
    externalSpectrumCaptureActive: false,
    videoExportWindowRestoreState: null,
    obsBrowserSourceClients: new Map(),
    ...over,
})();

/**
 * `forgetExternalSpectrumCapture` 的产品代码。它写的是 main.cjs 里那个 `let`，所以这里给它一个同样
 * 形状的闭包，读回来的是它写进去的值。
 */
const makeForget = (active: boolean, refresh: () => void) => {
    const factory = new Function(
        'externalSpectrumArm', 'backgroundThrottling', 'flags',
        `let externalSpectrumCaptureActive = flags.active;\n`
        + `const forgetExternalSpectrumCapture = () => {\n${forgetBody}\n};\n`
        + 'return { forget: forgetExternalSpectrumCapture, isActive: () => externalSpectrumCaptureActive };',
    );
    const disarm = vi.fn();
    return factory({ disarm }, { refresh }, { active }) as {
        forget: () => void;
        isActive: () => boolean;
    };
};

describe('main.cjs: the window stays live only for a capture that is really running', () => {
    it('finds the reason and the branch that raises it', () => {
        expect(standDownBody, 'getStandDownReason').toContain('externalSpectrumCaptureActive');
        expect(spectrumBranch, 'the spectrum grant').toContain('externalSpectrumCaptureActive = true');
        expect(forgetBody, 'forgetExternalSpectrumCapture').toContain('externalSpectrumCaptureActive = false');
    });

    it('names the capture as a stand-down reason only while one is held', () => {
        expect(reasonsWith()).toBeNull();
        expect(reasonsWith({ externalSpectrumCaptureActive: true })).toBe('system sound capture');
    });

    it('keeps the upstream reasons, and their order, untouched', () => {
        // Wallpaper mode still wins, then an export, then an OBS source, exactly as before this route.
        expect(reasonsWith({ isWallpaperModeEnabled: () => true, externalSpectrumCaptureActive: true, videoExportWindowRestoreState: {}, obsBrowserSourceClients: new Map([['a', {}]]) }))
            .toBe('wallpaper mode');
        expect(reasonsWith({ externalSpectrumCaptureActive: true, videoExportWindowRestoreState: {}, obsBrowserSourceClients: new Map([['a', {}]]) }))
            .toBe('video export');
        expect(reasonsWith({ externalSpectrumCaptureActive: true, obsBrowserSourceClients: new Map([['a', {}]]) }))
            .toBe('OBS browser source');
    });

    it('holds no other reason, and raises the flag from two places only: the grant and its end', () => {
        // Nothing else in main.cjs turns the switch off for this route: with no capture held, a saved
        // 后台节流 setting behaves exactly as it did upstream.
        expect(reasonsWith({ externalSpectrumCaptureActive: false })).toBeNull();
        const written = [...mainCjs.matchAll(/externalSpectrumCaptureActive = (true|false)/g)].map(match => match[1]);
        // Declared false, dropped by forgetExternalSpectrumCapture, raised by the one grant branch.
        expect(written).toEqual(['false', 'false', 'true']);
    });

    it('raises the flag only on the grant, never on the arm or on a refusal', () => {
        // An arm alone buys one call and nothing else: the window is not kept live for a request that
        // may never come, or that the handler then refuses.
        expect(spectrumBranch).toContain('externalSpectrumArm.spend()');
        expect(spectrumBranch.indexOf('externalSpectrumArm.spend()'))
            .toBeLessThan(spectrumBranch.indexOf('externalSpectrumCaptureActive = true'));
    });

    it('leaves the window preferences at the upstream value', () => {
        // The flag belongs to the 后台节流 switch, not to how the window is built: constructing it with
        // throttling always off would override that switch for everybody.
        const prefs = [...mainCjs.matchAll(/backgroundThrottling:\s*(false|true)\b/g)].map(match => match[1]);
        expect(prefs).toEqual(['false', 'false']);
        expect(mainCjs).not.toMatch(/setBackgroundThrottling\(false\)/);
    });
});

describe('main.cjs: the end of a capture gives the throttling switch back', () => {
    it('drops the flag and refreshes the switch, so the setting applies again at once', () => {
        const refresh = vi.fn();
        const held = makeForget(true, refresh);
        expect(held.isActive()).toBe(true);

        held.forget();

        expect(held.isActive()).toBe(false);
        expect(refresh).toHaveBeenCalledOnce();
    });

    it('leaves the switch alone when no capture was held', () => {
        // Only a possibly outstanding arm is cleared: there is no state of the switch to report.
        const refresh = vi.fn();
        const idle = makeForget(false, refresh);
        idle.forget();
        expect(refresh).not.toHaveBeenCalled();
        expect(idle.isActive()).toBe(false);
    });
});
