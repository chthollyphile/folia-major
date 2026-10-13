import { describe, expect, it } from 'vitest';
import { dedupedRequest } from '@/utils/requestDedup';

// test/unit/utils/requestDedup.test.ts
// 这个模块是并行请求共享的：key 会不会被清干净，直接决定同 URL 的**后续**请求
// 是重新发一次、还是永远拿到第一次那份（哪怕它已经失败了）。

describe('dedupedRequest', () => {
    it('shares one in-flight promise between concurrent callers', async () => {
        let calls = 0;
        const factory = () => {
            calls += 1;
            return new Promise<string>(resolve => setTimeout(() => resolve('ok'), 20));
        };

        const [a, b] = await Promise.all([
            dedupedRequest('k', factory),
            dedupedRequest('k', factory),
        ]);
        expect(a).toBe('ok');
        expect(b).toBe('ok');
        expect(calls).toBe(1);
    });

    it('clears the key after success so later requests fire again', async () => {
        let calls = 0;
        const factory = () => { calls += 1; return Promise.resolve(calls); };
        const first = await dedupedRequest('k2', factory);
        const second = await dedupedRequest('k2', factory);
        expect(first).toBe(1);
        expect(second).toBe(2);
    });

    it('clears the key after failure so a retry can succeed', async () => {
        let calls = 0;
        const factory = () => {
            calls += 1;
            return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('recovered');
        };

        await expect(dedupedRequest('k3', factory)).rejects.toThrow('boom');
        await expect(dedupedRequest('k3', factory)).resolves.toBe('recovered');
        expect(calls).toBe(2);
    });

    it('does not share results across different keys', async () => {
        const a = await dedupedRequest('a', () => Promise.resolve('A'));
        const b = await dedupedRequest('b', () => Promise.resolve('B'));
        expect(a).toBe('A');
        expect(b).toBe('B');
    });
});
