export type RngKind = 'mt19937' | 'math';

export interface Rng {
    readonly name: RngKind;
    /** [0, 2^32) 无符号整数 */
    nextUint32(): number;
    /** [0, n)，n 必须是 1..2^32 的整数 */
    nextIndex(n: number): number;
    /** 仅 mt19937 提供 */
    readonly seedHex?: string;
}

function assertN(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) {
        throw new RangeError(`nextIndex: invalid n=${n}`);
    }
}

/** 兼容档：与旧版 Math.floor(Math.random()*n) 同源，每次恰消耗 1 次 Math.random。禁止改成拒绝采样。 */
export class MathRng implements Rng {
    readonly name = 'math' as const;
    nextUint32(): number {
        return Math.floor(Math.random() * 0x100000000);
    }
    nextIndex(n: number): number {
        assertN(n);
        return Math.floor(Math.random() * n);
    }
}

const N = 624, M = 397, MATRIX_A = 0x9908b0df, UPPER = 0x80000000, LOWER = 0x7fffffff;

/** 无偏档：MT19937 + 拒绝采样。非密码学安全。 */
export class Mt19937 implements Rng {
    readonly name = 'mt19937' as const;
    private mt = new Uint32Array(N);
    private idx = N;
    /** 仅数组/随机种子模式有值；数值种子模式（仅供标准向量测试）为 undefined */
    private readonly words?: number[];

    /** seed 为 number → 标准 init_genrand；为 number[] → 标准 init_by_array；省略 → crypto 随机 4 个 32 位字 */
    constructor(seed?: number | number[]) {
        if (typeof seed === 'number') {
            this.initGenrand(seed >>> 0);   // 仅供 KAT 测试；不产生 seedHex，避免与 fromHex（数组模式）初始化路径不一致
        } else {
            this.words = (seed ?? Mt19937.randomWords()).map(w => w >>> 0);
            this.initByArray(this.words);
        }
    }

    static randomWords(): number[] {
        const b = new Uint32Array(4);
        crypto.getRandomValues(b);
        return Array.from(b);
    }

    /** 由 seedHex 还原（每 8 个十六进制字符 = 1 个 32 位字），用于"按 seed 重放" */
    static fromHex(hex: string): Mt19937 {
        if (!/^[0-9a-f]{8,}$/i.test(hex) || hex.length % 8 !== 0) throw new Error('bad seedHex');
        const words: number[] = [];
        for (let i = 0; i < hex.length; i += 8) words.push(parseInt(hex.slice(i, i + 8), 16) >>> 0);
        return new Mt19937(words);
    }

    get seedHex(): string | undefined {
        return this.words?.map(w => w.toString(16).padStart(8, '0')).join('');
    }

    private initGenrand(s: number): void {
        this.mt[0] = s >>> 0;
        for (let i = 1; i < N; i++) {
            const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
            this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
        }
        this.idx = N;
    }

    private initByArray(key: number[]): void {
        this.initGenrand(19650218);
        let i = 1, j = 0;
        for (let k = Math.max(N, key.length); k > 0; k--) {
            const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
            // 注意括号：先异或，再加；与参考 C 实现一致
            this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
            i++; j++;
            if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
            if (j >= key.length) j = 0;
        }
        for (let k = N - 1; k > 0; k--) {
            const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
            this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
            i++;
            if (i >= N) { this.mt[0] = this.mt[N - 1]; i = 1; }
        }
        this.mt[0] = 0x80000000;
        this.idx = N;
    }

    private generate(): void {
        for (let k = 0; k < N; k++) {
            const y = (this.mt[k] & UPPER) | (this.mt[(k + 1) % N] & LOWER);
            this.mt[k] = (this.mt[(k + M) % N] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
        }
        this.idx = 0;
    }

    nextUint32(): number {
        if (this.idx >= N) this.generate();
        let y = this.mt[this.idx++];
        y ^= y >>> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= y >>> 18;
        return y >>> 0;
    }

    nextIndex(n: number): number {
        assertN(n);
        const limit = 0x100000000 - (0x100000000 % n);
        let x: number;
        do { x = this.nextUint32(); } while (x >= limit);
        return x % n;
    }
}

export function createRng(kind: RngKind, seed?: number | number[]): Rng {
    return kind === 'math' ? new MathRng() : new Mt19937(seed);
}

/** 设置值 → 合法 RngKind，非法回落 mt19937 */
export function parseRngKind(v: unknown): RngKind {
    return v === 'math' || v === 'mt19937' ? v : 'mt19937';
}
