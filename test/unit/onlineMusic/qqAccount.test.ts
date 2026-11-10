import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqAccount.test.ts
// QQ 音乐的会员等级：登录状态最多等 3 秒，一个账号只读一次、记住，读不到的下次检查再读。

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/qq/qqTransport', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/qq/qqTransport')>(),
    requestQq: requestMock,
}));

import { resetQqVipMemory, withQqVipType } from '@/services/onlineMusic/qq/qqAccount';

const ALICE = { id: '10001', nickname: '示例用户 A' };
const BOB = { id: '20002', nickname: '示例用户 B' };

// 一个由测试决定什么时候回答的请求。
const pending = () => {
    let answer: (value: unknown) => void = () => { };
    const promise = new Promise(resolve => { answer = resolve; });
    return { promise, answer };
};

describe('QQ membership level', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        requestMock.mockReset();
        resetQqVipMemory();
        vi.spyOn(console, 'info').mockImplementation(() => { });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('holds the login status no longer than 3 s, and keeps the level that lands later', async () => {
        const slow = pending();
        requestMock.mockReturnValueOnce(slow.promise);

        let done: unknown;
        const first = withQqVipType(ALICE).then(user => { done = user; });
        await vi.advanceTimersByTimeAsync(2_999);
        expect(done).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        await first;
        expect(done).toEqual(ALICE);

        // 读完了：下一次检查用它，不再发请求。
        slow.answer({ code: 200, isVip: true, vipLevel: 'super' });
        await vi.advanceTimersByTimeAsync(0);
        await expect(withQqVipType(ALICE)).resolves.toEqual({ ...ALICE, vipType: 2 });
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('asks a check that comes while the read is still going to wait on the same request', async () => {
        const slow = pending();
        requestMock.mockReturnValueOnce(slow.promise);

        const first = withQqVipType(ALICE);
        await vi.advanceTimersByTimeAsync(3_000);
        await first;
        const second = withQqVipType(ALICE);
        slow.answer({ code: 200, isVip: true, vipLevel: 'green' });

        await expect(second).resolves.toEqual({ ...ALICE, vipType: 1 });
        expect(requestMock).toHaveBeenCalledTimes(1);
    });

    // 读不到时用这个账号上次读到的：没读到过就是没有等级；下一次检查再读。
    it('gives no level where the read failed, and reads again on the next check', async () => {
        requestMock
            .mockRejectedValueOnce(new Error('upstream'))
            .mockResolvedValueOnce({ code: 200, isVip: true, vipLevel: 'green' });

        await expect(withQqVipType(ALICE)).resolves.toEqual(ALICE);
        await expect(withQqVipType(ALICE)).resolves.toEqual({ ...ALICE, vipType: 1 });
        expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('drops a level that lands after the memory was cleared', async () => {
        const slow = pending();
        requestMock.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ code: 200, isVip: false, vipLevel: 'free' });

        const first = withQqVipType(ALICE);
        await vi.advanceTimersByTimeAsync(3000);
        await expect(first).resolves.toEqual(ALICE);
        resetQqVipMemory();
        slow.answer({ code: 200, isVip: true, vipLevel: 'super' });
        await vi.advanceTimersByTimeAsync(0);

        await expect(withQqVipType(ALICE)).resolves.toEqual({ ...ALICE, vipType: 0 });
        expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('reads an account once, and another account afresh', async () => {
        requestMock
            .mockResolvedValueOnce({ code: 200, isVip: false, vipLevel: 'free' })
            .mockResolvedValueOnce({ code: 200, isVip: true, vipLevel: 'super' });

        await expect(withQqVipType(ALICE)).resolves.toEqual({ ...ALICE, vipType: 0 });
        await expect(withQqVipType(ALICE)).resolves.toEqual({ ...ALICE, vipType: 0 });
        expect(requestMock).toHaveBeenCalledTimes(1);

        await expect(withQqVipType(BOB)).resolves.toEqual({ ...BOB, vipType: 2 });
        expect(requestMock).toHaveBeenCalledTimes(2);
        expect(requestMock).toHaveBeenCalledWith('user_vip');
    });
});
