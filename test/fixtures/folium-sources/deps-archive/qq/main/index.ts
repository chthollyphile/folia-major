import path from 'node:path';
import type { FoliumSourceMainApi } from '@folia/folium';
import { answerError, freePort, runSteps, untilListening, withTimeout } from '../../shared/smoke';
// test/fixtures/folium-sources/deps-archive/qq/main/index.ts
// QQ 音乐依赖归档样例的 main 入口：照 sources/qq/main/qqApiStartup.cjs 的做法，在主进程里从 deps 归档 require 上游
// （包在 require 时自己起 HTTP 服务，端口和状态文件经环境变量交给它，加载完还原），等它监听上，再发一次匿名搜索。
// rpc `smoke` 交回报告。

const QQ = '@yakult-green-tea/qq-music-api';
const KEYWORD = '晴天';
const ENV_KEYS = ['PORT', 'NODE_ENV', 'AUTO_OPEN_EXPLORER', 'QQ_AUTH_STATE_PATH', 'QQ_DISABLE_UPDATE_CHECK'] as const;

interface QqServer {
    listening: boolean;
    once(event: string, listener: (...args: unknown[]) => void): unknown;
    close(): unknown;
}

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    let server: QqServer | null = null;
    let port = 0;
    api.onDispose(() => { server?.close(); });

    const load = async (): Promise<string> => {
        port = await freePort();
        const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
        process.env.PORT = String(port);
        process.env.AUTO_OPEN_EXPLORER = 'false';
        process.env.QQ_DISABLE_UPDATE_CHECK = 'true';
        process.env.QQ_AUTH_STATE_PATH = path.join(api.cache.dir(), 'qq-auth-state.json');
        try {
            const loaded = await import('@yakult-green-tea/qq-music-api') as { server?: QqServer; default?: { server?: QqServer } };
            server = loaded.server ?? loaded.default?.server ?? null;
        } finally {
            for (const key of ENV_KEYS) {
                if (previous[key] === undefined) Reflect.deleteProperty(process.env, key);
                else process.env[key] = previous[key];
            }
        }
        if (!server) throw new Error('the package did not expose an HTTP server');
        return `required, server object exposed (port ${String(port)})`;
    };

    const ready = async (): Promise<string> => {
        if (!server) throw new Error('no server');
        await untilListening(server);
        return `listening on port ${String(port)}`;
    };

    const request = async (): Promise<string> => {
        const url = `http://127.0.0.1:${String(port)}/search?keyword=${encodeURIComponent(KEYWORD)}`;
        const response = await withTimeout(fetch(url), 30000, 'search');
        const text = await response.text();
        let body: unknown = text;
        try {
            body = JSON.parse(text);
        } catch {
            // 不是 JSON：原样放进摘要。
        }
        if (!response.ok) throw answerError(`HTTP ${String(response.status)}`, body);
        const songs = findSongs(body);
        return `HTTP ${String(response.status)}, ${String(songs.length)} songs, first "${songs[0] ?? '(none)'}"`;
    };

    api.rpc.handle('smoke', () => runSteps('qq', QQ, [['load', load], ['ready', ready], ['request', request]]));
}

/** 答复里第一串带 name / title 的歌（包的答复嵌了好几层，样例不依赖它的确切形状）。 */
const findSongs = (body: unknown): string[] => {
    const seen = new Set<unknown>();
    const walk = (node: unknown): string[] => {
        if (!node || typeof node !== 'object' || seen.has(node)) return [];
        seen.add(node);
        if (Array.isArray(node)) {
            const names = node.map((item: unknown) => {
                const record = item as { name?: unknown; title?: unknown; songname?: unknown } | null;
                const name = record?.name ?? record?.title ?? record?.songname;
                return typeof name === 'string' ? name : null;
            }).filter((name): name is string => name !== null);
            if (names.length > 0) return names;
        }
        for (const value of Object.values(node)) {
            const found = walk(value);
            if (found.length > 0) return found;
        }
        return [];
    };
    return walk(body);
};
