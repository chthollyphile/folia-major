// src/services/onlineMusic/lxmusic/lxRace.ts
// 「谁先给出能用的结果就用谁」。
//
// 洛雪音源的现实是：导进来一堆源，其中只有少数还活着（后端 404、签名过期、接口改了都很常见）。
// 串行一个个试的最坏情况是「每个死源都等到超时」，一首歌要等十几秒 —— 用户听到的就是「太慢了」。
//
// 这里用带错峰发射的竞速（hedged requests）：
//   · 先发 2 个，谁先交出可用的地址谁赢，其余结果直接丢弃；
//   · 每 300ms 再补发一个，直到有结果或候选发完；
//   · 同时在跑的请求不超过 4 个（别把手机和对方接口打爆）。
// 结果是：好源 200ms 就出歌，坏源最多拖慢一个错峰间隔，而不是拖慢整首歌。

export interface LxRaceTask<T> {
    /** 日志里看得懂的名字（音源名 / 平台）。 */
    label: string;
    /** 越小越先发。用不上就是 0（默认按列出的顺序）。 */
    priority?: number;
    run: () => Promise<T | null>;
}

export interface LxRaceOptions {
    /** 一开始同时发几个。 */
    initial?: number;
    /** 之后每隔多久补发一个。 */
    staggerMs?: number;
    /** 同时在跑的上限。 */
    maxConcurrent?: number;
}

/**
 * 并发竞速。第一个非空结果胜出；全部空/出错则返回 null。
 * 落败的请求不会被取消（音源脚本里没有取消语义），但它们的结果会被丢弃。
 */
export const raceCandidates = <T>(
    tasks: readonly LxRaceTask<T>[],
    options: LxRaceOptions = {},
): Promise<T | null> => {
    const initial = Math.max(1, options.initial ?? 2);
    const staggerMs = Math.max(50, options.staggerMs ?? 300);
    const maxConcurrent = Math.max(initial, options.maxConcurrent ?? 4);

    if (tasks.length === 0) return Promise.resolve(null);

    return new Promise<T | null>((resolve) => {
        let settled = false;
        let next = 0;
        let running = 0;
        let staggerTimer: number | null = null;

        const stopTimer = () => {
            if (staggerTimer !== null) {
                window.clearInterval(staggerTimer);
                staggerTimer = null;
            }
        };
        const finish = (value: T | null) => {
            if (settled) return;
            settled = true;
            stopTimer();
            resolve(value);
        };

        const launch = () => {
            if (settled) return;
            if (next >= tasks.length) {
                if (running === 0) finish(null);
                return;
            }
            if (running >= maxConcurrent) return;
            const task = tasks[next];
            next += 1;
            running += 1;
            void Promise.resolve()
                .then(task.run)
                .then((value) => {
                    if (value != null) finish(value);
                })
                .catch((error) => {
                    console.warn(`[lx] ${task.label} 取地址失败：`, error);
                })
                .then(() => {
                    running -= 1;
                    if (settled) return;
                    if (running === 0 && next >= tasks.length) {
                        finish(null);
                        return;
                    }
                    // 空出位置就立刻补一个，不必等下一个错峰点。
                    launch();
                });
        };

        for (let index = 0; index < initial && index < tasks.length; index += 1) launch();
        if (settled || next >= tasks.length) return;
        staggerTimer = window.setInterval(() => {
            if (settled) {
                stopTimer();
                return;
            }
            if (next >= tasks.length) {
                stopTimer();
                if (running === 0) finish(null);
                return;
            }
            launch();
        }, staggerMs);
    });
};

/** 给单个任务套超时：到点算「没结果」，不阻塞别人，也不至于让整首歌卡死。 */
export const withTimeout = <T>(work: Promise<T | null>, ms: number): Promise<T | null> => (
    new Promise<T | null>((resolve) => {
        let done = false;
        const timer = window.setTimeout(() => {
            if (done) return;
            done = true;
            resolve(null);
        }, ms);
        void work.then(
            (value) => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                resolve(value);
            },
            () => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                resolve(null);
            },
        );
    })
);
