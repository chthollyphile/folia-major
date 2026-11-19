import crypto from 'node:crypto';
import type { FoliumSourceMainApi } from '@folia/folium';
import { answerError, runSteps, withTimeout } from '../../shared/smoke';
// test/fixtures/folium-sources/deps-archive/kugou/main/index.ts
// 酷狗依赖归档样例的 main 入口：照宿主 electron/kugou/kugouApiBridge.cjs 的做法，设 platform=lite 后在主进程里从
// deps 归档 require 上游（它在加载时扫自己的 module/ 目录、逐个 require），不起本地服务、直接调它的函数：
// 用新造的设备 cookie 注册设备，再匿名搜一次。rpc `smoke` 交回报告。

const KUGOU = 'kugoumusicapi';
const KEYWORD = '晴天';

type KugouCall = (params: Record<string, unknown>) => Promise<{ status?: number; body?: unknown; cookie?: unknown }>;

const randomUpperHex = (bytes: number) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

/** 新的设备 cookie（和宿主 createDeviceCookies 同样的字段）。 */
const deviceCookies = (): Record<string, string> => {
    const guid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
    const digest = crypto.createHash('md5').update(guid).digest('hex');
    const mac = Array.from(crypto.randomBytes(6)).map((value) => value.toString(16).padStart(2, '0')).join(':').toUpperCase();
    return {
        KUGOU_API_PLATFORM: 'lite',
        KUGOU_API_GUID: guid,
        KUGOU_API_MID: BigInt(`0x${digest}`).toString(10),
        KUGOU_API_DEV: randomUpperHex(5),
        KUGOU_API_MAC: mac,
        KUGOU_API_WEBGL: BigInt(`0x${randomUpperHex(8)}`).toString(10),
    };
};

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    let functions: Record<string, unknown> = {};

    const load = async (): Promise<string> => {
        process.env.platform = 'lite';
        const loaded = await import('kugoumusicapi') as Record<string, unknown> & { default?: Record<string, unknown> };
        functions = { ...(loaded.default ?? {}), ...loaded };
        const count = Object.values(functions).filter((value) => typeof value === 'function').length;
        return `required, ${String(count)} functions`;
    };

    const ready = (): Promise<string> => {
        const missing = ['register_dev', 'search'].filter((name) => typeof functions[name] !== 'function');
        if (missing.length > 0) return Promise.reject(new Error(`module/ scan did not give ${missing.join(', ')}`));
        return Promise.resolve('register_dev and search are there (module/ scanned inside the archive)');
    };

    const request = async (): Promise<string> => {
        const cookie = deviceCookies();
        const call = (name: string, params: Record<string, unknown>) => withTimeout(
            (functions[name] as KugouCall)(params).catch((error: unknown) => {
                throw answerError(`${name} rejected`, (error as { body?: unknown } | null)?.body ?? error);
            }),
            30000,
            name,
        );
        const registered = await call('register_dev', { cookie });
        const dfid = (registered.body as { data?: { dfid?: unknown } } | undefined)?.data?.dfid;
        if (typeof dfid !== 'string' || dfid === '') throw answerError('register_dev gave no dfid', registered.body);
        const searched = await call('search', { keywords: KEYWORD, cookie: { ...cookie, dfid } });
        const body = searched.body as { status?: number; data?: { lists?: Array<{ SongName?: string; FileName?: string }>; total?: number } } | undefined;
        const first = body?.data?.lists?.[0];
        if (!first) throw answerError('search gave no songs', body);
        return `register_dev ok, search total ${String(body.data?.total ?? '?')}, first "${first.SongName ?? first.FileName ?? '?'}"`;
    };

    api.rpc.handle('smoke', () => runSteps('kugou', KUGOU, [['load', load], ['ready', ready], ['request', request]]));
}
