import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../../../dev/dedicatus/ipcChannels.mjs';

// test/unit/dedicatus/contracts/providerRegistration.test.ts
// D122：providerRegistry.ts 里登记的每个平台，都要同时出现在 src/services/onlineMusic/README.md“接入一个新平台”要求的地方：
// omniArchitecture.test.ts 的 forbiddenImport（它的 Transport）、platformNameCount.ts 的 PLATFORM_NAMES、UPSTREAMS.md；
// 只在桌面端跑的平台还要有 electron/<id>/ 的桥和 <id>-api-request 通道。少了哪一处，那两个架构测试就不管这个平台了（#874）。
//
// Folium 2.0：平台逐家搬进 sources/<id>/（S5），搬过去的从 sources/*/mod.json 读出来，和 providerRegistry.ts 静态登记的
// 合在一起查。搬过去的平台，上游说明在它自己的 README.md（原 UPSTREAMS.md 里那一节），主进程的部分在 sources/<id>/main/
// 经模组运行时的 rpc 走，不再要 electron/<id>/ 和 <id>-api-request；两处都认，搬的过程中哪一处在都算数。
// 搬过去的平台在 omniArchitecture 的 forbiddenImport 里由 `sources\/` 挡住，Transport 的名字从那里删掉；仅桌面端的
// 名单也读它自己 README.md 的标题（S5 迁波点时补的）。

const ROOT = path.resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** providerRegistry.ts 里登记的平台 id（`registerOnlineMusicProvider(neteaseProvider)` → netease）。 */
const registeredIds = () => [...read('src/services/onlineMusic/providerRegistry.ts').matchAll(/^\s*registerOnlineMusicProvider\((\w+)Provider\);/gm)]
    .map(match => match[1]);

/** sources/<目录>/mod.json 声明的音源 id → 它的目录（内置音源的 id 就是目录名，内置清单校验管这一条）。 */
const sourceDirs = (): Map<string, string> => {
    const dir = path.join(ROOT, 'sources');
    const found = new Map<string, string>();
    if (!existsSync(dir)) return found;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const manifest = path.join(dir, entry.name, 'mod.json');
        if (!entry.isDirectory() || !existsSync(manifest)) continue;
        const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { sources?: { id: string }[] }).sources ?? [];
        declared.forEach(source => found.set(source.id, `sources/${entry.name}`));
    }
    return found;
};

/** omniArchitecture 的 forbiddenImport 里代表一个平台的写法：它的 Transport；网易云没有 Transport，是 netease/netease。 */
const transportSpelling = (id: string) => (id === 'netease' ? 'onlineMusic\\/netease\\/netease' : `${id}Transport`);

describe('D122 every registered platform is registered everywhere', () => {
    const sources = sourceDirs();
    const ids = [...new Set([...registeredIds(), ...sources.keys()])];

    it('reads the registered platforms, so the pattern still matches something', () => {
        expect(ids).toContain('netease');
        expect(ids.length).toBeGreaterThan(5);
        // 每一处注册都按这个写法认得出：改成条件注册、缩进或别的写法，这里先失败，而不是悄悄少查一个平台
        const calls = read('src/services/onlineMusic/providerRegistry.ts').match(/(?<!function )\bregisterOnlineMusicProvider\(/g) ?? [];
        expect(registeredIds().length, 'D122：providerRegistry.ts 里有认不出的注册写法').toBe(calls.length);
    });

    it('names each platform in the architecture tests and UPSTREAMS.md (or, moved to sources/, its own README.md)', () => {
        const forbidden = /const forbiddenImport = (\/.*\/);/.exec(read('test/unit/onlineMusic/omniArchitecture.test.ts'))?.[1] ?? '';
        const platformNames = /export const PLATFORM_NAMES = \{([\s\S]*?)\n\};/.exec(read('test/unit/onlineMusic/platformNameCount.ts'))?.[1] ?? '';
        const upstreams = read('src/services/onlineMusic/UPSTREAMS.md');
        const missing = ids.flatMap(id => [
            // 搬进 sources/ 的平台由 forbiddenImport 里的 `sources\/` 一并挡住，不再列它的 Transport（S5 起逐家删）。
            ...(forbidden.includes(sources.has(id) ? 'sources\\/' : transportSpelling(id))
                ? []
                : [`${id}：omniArchitecture.test.ts 的 forbiddenImport 没有${sources.has(id) ? ' sources/' : '它的 Transport'}`]),
            ...(new RegExp(`^\\s*${id}:`, 'm').test(platformNames) ? [] : [`${id}：platformNameCount.ts 的 PLATFORM_NAMES 没有它`]),
            ...(upstreams.includes(`（\`${id}\``) || (sources.has(id) && existsSync(path.join(ROOT, sources.get(id) as string, 'README.md')))
                ? []
                : [`${id}：UPSTREAMS.md 没有它的一节${sources.has(id) ? `，${sources.get(id)}/README.md 也没有` : ''}`]),
        ]);
        expect(missing, 'D122：照 src/services/onlineMusic/README.md“接入一个新平台”把这几处补上').toEqual([]);
    });

    it('gives each desktop-only platform its bridge and its request channel (or, moved to sources/, its main entry)', () => {
        // 仅桌面端的平台：UPSTREAMS.md 的标题，和搬进 sources/ 的平台自己 README.md 的标题（S5 起那一节随平台搬走）。
        const DESKTOP_ONLY = /^#{1,2} .*（`(\w+)`，仅桌面端）/gm;
        const readmes = [...new Set(sources.values())].map(dir => path.join(dir, 'README.md')).filter(file => existsSync(path.join(ROOT, file)));
        const desktopOnly = [read('src/services/onlineMusic/UPSTREAMS.md'), ...readmes.map(read)]
            .flatMap(text => [...text.matchAll(DESKTOP_ONLY)].map(match => match[1]));
        expect(desktopOnly.length).toBeGreaterThan(0);
        const missing = desktopOnly.flatMap((id) => {
            const moved = sources.get(id);
            if (moved) return existsSync(path.join(ROOT, moved, 'main')) ? [] : [`${id}：${moved}/main/ 不在`];
            return [
                ...(existsSync(path.join(ROOT, 'electron', id)) ? [] : [`${id}：没有 electron/${id}/ 的桥`]),
                ...(Object.hasOwn(IPC_CHANNELS, `${id}-api-request`) ? [] : [`${id}：没有 ${id}-api-request 通道`]),
            ];
        });
        expect(missing, 'D122：只在桌面端跑的平台要有主进程的桥和请求通道').toEqual([]);
    });
});
