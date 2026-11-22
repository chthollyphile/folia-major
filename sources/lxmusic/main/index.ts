import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import type { FoliumSourceAudioQuality, FoliumSourceMainApi, FoliumSourceSong } from '@folia/folium';
import { CatalogError, createCatalog, parseSongId } from './catalog.ts';
import type { CatalogFetch } from './catalog.ts';
import { createEgress, EgressBlockedError } from './egress.ts';
import { createConcurrencyGate, createRateGate, guardStream, LIMITS, RateLimitedError } from './rateLimit.ts';
import { buildMusicInfo, LX_TO_QUALITY, pickLxQuality, QUALITY_TO_LX } from './musicInfo.ts';
import { hostnameBlockReason } from './egressGuard.ts';
import { createLxSandbox, SANDBOX_PARTITION } from './sandboxHost.ts';
import type { LxSandboxScript } from './sandboxHost.ts';
import {
    createScriptLibrary, isLxPlatform, LxImportError, MAX_SCRIPT_BYTES, normalizeLxScript, parseLxHeader,
    sanitizeDeclaredSources, validateLxScript,
} from './scripts.ts';
import type { LxScriptRecord } from './scripts.ts';

// sources/lxmusic/main/index.ts
// 洛雪音源模组的 main 入口。三块互不相通的东西接在一起：
//   - 曲库（catalog.ts）：模组自己的代码请求四家平台的公开接口，地址写死在模组里，走 api.net.fetch（默认会话、
//     跟系统代理），一律不带凭据（credentials: 'omit'）；
//   - 脚本（scripts.ts、sandboxHost.ts）：用户导入的洛雪自定义源脚本存在模组自己的 api.storage，跑在隐藏沙箱窗口里，
//     只用来给一首歌出播放地址（声明了的话也出歌词）；
//   - 受控出口（egress.ts）：脚本的 lx.request 和它给的音频地址只从这里出去，拦本机与内网。音频不把脚本给的地址
//     交给主窗口，交的是 folia-mod://lxmusic/_media/stream/…（api.media.serve），由出口带 Range 转发。
// 没导入脚本时这里什么都不做：不开窗口、不联网（client 那边 getAvailability 答「没配好」，宿主不来问）。
// 窗口经 folium.rpc 调这里（宿主只放主窗口的调用进来）；每个调用回 { ok: true, data } 或 { ok: false, code, message }。

/** 签发出去的音频地址多久之内有效。 */
const STREAM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_STREAMS = 256;
const CATALOG_TIMEOUT_MS = 12_000;
/** 曲库一个回答的上限（歌单详情一次给全，会有几 MB）。 */
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_PAGE = 100;

type RpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const failure = (error: unknown): RpcResult<never> => {
    if (error instanceof LxImportError) return { ok: false, code: `import:${error.code}`, message: error.message };
    if (error instanceof CatalogError) return { ok: false, code: error.code, message: error.message };
    if (error instanceof EgressBlockedError) return { ok: false, code: 'blocked', message: error.message };
    return { ok: false, code: 'failed', message: error instanceof Error ? error.message : String(error) };
};

/** 开发时放行的本机假服务（`主机:端口`）：只在没打包的应用里读，正式版不认这个环境变量。 */
const devAllowance = (): ((hostname: string, port: number) => boolean) => {
    const raw = (process as { defaultApp?: boolean }).defaultApp ? process.env.FOLIA_LXMUSIC_DEV_ALLOW : undefined;
    const allowed = new Set((raw ?? '').split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean));
    return (hostname, port) => allowed.has(`${hostname.toLowerCase()}:${port}`);
};

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    // 错误的文字有的来自脚本：只留一行、截短了再进日志。
    const log = (message: string, error?: unknown) => {
        const detail = error === undefined ? '' : (error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error').replace(/\s+/g, ' ').slice(0, 300);
        api.log.warn(detail ? `[LxMusic] ${message}: ${detail}` : `[LxMusic] ${message}`);
    };
    const allow = devAllowance();
    const rate = createRateGate(LIMITS.rate);
    const egress = createEgress({ allow, gate: (hostname, signal) => rate.take(hostname, signal) });
    // 音频转发另用一套桶，也宽得多：那是播放器发起的请求（拖动时一连串带 Range 的），脚本催不动它；脚本把自己的额度
    // 用光了也不该让歌放不出来。
    const audioRate = createRateGate(LIMITS.audioRate);
    const audioEgress = createEgress({ allow, gate: (hostname, signal) => audioRate.take(hostname, signal) });
    const library = createScriptLibrary(api.storage);

    let runtimeCode: string | null = null;
    const sandbox = createLxSandbox({
        session: api.net.session(SANDBOX_PARTITION),
        hidden: options => api.windows.hidden(options),
        egress,
        concurrency: createConcurrencyGate(LIMITS.concurrency),
        // 沙箱页面里的运行环境，和这个入口一起构建出来放在模组文件夹里。
        runtimeCode: () => (runtimeCode ??= fs.readFileSync(path.join(__dirname, 'sandbox.cjs'), 'utf8')),
        isAllowed: () => api.windows.mainWindowPresent(),
        log,
    });
    // 隐藏窗口不能在主窗口走了之后让应用活着：跟着关，下次用到再开。
    api.windows.onMainWindowChanged((present) => { if (!present) sandbox.destroy(); });
    api.onBeforeUnload(() => sandbox.destroy());
    api.onBeforeUnload(() => { for (const stream of forwarding.keys()) stream.destroy(); });

    const fetchText: CatalogFetch = async (url, options = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CATALOG_TIMEOUT_MS);
        try {
            const response = await api.net.fetch(url, {
                credentials: 'omit',
                signal: controller.signal,
                headers: { accept: 'application/json, text/plain, */*', ...(options.referer ? { referer: options.referer } : {}) },
            });
            if (!response.ok) throw new CatalogError('unavailable', `the platform answered HTTP ${response.status}`);
            const length = Number(response.headers.get('content-length'));
            if (length > MAX_CATALOG_BYTES) throw new CatalogError('invalid-response', 'the answer is too large');
            const text = await response.text();
            if (text.length > MAX_CATALOG_BYTES) throw new CatalogError('invalid-response', 'the answer is too large');
            return text;
        } catch (error) {
            if (error instanceof CatalogError) throw error;
            throw new CatalogError('network', error instanceof Error ? error.message : String(error));
        } finally {
            clearTimeout(timer);
        }
    };
    const catalog = createCatalog(fetchText);

    const publicState = async () => {
        const state = await library.state();
        return {
            scripts: state.scripts.map(record => ({
                id: record.id,
                name: record.info.name,
                version: record.info.version ?? '',
                author: record.info.author ?? '',
                fileName: record.fileName,
                platforms: Object.keys(record.sources),
            })),
            activeId: state.active?.id ?? null,
            platform: state.platform,
            platforms: state.platforms,
        };
    };

    const activeScript = async (): Promise<{ script: LxSandboxScript; record: LxScriptRecord }> => {
        const { active } = await library.state();
        const code = active ? await library.code(active.id) : null;
        if (!active || code === null) throw new CatalogError('unavailable', 'no script is imported');
        return { script: { id: active.id, code, info: active.info }, record: active };
    };

    // 签发出去的音频地址：`once` 参数 → 脚本给的真实地址。只在这次运行里有效。
    const streams = new Map<string, { url: string; expiresAt: number }>();

    /** 脚本给的地址：只收 http(s)，字面上就是本机或内网的当场拒掉（解析之后的判定在出口里）。 */
    const checkedMediaUrl = (value: unknown): string => {
        const raw = typeof value === 'string' ? value : (value as { url?: unknown } | null)?.url;
        if (typeof raw !== 'string' || raw.length > 4096) throw new CatalogError('invalid-response', 'the script returned no address');
        let url: URL;
        try {
            url = new URL(raw.trim());
        } catch {
            throw new CatalogError('invalid-response', 'the script returned something that is not an address');
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new EgressBlockedError('protocol', url.protocol);
        return url.href;
    };

    // rpc 的参数来自另一个进程，类型上写的不作数：id 要自己读。
    const idOf = (song: unknown): string => {
        const id = song && typeof song === 'object' ? (song as { id?: unknown }).id : undefined;
        return typeof id === 'string' ? id : '';
    };

    const handlers: Record<string, (...args: never[]) => Promise<unknown>> = {
        state: () => publicState(),

        async importScript() {
            const file = await api.dialog.pickFile({ filters: [{ name: 'LX Music source', extensions: ['js', 'json', 'txt'] }] });
            if (!file) return null;
            let raw: string;
            try {
                if ((await fs.promises.stat(file)).size > MAX_SCRIPT_BYTES * 2) throw new LxImportError('too-large');
                raw = await fs.promises.readFile(file, 'utf8');
            } catch (error) {
                throw error instanceof LxImportError ? error : new LxImportError('unreadable');
            }
            const code = normalizeLxScript(raw);
            validateLxScript(code);
            const fileName = path.basename(file).slice(0, 120);
            const record: LxScriptRecord = {
                id: crypto.randomUUID(),
                info: parseLxHeader(code, fileName.replace(/\.[^.]+$/, '')),
                sources: {},
                importedAt: Date.now(),
                fileName,
            };
            // 先在沙箱里跑一遍：它得声明自己支持哪几家，才算一个能用的脚本。
            let declared: unknown;
            try {
                declared = await sandbox.load({ id: record.id, code, info: record.info });
            } catch (error) {
                sandbox.destroy();
                throw new LxImportError('load-failed', error instanceof Error ? error.message : String(error));
            }
            record.sources = sanitizeDeclaredSources(declared);
            if (Object.keys(record.sources).length === 0) {
                sandbox.destroy();
                throw new LxImportError('no-platform');
            }
            try {
                await library.add(record, code);
            } catch (error) {
                sandbox.destroy();
                throw error;
            }
            return publicState();
        },

        async selectScript(id: unknown) {
            if (await library.select(String(id))) sandbox.destroy();
            return publicState();
        },

        async removeScript(id: unknown) {
            if (await library.remove(String(id))) sandbox.destroy();
            return publicState();
        },

        async setPlatform(platform: unknown) {
            if (isLxPlatform(platform)) await library.setPlatform(platform);
            return publicState();
        },

        async catalog(operation: unknown, params: unknown) {
            const input = params && typeof params === 'object' ? params as Record<string, unknown> : {};
            const limit = Math.min(Math.max(Math.trunc(Number(input.limit)) || 30, 1), MAX_PAGE);
            const offset = Math.max(Math.trunc(Number(input.offset)) || 0, 0);
            const id = typeof input.id === 'string' ? input.id : '';
            // 没导入脚本时什么都不请求：历史和歌单里留着的歌也一样（client 的 getAvailability 让宿主不来问，这里自己也守着）。
            const { platform, active } = await library.state();
            if (!active || !platform) throw new CatalogError('unavailable', 'no script is imported');
            if (operation === 'tracks') return catalog.tracks(id, limit, offset);
            if (operation === 'song') return catalog.song(id);
            const query = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '';
            if (operation === 'charts') return catalog.charts(platform);
            if (!query) return { items: [], hasMore: false };
            if (operation === 'searchSongs') return catalog.searchSongs(platform, query, limit, offset);
            if (operation === 'searchPlaylists') return catalog.searchPlaylists(platform, query, limit, offset);
            if (operation === 'searchAlbums') return catalog.searchAlbums(platform, query, limit, offset);
            throw new CatalogError('unsupported', `unknown operation ${String(operation)}`);
        },

        async audio(song: FoliumSourceSong, quality: FoliumSourceAudioQuality) {
            const parsed = parseSongId(idOf(song));
            if (!parsed) throw new CatalogError('unsupported', 'not a song of this source');
            const { script, record } = await activeScript();
            const support = record.sources[parsed.platform];
            if (!support) throw new CatalogError('unsupported', `the script does not serve ${parsed.platform}`);
            const lxQuality = pickLxQuality(QUALITY_TO_LX[quality] ?? '320k', support.qualities);
            if (!lxQuality) throw new CatalogError('unsupported', 'the script names no quality');
            const answer = await sandbox.call(script, {
                source: parsed.platform,
                action: 'musicUrl',
                info: { type: lxQuality, musicInfo: buildMusicInfo(parsed.platform, parsed.nativeId, song) },
            });
            const url = checkedMediaUrl(answer);
            // 字面上就是本机或内网的当场报出来，不等到播放器来取流才 502。
            const target = new URL(url);
            const host = target.hostname.replace(/^\[|\]$/g, '');
            const reason = hostnameBlockReason(host);
            if (reason && !allow(host, Number(target.port || (target.protocol === 'https:' ? 443 : 80)))) throw new EgressBlockedError(reason, host);
            const token = crypto.randomBytes(18).toString('base64url');
            const expiresAt = Date.now() + STREAM_TTL_MS;
            streams.set(token, { url, expiresAt });
            while (streams.size > MAX_STREAMS) streams.delete(streams.keys().next().value as string);
            return {
                url: `${api.media.url('stream', `${parsed.platform}/${lxQuality}/${encodeURIComponent(parsed.nativeId)}`)}?once=${token}`,
                quality: LX_TO_QUALITY[lxQuality],
                expiresAt,
            };
        },

        async lyric(song: FoliumSourceSong) {
            const parsed = parseSongId(idOf(song));
            if (!parsed) return null;
            const state = await library.state();
            // 没导入脚本时不联网，公开接口的歌词也不取。
            if (!state.active) return null;
            // 脚本声明了 lyric 的用脚本的（酷狗、QQ 只有这条路），否则用公开接口的；脚本答不上也退回公开接口。
            if (state.active?.sources[parsed.platform]?.actions.includes('lyric')) {
                try {
                    const { script } = await activeScript();
                    const answer = await sandbox.call(script, {
                        source: parsed.platform,
                        action: 'lyric',
                        info: { type: null, musicInfo: buildMusicInfo(parsed.platform, parsed.nativeId, song) },
                    }) as { lyric?: unknown; tlyric?: unknown; rlyric?: unknown } | null;
                    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.slice(0, 1_000_000) : '');
                    if (answer && text(answer.lyric)) {
                        return {
                            lyric: text(answer.lyric),
                            ...(text(answer.tlyric) ? { translation: text(answer.tlyric) } : {}),
                            ...(text(answer.rlyric) ? { romanization: text(answer.rlyric) } : {}),
                        };
                    }
                } catch (error) {
                    log('the script gave no lyric', error);
                }
            }
            return catalog.lyric(song.id);
        },
    };

    for (const [name, handler] of Object.entries(handlers)) {
        api.rpc.handle(name, async (...args: unknown[]): Promise<RpcResult<unknown>> => {
            try {
                return { ok: true, data: await handler(...args as never[]) };
            } catch (error) {
                return failure(error);
            }
        });
    }

    // 宿主只把 GET 交过来。失败不带正文：调用方会把收到的正文当成这首歌的音频存起来。
    const CORS = { 'access-control-allow-origin': '*' };
    const MAX_STREAM_BYTES = LIMITS.maxStreamBytes;
    // 正在转发的音频流，和各自最近一次被读的时刻。
    const forwarding = new Map<Readable, number>();
    api.media.serve('stream', async (read) => {
        const entry = streams.get(Object.hasOwn(read.query, 'once') ? read.query.once : '');
        if (!entry || entry.expiresAt < Date.now()) return { status: 410, headers: CORS, body: '' };
        try {
            const answer = await audioEgress.open({
                url: entry.url,
                headers: { 'accept-encoding': 'identity', ...(read.range ? { range: read.range } : {}) },
                timeoutMs: 20_000,
            });
            const type = (answer.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
            const length = Number(answer.headers['content-length']);
            // 取不到的歌有的平台回一张网页（200）：那不是音频。只认音频、视频容器和没说类型的二进制；大得离谱的也不要。
            const isMedia = type === '' || type.startsWith('audio/') || type.startsWith('video/') || type === 'application/octet-stream' || type === 'application/ogg';
            if ((answer.statusCode !== 200 && answer.statusCode !== 206) || !isMedia || (Number.isFinite(length) && length > MAX_STREAM_BYTES)) {
                answer.stream.destroy();
                return { status: answer.statusCode === 416 ? 416 : 502, headers: CORS, body: '' };
            }
            const headers: Record<string, string> = {
                ...CORS, 'content-type': type || 'application/octet-stream', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
            };
            for (const name of ['content-length', 'content-range']) {
                if (answer.headers[name]) headers[name] = answer.headers[name];
            }
            // 满了就关掉最久没人读的那条：正在放的那首一直有人读，被丢下的（播放器没告诉我们它不要了的）才会排到最前。
            while (forwarding.size >= LIMITS.maxStreams) {
                const [stale] = [...forwarding.entries()].reduce((oldest, each) => (each[1] < oldest[1] ? each : oldest));
                forwarding.delete(stale);
                stale.destroy(new Error('too many audio streams at once'));
            }
            const body = guardStream(answer.stream, {
                maxBytes: MAX_STREAM_BYTES,
                idleMs: LIMITS.streamIdleMs,
                onRead: () => { forwarding.set(body, performance.now()); },
                onClose: (reason) => {
                    forwarding.delete(body);
                    if (reason === 'idle' || reason === 'too-large') log(`audio stream cut (${reason})`);
                },
            });
            forwarding.set(body, performance.now());
            return { status: answer.statusCode, headers, body };
        } catch (error) {
            log('audio stream failed', error instanceof EgressBlockedError ? error.message : error);
            // 太快了的让播放器稍后再来，别的照取不到算。
            return { status: error instanceof RateLimitedError ? 429 : 502, headers: CORS, body: '' };
        }
    });
}
