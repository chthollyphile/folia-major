/**
 * 队列指纹：来源 + 长度 + 全部 key 排序后的哈希。
 * - 增删/替换任何一首、换来源 → 指纹变 → 必须重置本轮已播集合
 * - 仅换顺序（含 round 自己洗牌、用户拖动）→ 指纹不变 → 已播集合保留
 */
export function queueFingerprint<T>(queue: readonly T[], keyOf: (s: T) => string, source: string): string {
    const keys = queue.map(keyOf).sort();
    let h = 0x811c9dc5;                      // FNV-1a 32 位
    for (const k of keys) {
        for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
        h = Math.imul(h ^ 0xff, 0x01000193);   // key 分隔符，防止 ["ab","c"] 与 ["a","bc"] 撞车
    }
    return `${source}|${queue.length}|${(h >>> 0).toString(16)}`;
}
