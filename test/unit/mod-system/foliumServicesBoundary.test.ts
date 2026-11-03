import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/mod-system/foliumServicesBoundary.test.ts
// 规格要求 services.ts 不 import app store：导出窗口也会加载它，宿主状态只能经主窗口 App
// 注册的 registerFoliumHostActions 进来。这里按源码文本走它的运行时导入闭包（值导入、
// re-export、副作用导入与动态 import()，不含 import type），钉住两件事：
// - 闭包里没有 src/stores 下的模块，也没有只在主窗口装的宿主层（hostActions / hostQueue /
//   hostEvents / hostBridge），它们才是读写 app store 的地方；
// - 闭包里建 zustand store 的模块只有模组侧的 registries/homeTabs（首页模组页面的选中状态）。
//   也就是说「不 import 任何 app store」成立，「不 import 任何 store」不成立；
//   闭包里多出别的 store 时，这条会失败，提醒同时改 services.ts 文件头的那段说明。

const ROOT = path.resolve(__dirname, '../../..');
const ENTRY = 'src/mods/folium/services.ts';
const HOME_TABS = 'src/mods/folium/registries/homeTabs.ts';

const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/**
 * 运行时会加载的说明符：值导入与 re-export（跳过 `import type` / `export type`）、副作用导入和动态 import()。
 * `dynamic: false` 时不含动态 import()：那是用到时才加载的代码块，不随入口一起加载。
 */
const runtimeSpecifiersOf = (file: string, dynamic: boolean) => {
    const source = read(file);
    return [
        ...[...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"];/gms)]
            .filter(match => !/^\s*(?:import|export)\s+type\s/.test(match[0]))
            .map(match => match[1]),
        ...[...source.matchAll(/^\s*import\s+['"]([^'"]+)['"];/gm)].map(match => match[1]),
        ...(dynamic ? [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]) : []),
    ];
};

/** 仓库内说明符解析成带扩展名的源文件（含 shared/ 下的 .mjs 和导入的 .json）；裸包名返回 null，找不到文件返回 undefined。 */
const resolveSource = (file: string, specifier: string): string | null | undefined => {
    let base: string;
    if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
    else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    else return null;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
        .find(candidate => /\.(?:tsx?|m?js|json)$/.test(candidate) && existsSync(path.join(ROOT, candidate)));
};

/** 从入口走仓库内的运行时导入，回传闭包里的源文件、各自引用的包名，以及解析不到的说明符。 */
const walkRuntimeClosure = (entry: string, { dynamic = true }: { dynamic?: boolean } = {}) => {
    const packagesByFile = new Map<string, string[]>();
    const unresolved: string[] = [];
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop() as string;
        if (packagesByFile.has(file)) continue;
        const packages: string[] = [];
        packagesByFile.set(file, packages);
        for (const specifier of runtimeSpecifiersOf(file, dynamic)) {
            const target = resolveSource(file, specifier);
            if (target === null) packages.push(specifier);
            else if (target === undefined) unresolved.push(`${file} -> ${specifier}`);
            else queue.push(target);
        }
    }
    return { files: [...packagesByFile.keys()].sort(), packagesByFile, unresolved };
};

describe('folium services import boundary', () => {
    const closure = walkRuntimeClosure(ENTRY);

    it('walks the whole runtime closure of services.ts', () => {
        // 解析不到的说明符会让闭包悄悄变小，这条 gate 就会安静地永远为绿。
        expect(closure.unresolved).toEqual([]);
        expect(closure.files).toContain(ENTRY);
        expect(closure.files).toContain(HOME_TABS);
    });

    it('reaches no app store and none of the main-window host layer', () => {
        const offenders = closure.files.filter(file => (
            /^src\/stores\//.test(file)
            || /^src\/mods\/runtime\/(?:host|queue\/)/.test(file)
        ));
        expect(offenders).toEqual([]);
    });

    it('creates no zustand store except the mods-owned home-tab selection', () => {
        const storeModules = closure.files.filter(file => (
            (closure.packagesByFile.get(file) ?? []).some(specifier => /^zustand(?:\/|$)/.test(specifier))
        ));
        expect(storeModules).toEqual([HOME_TABS]);
        expect(read(HOME_TABS)).toMatch(/export const useFoliumHomeTabStore = create</);
    });
});

/*
 * Folium 1.7 `folium.omni`：模组那一半（folium/omni/service.ts、额度 omni/requestQuota.ts）随 api.ts 进导出
 * 窗口的包，经 Omni 读数据的宿主层（runtime/omni/）只在主窗口的 mainWindowStart.ts 里装上。omni.ts 一个就带进
 * 上百个文件、全部平台和几个 store，进了 api.ts 的闭包就进了导出窗口的包，所以钉住：
 * - api.ts 随它一起加载的闭包（不含用到时才加载的动态 import()）里没有 src/services/onlineMusic/ 下的模块，
 *   也没有主窗口的宿主层（runtime/host*、runtime/omni/）；runtime/ 里 api.ts 本来就要的注册表、guard、
 *   status 等不在此列；
 * - 连动态 import() 一起走也到不了 omni.ts 和 runtime/omni/：舞台图层用到时才加载的那一块会带进播放 store
 *   和平台的注册表，但不带 omni；
 * - service.ts 和 requestQuota.ts 确实在闭包里（否则上面两条会因为没走到而安静地为绿）。
 * 不照搬「不含 src/stores」：api.ts 的闭包本来就含 useMotionSettingsStore 等。
 */
describe('folium.omni import boundary', () => {
    const API = 'src/mods/folium/api.ts';
    const loaded = walkRuntimeClosure(API, { dynamic: false });
    const reachable = walkRuntimeClosure(API);

    it('walks the whole closure of api.ts, with the omni service and the shared allowance in it', () => {
        expect(loaded.unresolved).toEqual([]);
        expect(reachable.unresolved).toEqual([]);
        expect(loaded.files).toContain('src/mods/folium/omni/service.ts');
        expect(loaded.files).toContain('src/mods/folium/omni/requestQuota.ts');
    });

    it('loads no online music service and none of the main-window host layer with api.ts', () => {
        expect(loaded.files.filter(file => /^src\/services\/onlineMusic\//.test(file))).toEqual([]);
        expect(loaded.files.filter(file => /^src\/mods\/runtime\/(?:host|omni\/|queue\/)/.test(file))).toEqual([]);
    });

    it('never reaches Omni or the host side of folium.omni from api.ts, lazily loaded chunks included', () => {
        expect(reachable.files.filter(file => (
            file === 'src/services/onlineMusic/omni.ts' || /^src\/mods\/runtime\/omni\//.test(file)
        ))).toEqual([]);
    });
});

/*
 * Folium 1.7 `folium.equalizer`：模组那一半（folium/equalizer/service.ts）随 api.ts 进导出窗口的包，读写音频设置
 * store 的宿主层（runtime/equalizer/）只在主窗口的 mainWindowStart.ts 里装上。所以钉住：
 * - service.ts 确实在 api.ts 随它一起加载的闭包（不含动态 import()）里，否则下面两条会因为没走到而安静地为绿；
 * - 那个闭包里没有 src/stores/useAudioSettingsStore.ts。只在这个闭包上断言：连动态 import() 一起走时，舞台图层
 *   用到时才加载的那一块本来就能走到这个 store 和 src/utils/audioEqualizer.ts，写在那上面一开始就会失败；
 * - 两种闭包都到不了 runtime/equalizer/ 下的任何文件。
 */
describe('folium.equalizer import boundary', () => {
    const API = 'src/mods/folium/api.ts';
    const loaded = walkRuntimeClosure(API, { dynamic: false });
    const reachable = walkRuntimeClosure(API);

    it('loads the equalizer service with api.ts', () => {
        expect(loaded.unresolved).toEqual([]);
        expect(loaded.files).toContain('src/mods/folium/equalizer/service.ts');
    });

    it('loads no audio settings store with api.ts', () => {
        expect(loaded.files).not.toContain('src/stores/useAudioSettingsStore.ts');
    });

    it('never reaches the host side of folium.equalizer from api.ts, lazily loaded chunks included', () => {
        expect(loaded.files.filter(file => /^src\/mods\/runtime\/equalizer\//.test(file))).toEqual([]);
        expect(reachable.files.filter(file => /^src\/mods\/runtime\/equalizer\//.test(file))).toEqual([]);
    });
});

/*
 * Folium 1.8 `folium.visualizer`：和 equalizer 同样的分法。模组那一半（folium/visualizer/service.ts）随 api.ts 进导出
 * 窗口的包，读写 visualizer 设置 store 的宿主层（runtime/visualizer/）只在主窗口的 mainWindowStart.ts 里装上。钉住：
 * service.ts 在 api.ts 随它一起加载的闭包里；两种闭包都到不了 runtime/visualizer/ 下的任何文件。
 */
describe('folium.visualizer import boundary', () => {
    const API = 'src/mods/folium/api.ts';
    const loaded = walkRuntimeClosure(API, { dynamic: false });
    const reachable = walkRuntimeClosure(API);

    it('loads the visualizer service with api.ts', () => {
        expect(loaded.unresolved).toEqual([]);
        expect(loaded.files).toContain('src/mods/folium/visualizer/service.ts');
    });

    it('never reaches the host side of folium.visualizer from api.ts, lazily loaded chunks included', () => {
        expect(loaded.files.filter(file => /^src\/mods\/runtime\/visualizer\//.test(file))).toEqual([]);
        expect(reachable.files.filter(file => /^src\/mods\/runtime\/visualizer\//.test(file))).toEqual([]);
    });
});
