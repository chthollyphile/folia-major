import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../../../dev/dedicatus/ipcChannels.mjs';

// test/unit/dedicatus/contracts/providerRegistration.test.ts
// D122：providerRegistry.ts 里登记的每个平台，都要同时出现在 src/services/onlineMusic/README.md“接入一个新平台”要求的地方：
// omniArchitecture.test.ts 的 forbiddenImport（它的 Transport）、platformNameCount.ts 的 PLATFORM_NAMES、UPSTREAMS.md；
// 只在桌面端跑的平台还要有 electron/<id>/ 的桥和 <id>-api-request 通道。少了哪一处，那两个架构测试就不管这个平台了（#874）。

const ROOT = path.resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** providerRegistry.ts 里登记的平台 id（`registerOnlineMusicProvider(neteaseProvider)` → netease）。 */
const registeredIds = () => [...read('src/services/onlineMusic/providerRegistry.ts').matchAll(/^registerOnlineMusicProvider\((\w+)Provider\);/gm)]
    .map(match => match[1]);

/** omniArchitecture 的 forbiddenImport 里代表一个平台的写法：它的 Transport；网易云没有 Transport，是 netease/netease。 */
const transportSpelling = (id: string) => (id === 'netease' ? 'onlineMusic\\/netease\\/netease' : `${id}Transport`);

describe('D122 every registered platform is registered everywhere', () => {
    const ids = registeredIds();

    it('reads the registered platforms, so the pattern still matches something', () => {
        expect(ids).toContain('netease');
        expect(ids.length).toBeGreaterThan(5);
        // 每一处注册都按这个写法认得出：改成条件注册、缩进或别的写法，这里先失败，而不是悄悄少查一个平台
        const calls = read('src/services/onlineMusic/providerRegistry.ts').match(/(?<!function )\bregisterOnlineMusicProvider\(/g) ?? [];
        expect(ids.length, 'D122：providerRegistry.ts 里有认不出的注册写法').toBe(calls.length);
    });

    it('names each platform in the architecture tests and UPSTREAMS.md', () => {
        const forbidden = /const forbiddenImport = (\/.*\/);/.exec(read('test/unit/onlineMusic/omniArchitecture.test.ts'))?.[1] ?? '';
        const platformNames = /export const PLATFORM_NAMES = \{([\s\S]*?)\n\};/.exec(read('test/unit/onlineMusic/platformNameCount.ts'))?.[1] ?? '';
        const upstreams = read('src/services/onlineMusic/UPSTREAMS.md');
        const missing = ids.flatMap(id => [
            ...(forbidden.includes(transportSpelling(id)) ? [] : [`${id}：omniArchitecture.test.ts 的 forbiddenImport 没有它的 Transport`]),
            ...(new RegExp(`^\\s*${id}:`, 'm').test(platformNames) ? [] : [`${id}：platformNameCount.ts 的 PLATFORM_NAMES 没有它`]),
            ...(upstreams.includes(`（\`${id}\``) ? [] : [`${id}：UPSTREAMS.md 没有它的一节`]),
        ]);
        expect(missing, 'D122：照 src/services/onlineMusic/README.md“接入一个新平台”把这几处补上').toEqual([]);
    });

    it('gives each desktop-only platform its bridge and its request channel', () => {
        const upstreams = read('src/services/onlineMusic/UPSTREAMS.md');
        const desktopOnly = [...upstreams.matchAll(/^## .*（`(\w+)`，仅桌面端）/gm)].map(match => match[1]);
        expect(desktopOnly.length).toBeGreaterThan(0);
        const missing = desktopOnly.flatMap(id => [
            ...(existsSync(path.join(ROOT, 'electron', id)) ? [] : [`${id}：没有 electron/${id}/ 的桥`]),
            ...(Object.hasOwn(IPC_CHANNELS, `${id}-api-request`) ? [] : [`${id}：没有 ${id}-api-request 通道`]),
        ]);
        expect(missing, 'D122：只在桌面端跑的平台要有主进程的桥和请求通道').toEqual([]);
    });
});
