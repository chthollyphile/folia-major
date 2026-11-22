import { Readable } from 'node:stream';

// sources/lxmusic/main/rateLimit.ts
// 出口的三道限制，都是为了让一个导入的脚本没法把这台机器当成发请求的工具，也没法拿一个不肯结束的回答占住宿主：
//   - createRateGate：每秒请求数（令牌桶），按目标主机一个桶、整个模组一个桶。出口的每一跳（含跳转、含音频转发）
//     过一次。桶空了就等，等的时间算在这次请求自己的时限里；要等得太久就直接拒绝。
//   - createConcurrencyGate：同时在途的 lx.request，按目标主机和整个模组各有上限，超了排队，队满了拒绝。
//   - guardStream：音频转发的回答按字节截断、上游迟迟不来数据就断。
// 数值和依据写在下面的 LIMITS 和 README 的「限制」一节。

/**
 * 出口的限制，main 入口照这张表建闸。依据：正常的脚本取一首歌的地址发 1 到 3 个请求（少数带重试的到 5 个），播放器会预取
 * 下一首；连着切十首歌也就三十来个请求、分散在两三个主机上。音频这边，一首歌是播放器的一条流加缓存的一条流，
 * 拖动时再多几个带 Range 的请求。搜歌、榜单、公开接口的歌词不走出口，不在这里算。
 *   - 每秒请求数：一个主机一口气 20 个、之后每秒 2 个；整个模组一口气 40 个、之后每秒 4 个。正常用法碰不到
 *     「之后」那一档；一直按上限发，一小时也就一万四千个，当不了像样的刷量工具。要等超过 10 秒的直接拒绝。
 *   - 同时在途的 lx.request：一个主机 4 个，整个模组 8 个，再多的排队，队里最多 16 个。
 *   - 同时转发的音频流：8 条（当前这首和预取的下一首各两条，再留一倍的余量）；满了关掉最久没人读的那条。
 *     音频转发有自己的一套每秒请求数的桶（audioRate）：那是播放器发起的，不和脚本的 lx.request 抢额度，也宽得多
 *     （一个主机一口气 60 个、之后每秒 10 个；整个模组一口气 120 个、之后每秒 20 个）。拖动进度条时播放器会连着发
 *     带 Range 的请求，每个请求经 CDN 的跳转是两三跳；脚本催不动播放器，它能左右的只有每个请求跳几次（最多 8 跳）。
 *   - 一条音频流最多 4 GiB：一小时的 24 bit / 192 kHz FLAC 大约 2.5 GiB。
 *   - 我们在等、上游 30 秒不来数据就断：播放器缓冲着十几秒以上的声音，30 秒足够它察觉并重新取。
 */
export const LIMITS = {
    rate: { perHost: { perSecond: 2, burst: 20 }, total: { perSecond: 4, burst: 40 }, maxWaitMs: 10_000 },
    audioRate: { perHost: { perSecond: 10, burst: 60 }, total: { perSecond: 20, burst: 120 }, maxWaitMs: 10_000 },
    concurrency: { perHost: 4, total: 8, maxQueue: 16 },
    maxStreams: 8,
    maxStreamBytes: 4 * 1024 * 1024 * 1024,
    streamIdleMs: 30_000,
};

/** 被限制拒绝（不是被拦：去处没问题，只是太多、太快）。 */
export class RateLimitedError extends Error {
    constructor(what: string) {
        super(`rate limited (${what})`);
        this.name = 'RateLimitedError';
    }
}

export interface BucketOptions {
    /** 每秒补多少个令牌：长期的请求速率。 */
    perSecond: number;
    /** 桶的容量：一口气能发多少个。 */
    burst: number;
}

export interface RateGateOptions {
    perHost: BucketOptions;
    total: BucketOptions;
    /** 最多等多久（毫秒）；要等得更久的直接拒绝，不占着位置。 */
    maxWaitMs: number;
    /** 记多少个主机的桶；多了丢掉最久没用的（丢掉的主机下次从满桶开始，所以整个模组那个桶才是兜底）。 */
    maxHosts?: number;
    now?: () => number;
}

interface Bucket {
    tokens: number;
    at: number;
}

/** 记账用的主机名：不分大小写，结尾的点不算（`example.com.` 和 `example.com` 是同一个去处）。 */
const hostKey = (hostname: string) => {
    const lower = hostname.toLowerCase();
    return lower.endsWith('.') ? lower.slice(0, -1) : lower;
};

/** 每秒请求数的闸。`take` 在轮到这次请求时 resolve；`signal` 中止了、或要等得太久，就 reject。 */
export const createRateGate = ({ perHost, total, maxWaitMs, maxHosts = 256, now = () => performance.now() }: RateGateOptions) => {
    const hosts = new Map<string, Bucket>();
    const all: Bucket = { tokens: total.burst, at: now() };

    const refill = (bucket: Bucket, options: BucketOptions, at: number) => {
        // 钟不该往回走（默认用的是单调的 performance.now）；真往回走了就当没过时间，不把桶扣成一大笔欠账。
        bucket.tokens = Math.min(options.burst, bucket.tokens + (Math.max(0, at - bucket.at) / 1000) * options.perSecond);
        bucket.at = at;
    };
    /** 再拿一个令牌要等多久（令牌可以欠着：欠的就是排在前面的请求）。 */
    const waitFor = (bucket: Bucket, options: BucketOptions) => (bucket.tokens >= 1 ? 0 : ((1 - bucket.tokens) / options.perSecond) * 1000);

    return {
        take(hostname: string, signal?: AbortSignal): Promise<void> {
            const at = now();
            const key = hostKey(hostname);
            let bucket = hosts.get(key);
            if (bucket) {
                hosts.delete(key);
            } else {
                bucket = { tokens: perHost.burst, at };
                while (hosts.size >= maxHosts) hosts.delete(hosts.keys().next().value as string);
            }
            hosts.set(key, bucket);
            refill(bucket, perHost, at);
            refill(all, total, at);
            const wait = Math.max(waitFor(bucket, perHost), waitFor(all, total));
            if (wait > maxWaitMs) return Promise.reject(new RateLimitedError('too many requests'));
            bucket.tokens -= 1;
            all.tokens -= 1;
            if (wait <= 0) return Promise.resolve();
            const taken = bucket;
            return new Promise((resolve, reject) => {
                const onAbort = () => {
                    clearTimeout(timer);
                    // 没等到就走了的把令牌还回来：不然脚本发一串一秒就超时的请求，一个都没真发出去，却能让桶一直欠着。
                    all.tokens = Math.min(total.burst, all.tokens + 1);
                    if (hosts.get(key) === taken) taken.tokens = Math.min(perHost.burst, taken.tokens + 1);
                    reject(new Error('egress request aborted'));
                };
                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, wait);
                if (signal?.aborted) onAbort();
                else signal?.addEventListener('abort', onAbort, { once: true });
            });
        },
    };
};

export type RateGate = ReturnType<typeof createRateGate>;

export interface ConcurrencyGateOptions {
    perHost: number;
    total: number;
    /** 排队的最多几个；满了的直接拒绝。 */
    maxQueue: number;
}

/**
 * 同时在途数的闸。`run` 轮到了才开始做 `work`，做完（成功或失败）让出位置。`signal` 中止时还在排队的直接离队
 * （脚本的窗口没了，它排着的请求不该再发出去，也不该占着后来者的队）。
 */
export const createConcurrencyGate = ({ perHost, total, maxQueue }: ConcurrencyGateOptions) => {
    const running = new Map<string, number>();
    let runningTotal = 0;
    const queue: Array<{ host: string; start: () => void }> = [];

    const free = (host: string) => runningTotal < total && (running.get(host) ?? 0) < perHost;
    const enter = (host: string) => {
        runningTotal += 1;
        running.set(host, (running.get(host) ?? 0) + 1);
    };
    const leave = (host: string) => {
        runningTotal -= 1;
        const left = (running.get(host) ?? 1) - 1;
        if (left > 0) running.set(host, left);
        else running.delete(host);
        // 让出的位置给队里第一个能走的（它的主机也有空位的）。
        // 名额在这里就替它记上：等它被叫醒再记的话，同一拍里离开的两个会把同一个空位各放行一次。
        const next = queue.findIndex(entry => free(entry.host));
        if (next >= 0) {
            const [entry] = queue.splice(next, 1);
            enter(entry.host);
            entry.start();
        }
    };

    return {
        async run<T>(hostname: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
            const host = hostKey(hostname);
            if (signal?.aborted) throw new Error('egress request aborted');
            if (free(host)) {
                enter(host);
            } else {
                if (queue.length >= maxQueue) throw new RateLimitedError('too many requests at once');
                await new Promise<void>((resolve, reject) => {
                    const entry = {
                        host,
                        start: () => {
                            signal?.removeEventListener('abort', onAbort);
                            resolve();
                        },
                    };
                    const onAbort = () => {
                        const index = queue.indexOf(entry);
                        if (index >= 0) queue.splice(index, 1);
                        reject(new Error('egress request aborted'));
                    };
                    signal?.addEventListener('abort', onAbort, { once: true });
                    queue.push(entry);
                });
            }
            try {
                return await work();
            } finally {
                leave(host);
            }
        },
        /** 在途的和排队的个数（测试看）。 */
        size: () => ({ running: runningTotal, queued: queue.length }),
    };
};

export interface StreamGuardOptions {
    /** 最多转发多少字节；到了就断。 */
    maxBytes: number;
    /** 我们在等上游、上游多久不来数据就断（毫秒）。下游自己不读（播放器缓冲满了、暂停了）不算。 */
    idleMs: number;
    /** 下游每来要一次数据叫一次（调用方拿它知道哪条流最近还有人读）。 */
    onRead?: () => void;
    /** 结束时（读完、出错、被下游丢弃）叫一次。 */
    onClose?: (reason: 'end' | 'too-large' | 'idle' | 'error' | 'cancelled') => void;
}

/**
 * 把上游的回答包一层再交出去：数字节、看空闲。空闲只在「下游要数据、上游不给」时计：播放器缓冲够了会停下不读，
 * 那段时间上游被暂停，不是它慢。
 */
export const guardStream = (upstream: Readable, { maxBytes, idleMs, onRead, onClose }: StreamGuardOptions): Readable => {
    let bytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const close = (reason: Parameters<NonNullable<StreamGuardOptions['onClose']>>[0]) => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        onClose?.(reason);
    };
    const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            close('idle');
            upstream.destroy();
            guarded.destroy(new Error('the audio source sent nothing for too long'));
        }, idleMs);
    };
    const guarded = new Readable({
        read() {
            // 下游要数据了：让上游接着流，从现在起计空闲。
            if (closed) return;
            onRead?.();
            arm();
            upstream.resume();
        },
        destroy(error, callback) {
            close(error ? 'error' : 'cancelled');
            upstream.destroy();
            callback(error);
        },
    });
    upstream.pause();
    upstream.on('data', (chunk: Buffer) => {
        if (closed) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
            close('too-large');
            upstream.destroy();
            guarded.destroy(new Error('the audio answer is larger than the limit'));
            return;
        }
        if (guarded.push(chunk)) {
            arm();
        } else {
            // 下游满了：停下上游，也不再计空闲，等下一次 read()。
            clearTimeout(timer);
            upstream.pause();
        }
    });
    upstream.on('end', () => {
        close('end');
        guarded.push(null);
    });
    upstream.on('error', (error) => {
        close('error');
        guarded.destroy(error);
    });
    upstream.on('close', () => {
        // 上游没说 end 就关了（对端断开）：照错误交代，免得下游把半首歌当成整首。
        if (!closed) {
            close('error');
            guarded.destroy(new Error('the audio source closed the connection'));
        }
    });
    return guarded;
};
