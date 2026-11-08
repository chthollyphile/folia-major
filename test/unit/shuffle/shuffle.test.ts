import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Mt19937, MathRng, createRng, parseRngKind, type Rng } from '../../../src/utils/shuffle/rng';
import { computeShuffledQueue, fisherYates, parseStrategy, sanitizeHistory, type HistoryEntry, type ShuffleInput } from '../../../src/utils/shuffle/algorithms';
import { recordHistory } from '../../../src/utils/shuffle/history';
import { queueFingerprint } from '../../../src/utils/shuffle/round';

// test/unit/shuffle/shuffle.test.ts
// 洗牌算法库单元测试（由 v0.7.21+洗牌 的 node:test 版迁移到 Vitest）：MT19937 标准向量、四策略语义、队列指纹与边界。

type Song = { id: string };
const ids = (n: number): Song[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
const keyOf = (s: Song): string => s.id;
const base = (
    queue: readonly Song[],
    cur: number,
    rng: Rng = new Mt19937([1, 2, 3, 4]),
    extra: Partial<ShuffleInput<Song>> = {},
): ShuffleInput<Song> => ({ queue, currentIndex: cur, keyOf, history: [], rng, now: 1_000_000_000, ...extra });
const seedHexOf = (rng: Mt19937): string => {
    const hex = rng.seedHex;
    assert.ok(hex);
    return hex;
};

test('T1a MT19937 KAT init_genrand(5489)', () => {
    const r = new Mt19937(5489);
    assert.deepEqual([0, 1, 2, 3, 4].map(() => r.nextUint32()), [3499211612, 581869302, 3890346734, 3586334585, 545404204]);
});
test('T1b MT19937 第 10000 个输出 (seed 5489) = 4123659995', () => {
    const r = new Mt19937(5489); let v = 0;
    for (let i = 0; i < 10000; i++) v = r.nextUint32();
    assert.equal(v, 4123659995);
});
test('T1c MT19937 KAT init_by_array({0x123,0x234,0x345,0x456})', () => {
    const r = new Mt19937([0x123, 0x234, 0x345, 0x456]);
    assert.deepEqual([0, 1, 2, 3, 4].map(() => r.nextUint32()), [1067595299, 955945823, 477289528, 4107218783, 4228976476]);
});
test('T2 seedHex 往返：随机种子 / 数组种子可复现；数值种子不导出 seedHex', () => {
    const a = new Mt19937(), b = Mt19937.fromHex(seedHexOf(a));
    for (let i = 0; i < 100; i++) assert.equal(a.nextUint32(), b.nextUint32());
    assert.equal(seedHexOf(a).length, 32);
    const c = new Mt19937([0x123, 0x234]), d = Mt19937.fromHex(seedHexOf(c));
    for (let i = 0; i < 100; i++) assert.equal(c.nextUint32(), d.nextUint32());
    assert.equal(new Mt19937(5489).seedHex, undefined);
    assert.throws(() => Mt19937.fromHex('xyz'));
});
test('T3 nextIndex(3) 偏差 < 0.5%', () => {
    const r = new Mt19937([9]); const c = [0, 0, 0]; const T = 3_000_000;
    for (let i = 0; i < T; i++) c[r.nextIndex(3)]++;
    for (const x of c) assert.ok(Math.abs(x / T - 1 / 3) / (1 / 3) < 0.005);
});
test('T4 5 首排列均匀 χ² < 157.81 (df=119,p=.01)', () => {
    const r = new Mt19937([5]); const m = new Map<string, number>(); const T = 120000;
    for (let i = 0; i < T; i++) { const k = fisherYates([0, 1, 2, 3, 4], r).join(''); m.set(k, (m.get(k) ?? 0) + 1); }
    assert.equal(m.size, 120);
    const e = T / 120; let chi = 0; for (const v of m.values()) chi += (v - e) ** 2 / e;
    assert.ok(chi < 157.81, `chi2=${chi}`);
});
test('T5 置换性 + T6 不可变', () => {
    const q = ids(50); const snap = JSON.stringify(q);
    for (const s of ['fisher-yates', 'round', 'fewer-repeats', 'weighted'] as const) {
        const out = computeShuffledQueue(s, base(q, 7)).nextQueue;
        assert.deepEqual(out.map(keyOf).sort(), q.map(keyOf).sort(), s);
        assert.equal(out[0].id, 's7', `${s} 当前歌钉首`);
    }
    assert.equal(JSON.stringify(q), snap);
});
test('T8 B1 重复 key 不丢歌', () => {
    const q = [{ id: 'a' }, { id: 'a' }, { id: 'b' }, { id: 'c' }];
    for (const s of ['fisher-yates', 'round', 'fewer-repeats', 'weighted'] as const) {
        const out = computeShuffledQueue(s, base(q, 0)).nextQueue;
        assert.equal(out.length, 4, s);
    }
});
test('T9 性能观察：1000 首平均 < 10ms（依赖机器，非 CI 硬门禁；失败先重跑再排查）', () => {
    const q = ids(1000); const t0 = performance.now();
    for (let i = 0; i < 100; i++) computeShuffledQueue('fewer-repeats', base(q, 0));
    assert.ok((performance.now() - t0) / 100 < 10);
});
test('T10 round：中途洗牌未播在前；播完自动重置', () => {
    const q = ids(10);
    const played = new Set(['s0', 's1', 's2', 's3']);
    const out = computeShuffledQueue('round', base(q, 3, undefined, { playedThisRound: played }));
    const keys = out.nextQueue.map(keyOf);
    assert.equal(out.resetRound, undefined);
    const firstUnplayedBlock = keys.slice(1, 1 + 6);
    assert.ok(firstUnplayedBlock.every(k => !played.has(k) || k === 's3') && !firstUnplayedBlock.some(k => ['s0', 's1', 's2'].includes(k)));
    const all = new Set(q.map(keyOf));
    const out2 = computeShuffledQueue('round', base(q, 9, undefined, { playedThisRound: all }));
    assert.equal(out2.resetRound, true);
    const resetPlayed = out2.nextPlayedThisRound;
    assert.ok(resetPlayed);
    assert.deepEqual([...resetPlayed], ['s9']);
    assert.equal(out2.nextQueue.length, 10);
});
test('T10b round：连播 100 轮每轮无重复', () => {
    let q: Song[] = ids(8); let played = new Set<string>(); let cur = 0; const rng = new Mt19937([7]);
    for (let round = 0; round < 100; round++) {
        const out = computeShuffledQueue('round', base(q, cur, rng, { playedThisRound: played }));
        q = out.nextQueue;
        const nextPlayed = out.nextPlayedThisRound;
        assert.ok(nextPlayed);
        played = nextPlayed;
        const seq: string[] = [q[0].id];
        for (let i = 1; i < q.length; i++) { played.add(q[i].id); seq.push(q[i].id); }
        assert.equal(new Set(seq).size, q.length);
        cur = q.length - 1;
    }
});
test('T11 weighted：权重 1:9 → 重者排首约 90%', () => {
    const now = 1e12, TAU = 30 * 60_000; const q = ids(2); const r = new Mt19937([11]); let heavy = 0; const T = 100000;
    const history = [{ k: 's0', t: now }, { k: 's1', t: now - 8 * TAU }]; // w0=1, w1=9
    for (let i = 0; i < T; i++) if (computeShuffledQueue('weighted', base(q, -1, r, { history, now })).nextQueue[0].id === 's1') heavy++;
    assert.ok(Math.abs(heavy / T - 0.9) < 0.02, String(heavy / T));
});
test('T12 fewer-repeats 语义：fresh 在前，deferred 最久未听在前', () => {
    const q = ids(10);
    const history = [{ k: 's9', t: 100 }, { k: 's8', t: 200 }, { k: 's7', t: 300 }]; // W=min(3,8)=3
    const out = computeShuffledQueue('fewer-repeats', base(q, 0, undefined, { history }));
    assert.deepEqual(out.nextQueue.slice(-3).map(keyOf), ['s9', 's8', 's7']);
    assert.deepEqual(out.stats, { fresh: 6, deferred: 3, recentWindow: 3 });
});
test('T13 B2 fresh<2 时 deferred 不是确定顺序', () => {
    const q = ids(6); const now = 1e12;
    const history = q.map((s, i) => ({ k: s.id, t: now - (i + 1) * 60_000 }));
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(computeShuffledQueue('fewer-repeats', base(q, 0, new Mt19937([i]), { history, now })).nextQueue.map(keyOf).join());
    assert.ok(seen.size > 1);
});
test('T14 recordHistory：去重、上限 300、fisher-yates 不调用时历史不变', () => {
    const q = ids(5); const h = recordHistory(q, 3, keyOf, [], 1000);
    assert.deepEqual(h.map(x => x.k), ['s0', 's1', 's2', 's3']);
    assert.deepEqual(recordHistory(q, 3, keyOf, h, 2000), h);
    const big = Array.from({ length: 400 }, (_, i) => ({ k: `x${i}`, t: i }));
    assert.equal(recordHistory(q, 1, keyOf, big, 1).length, 300);
});
test('U 边界：空队列 / 单曲 / 损坏历史 / 非法设置值', () => {
    const corruptedHistory = [null, { k: 1, t: 'x' }, { k: 's1', t: NaN }] as unknown as HistoryEntry[];
    for (const s of ['fisher-yates', 'round', 'fewer-repeats', 'weighted'] as const) {
        assert.deepEqual(computeShuffledQueue(s, base([], -1)).nextQueue, []);
        assert.equal(computeShuffledQueue(s, base(ids(1), 0)).nextQueue.length, 1);
        assert.equal(computeShuffledQueue(s, base(ids(5), 2, undefined, { history: corruptedHistory })).nextQueue.length, 5);
    }
    assert.equal(parseStrategy('bogus'), 'fisher-yates');
    assert.equal(parseRngKind(undefined), 'mt19937');
    assert.throws(() => new Mt19937([1]).nextIndex(0));
});
test('F1-new math 档：与旧循环直写完全一致，且每次恰消耗 1 次 Math.random', () => {
    const lcg = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const real = Math.random; const items = Array.from({ length: 100 }, (_, i) => i);
    try {
        let calls = 0; const gen1 = lcg(42); Math.random = () => { calls++; return gen1(); };
        const viaRng = fisherYates(items, new MathRng());
        assert.equal(calls, 99);
        const gen2 = lcg(42); Math.random = gen2;
        const a = items.slice();
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        assert.deepEqual(viaRng, a);
    } finally { Math.random = real; }
});
test('F7-new MathRng 与 Mt19937 的 nextIndex 是两套独立路径', () => {
    const mathRng = new MathRng();
    const mtRng = new Mt19937([1]);
    assert.notEqual(mathRng.nextIndex.bind(mathRng), mtRng.nextIndex.bind(mtRng));
    const real = Math.random; let calls = 0;
    try { Math.random = () => { calls++; return 0.5; }; mtRng.nextIndex(10); assert.equal(calls, 0); }
    finally { Math.random = real; }
    assert.equal(createRng('math').name, 'math');
    assert.equal(createRng('mt19937').name, 'mt19937');
});

test('T15 recordHistory 默认：已存在 key 不刷新（旧版语义）', () => {
    const q = ids(3); let h = recordHistory(q, 2, keyOf, [], 1000);
    const before = JSON.stringify(h); h = recordHistory(q, 0, keyOf, h, 9_000_000);
    assert.equal(JSON.stringify(h), before);
});
test('T16 recordHistory refresh：重复播放刷新时间戳并移到末尾，仍去重', () => {
    const q = ids(3); let h = recordHistory(q, 2, keyOf, [], 1000, { refresh: true });
    h = recordHistory(q, 0, keyOf, h, 9_000_000, { refresh: true });
    assert.deepEqual(h.map(x => x.k), ['s1', 's2', 's0']);
    assert.equal(h[2].t, 9_000_000);
    assert.equal(new Set(h.map(x => x.k)).size, h.length);
});
test('T17 sanitizeHistory：同 key 保留最后一条（与 Map 后写覆盖一致）', () => {
    const h = sanitizeHistory([{ k: 'a', t: 1 }, { k: 'b', t: 2 }, { k: 'a', t: 3 }]);
    assert.deepEqual(h, [{ k: 'b', t: 2 }, { k: 'a', t: 3 }]);
});
test('T18 队列指纹：增删/替换/换来源变化，纯换序不变，key 边界不撞车', () => {
    const f = (ks: string[], src = 'x') => queueFingerprint(ks, k => k, src);
    const baseFingerprint = f(['a', 'b', 'c', 'd']);
    assert.equal(f(['a', 'c', 'b', 'd']), baseFingerprint);        // 仅换序
    assert.equal(f(['d', 'c', 'b', 'a']), baseFingerprint);
    assert.notEqual(f(['a', 'b', 'z', 'd']), baseFingerprint);      // 中部替换
    assert.notEqual(f(['a', 'b', 'c']), baseFingerprint);           // 删除
    assert.notEqual(f(['a', 'b', 'c', 'd', 'd']), baseFingerprint); // 重复条目增加
    assert.notEqual(f(['a', 'b', 'c', 'd'], 'y'), baseFingerprint); // 来源
    assert.notEqual(f(['ab', 'c']), f(['a', 'bc']));
});
test('T19 weighted 对数键与 NEVER 权重：从未播放的歌排在已播之前', () => {
    const q = ids(4); const now = 1e12; const r = new Mt19937([3]);
    for (let i = 0; i < 200; i++) {
        const out = computeShuffledQueue('weighted', base(q, -1, r, { history: [{ k: 's0', t: now }, { k: 's1', t: now }], now })).nextQueue.map(keyOf);
        assert.deepEqual(out.slice(0, 2).sort(), ['s2', 's3']);
    }
});
