import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/qq/qqClient.test.ts
// QQ 音乐音源模组的 client 入口（sources/qq/client/index.ts）交回的 disposer：模组停用时，core 模块里每小时一次的会话
// 续期定时器跟着停，不再去问已经关掉的端口，也不会把只用于匹配的音源的后端拉起来。folium 是替身。

const HOUR = 60 * 60 * 1000;

afterEach(() => {
    vi.useRealTimers();
});

describe('QQ client entry', () => {
    it('hands back a disposer that stops the hourly session refresh', async () => {
        vi.useFakeTimers();
        vi.resetModules();
        const { default: activate } = await import('../../../sources/qq/client/index');
        const { keepQqSessionFresh } = await import('../../../sources/qq/core/qqSessionRefresh');
        const calls: unknown[][] = [];
        const page = new Map<string, unknown>([['cookie', 'uin=1; qm_keyst=fixture']]);
        const folium = {
            modId: 'qq',
            rpc: {
                call: vi.fn(async (...args: unknown[]) => { calls.push(args); throw new Error('closed'); }),
                on: () => () => undefined,
            },
            i18n: { key: (key: string) => key, text: (key: string) => key },
            sources: {
                register: () => () => undefined,
                error: (code: string, message: string) => Object.assign(new Error(message), { code }),
                pageStore: () => ({
                    get: (key: string) => page.get(key),
                    set: (key: string, value: unknown) => { page.set(key, value); },
                    delete: (key: string) => { page.delete(key); },
                    has: (key: string) => page.has(key),
                }),
            },
            lyrics: { isPureMusicText: () => false },
        };
        const dispose = activate(folium as never);
        expect(dispose).toBeTypeOf('function');

        keepQqSessionFresh();
        await vi.advanceTimersByTimeAsync(HOUR);
        const whileRunning = calls.length;
        expect(whileRunning).toBeGreaterThan(0);

        dispose();
        calls.length = 0;
        await vi.advanceTimersByTimeAsync(3 * HOUR);
        expect(calls).toEqual([]);
    });
});
