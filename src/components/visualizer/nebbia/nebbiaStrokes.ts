// src/components/visualizer/nebbia/nebbiaStrokes.ts
// 中日文的笔顺：AnimCJK 的笔画中线（1024 方格、y 向下），构建时由 dev/nebbia/nebbiaStrokesPlugin.mjs 生成成产物根目录的
// nebbia-strokes.json，授权文本随附在 licenses/nebbia-strokes/。
// @note 数据是 Arphic Public License（AnimCJK 的 graphics 文本文件只给了 APL），随应用分发并附授权文本，但不进仓库：每次构建从钉死的 AnimCJK commit 下载生成。
// 运行时按需读一次；读不到（构建时下载失败、FOLIA_NEBBIA_STROKES=off）就是 null，所有字退回字体骨架追踪（nebbiaSkeleton.ts），笔顺是估的。

export type NebbiaStrokeData = Record<string, [number, number][][]>;

// 在产物根目录：网页版 BASE_URL 是 /，Electron 是 ./（相对 index.html）
const STROKES_URL = `${import.meta.env.BASE_URL}nebbia-strokes.json`;
let loading: Promise<NebbiaStrokeData | null> | null = null;
let loaded: NebbiaStrokeData | null = null;

/** 读笔顺数据，只读一次；失败不重试，整个会话都用骨架。 */
export const loadNebbiaStrokes = (): Promise<NebbiaStrokeData | null> => {
    if (!loading) {
        loading = fetch(STROKES_URL)
            .then(response => (response.ok ? response.json() as Promise<NebbiaStrokeData> : null))
            .catch(() => null)
            .then(data => {
                loaded = data && typeof data === 'object' ? data : null;
                return loaded;
            });
    }
    return loading;
};

/** 已经读到的一个字的笔画中线；没读到、没有这个字时 null。 */
export const getNebbiaStrokeMedians = (ch: string): [number, number][][] | null => loaded?.[ch] ?? null;
