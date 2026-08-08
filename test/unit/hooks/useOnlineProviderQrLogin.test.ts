import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/useOnlineProviderQrLogin.test.ts
// 仓库的 vitest 跑在 node 环境上，既没有 jsdom 也没有 testing-library，为了一个 hook 引进
// 整套渲染依赖等于改动上游的测试基建。被测 hook 只用到 useState / useRef / useCallback /
// useEffect 四个，这里就地复刻一个最小运行时来驱动真实的 hook，不改任何生产代码的形状。

const runtime = vi.hoisted(() => ({
    slots: [] as { current: any }[],
    cursor: 0,
    effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', () => ({
    useRef: (initial: unknown) => {
        const index = runtime.cursor++;
        runtime.slots[index] ??= { current: initial };
        return runtime.slots[index];
    },
    useState: (initial: unknown) => {
        const index = runtime.cursor++;
        runtime.slots[index] ??= { current: initial };
        const slot = runtime.slots[index];
        return [slot.current, (next: unknown) => {
            slot.current = typeof next === 'function' ? next(slot.current) : next;
        }];
    },
    // 被测 hook 的两个 useCallback 依赖数组都是稳定的（`[]` 与 `[providerId, stopChecking]`），
    // 直接回原函数即可复刻它在 React 下的身份不变性。
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void)) => { runtime.effects.push(effect); },
}));

const omniMock = vi.hoisted(() => ({
    getProviderCapabilities: vi.fn(),
    createQrLogin: vi.fn(),
    checkQrLogin: vi.fn(),
    cancelQrLogin: vi.fn(),
    getQrTtlMs: vi.fn(),
}));

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

import { useOnlineProviderQrLogin } from '@/hooks/useOnlineProviderQrLogin';
import type { OnlineProviderId } from '@/types/onlineMusic';

const QR_POLL_INTERVAL_MS = 2_000;
// qqProvider 声明的二维码寿命：175 秒，比后端的 180 秒早一步。
const QR_TTL_MS = 175_000;

const onConfirmed = vi.fn();

let cleanups: Array<() => void> = [];

// 再调用一次 hook 本体就是一次 re-render：slots 保留、cursor 归零，正好复刻 React 的读取顺序。
const render = (providerId: OnlineProviderId) => {
    runtime.cursor = 0;
    runtime.effects.length = 0;
    const value = useOnlineProviderQrLogin({ providerId, onConfirmed, t: (key: string) => key });
    cleanups = runtime.effects
        .map(effect => effect())
        .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
    return value;
};

const unmount = () => cleanups.forEach(cleanup => cleanup());

describe('useOnlineProviderQrLogin', () => {
    beforeEach(() => {
        runtime.slots.length = 0;
        runtime.cursor = 0;
        runtime.effects.length = 0;
        cleanups = [];
        onConfirmed.mockReset();
        omniMock.getProviderCapabilities.mockReset().mockReturnValue({ auth: true });
        omniMock.createQrLogin.mockReset().mockResolvedValue({ key: 'qr-key-1', imageUrl: 'qr-1.png' });
        omniMock.checkQrLogin.mockReset().mockResolvedValue({ state: 'waiting' });
        omniMock.cancelQrLogin.mockReset().mockResolvedValue(undefined);
        omniMock.getQrTtlMs.mockReset().mockReturnValue(QR_TTL_MS);
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.useFakeTimers();
        // hook 走的是 window.setTimeout，node 环境下没有 window，转交给假计时器控制的全局实现。
        vi.stubGlobal('window', {
            setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms) as unknown as number,
            clearTimeout: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('cancels the session with the provider that started it, not with the hook default', async () => {
        const hook = render('netease');

        await hook.start('qq', 'wechat');

        expect(omniMock.createQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'wechat');
        expect(render('netease').qrState).toBe('waiting');

        hook.stop();

        // stopChecking 是 useCallback(..., [])，拿不到 start() 传进来的 provider：
        // 只有把 providerId 与 key 一起记在 activeSessionRef 里才知道该向谁取消。
        // 这里 hook 的默认 provider 与实际发起的 provider 刻意不同。
        expect(omniMock.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'qr-key-1');
    });

    it('sends no cancel at all when there is no session to release', () => {
        const hook = render('qq');

        hook.stop();
        hook.stop();

        // 取消必须是 keyed 的：没有活跃会话就什么都不发，绝不存在「清空全部」这条路径。
        expect(omniMock.cancelQrLogin).not.toHaveBeenCalled();
    });

    it('releases the live session when the component unmounts', async () => {
        const hook = render('qq');
        await hook.start('qq');
        render('qq');

        unmount();

        expect(omniMock.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'qr-key-1');
    });

    it('turns the QR expired and releases the session once the front-end TTL elapses', async () => {
        const hook = render('qq');
        await hook.start('qq');

        await vi.advanceTimersByTimeAsync(QR_TTL_MS - 1);
        expect(render('qq').qrState).toBe('waiting');
        const pollsBeforeExpiry = omniMock.checkQrLogin.mock.calls.length;

        await vi.advanceTimersByTimeAsync(1);

        expect(render('qq').qrState).toBe('expired');
        expect(omniMock.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'qr-key-1');

        // 过期之后不该继续空转轮询：用户看到的是可重试的「已过期」，不是一个还在转的二维码。
        await vi.advanceTimersByTimeAsync(10 * QR_POLL_INTERVAL_MS);
        expect(omniMock.checkQrLogin.mock.calls.length).toBe(pollsBeforeExpiry);
    });

    it('runs no front-end timer for a provider that declares no QR lifetime', async () => {
        omniMock.getQrTtlMs.mockReturnValue(null);
        const hook = render('netease');

        await hook.start('netease');
        await vi.advanceTimersByTimeAsync(4 * QR_TTL_MS);

        // netease / kugou 的二维码寿命我们无从得知，仍旧只认后端报出的过期状态：
        // 本 PR 不该把一个还有效的二维码判成过期。
        expect(render('netease').qrState).toBe('waiting');
        expect(omniMock.cancelQrLogin).not.toHaveBeenCalled();
    });

    it('keeps exactly one active session when start runs twice, e.g. on a login-method switch', async () => {
        omniMock.createQrLogin
            .mockResolvedValueOnce({ key: 'qr-key-1', imageUrl: 'qr-1.png' })
            .mockResolvedValueOnce({ key: 'qr-key-2', imageUrl: 'qr-2.png' });
        const hook = render('qq');

        await hook.start('qq', 'mobile');
        await hook.start('qq', 'wechat');

        expect(omniMock.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'qr-key-1');
        expect(render('qq').qrCodeImg).toBe('qr-2.png');

        hook.stop();
        expect(omniMock.cancelQrLogin.mock.calls).toEqual([['qq', 'qr-key-1'], ['qq', 'qr-key-2']]);
    });

    it('hands back a session that was superseded while its request was still in flight', async () => {
        let resolveFirst: (value: { key: string; imageUrl: string }) => void = () => { };
        omniMock.createQrLogin
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
            .mockResolvedValueOnce({ key: 'qr-key-2', imageUrl: 'qr-2.png' });
        const hook = render('qq');

        const superseded = hook.start('qq');
        await hook.start('qq');
        resolveFirst({ key: 'qr-key-1', imageUrl: 'qr-1.png' });
        await superseded;

        // 连点刷新时第一轮的 key 从没被记进 activeSessionRef，不还回去就会一直占着后端到 TTL 到期。
        expect(omniMock.cancelQrLogin).toHaveBeenCalledExactlyOnceWith('qq', 'qr-key-1');
        expect(render('qq').qrCodeImg).toBe('qr-2.png');
    });

    it('clears the TTL timer on a terminal state so it cannot fire behind a closed dialog', async () => {
        omniMock.checkQrLogin.mockResolvedValue({ state: 'error', message: 'QR login failed' });
        const hook = render('qq');
        await hook.start('qq');

        await vi.advanceTimersByTimeAsync(QR_POLL_INTERVAL_MS);
        expect(render('qq').qrState).toBe('error');

        await vi.advanceTimersByTimeAsync(2 * QR_TTL_MS);

        // 计时器要是还活着，就会在这里把一个可重试的错误改写成「已过期」，还多发一次取消。
        expect(render('qq').qrState).toBe('error');
        expect(omniMock.cancelQrLogin).not.toHaveBeenCalled();
    });

    it('never cancels a confirmed session, because a poll in flight still has to read 803', async () => {
        omniMock.checkQrLogin.mockResolvedValue({ state: 'confirmed' });
        const hook = render('qq');
        await hook.start('qq');

        await vi.advanceTimersByTimeAsync(QR_POLL_INTERVAL_MS);
        expect(onConfirmed).toHaveBeenCalledExactlyOnceWith('qq');

        hook.stop();

        expect(omniMock.cancelQrLogin).not.toHaveBeenCalled();
    });
});
