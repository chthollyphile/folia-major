import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqLoginMethod.test.ts
// 登录方式选择走 omni 的泛型契约：UI 只认 QrLoginMethod，不认识任何 QQ 内部概念。

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
    hasQqSession: () => true,
    clearQqSession: vi.fn(),
    requestQq: requestMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: vi.fn(),
}));

vi.mock('@/utils/lyrics/providers/qqLyricProvider', () => ({
    searchQQLyrics: vi.fn(),
    fetchQQLyrics: vi.fn(),
}));

import { omni } from '@/services/onlineMusic/omni';

describe('QQ login method selection', () => {
    beforeEach(() => {
        requestMock.mockReset();
        requestMock.mockResolvedValue({ code: 200, data: { unikey: 'qr-key', qrimg: 'data:image/png;base64,fixture' } });
    });

    it('declares both scan methods with an i18n key and an icon key, never an asset', () => {
        const methods = omni.getQrLoginMethods('qq');

        expect(methods).toEqual([
            { id: 'mobile', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
            { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
        ]);
        // services 层不 import .svg：iconKey 只是字符串，映射留在 UI 层。
        for (const method of methods) {
            expect(method.iconKey).not.toMatch(/\.svg$/);
        }
    });

    it('reports no methods for providers with a single scan flow', () => {
        expect(omni.getQrLoginMethods('netease')).toEqual([]);
        expect(omni.getQrLoginMethods('kugou')).toEqual([]);
    });

    it('declares the QR lifetime only for QQ, whose session TTL we own', () => {
        // 后端 qq-music-api 的会话寿命是 180 秒，前端要早一步收手才有意义。
        expect(omni.getQrTtlMs('qq')).toBe(175_000);
        expect(omni.getQrTtlMs('qq')).toBeLessThan(180_000);
        // netease / kugou 的二维码能活多久我们无从得知，交给它们各自的后端去报过期。
        expect(omni.getQrTtlMs('netease')).toBeNull();
        expect(omni.getQrTtlMs('kugou')).toBeNull();
    });

    it('sends no request until a method is chosen', () => {
        omni.getQrLoginMethods('qq');

        expect(requestMock).not.toHaveBeenCalled();
    });

    it('passes the chosen method to the backend as the channel parameter', async () => {
        await omni.createQrLogin('qq', 'wechat');

        expect(requestMock).toHaveBeenNthCalledWith(1, 'login_qr_key', { channel: 'wechat' });
    });

    it('falls back to the App channel when no method is given', async () => {
        await omni.createQrLogin('qq');

        expect(requestMock).toHaveBeenNthCalledWith(1, 'login_qr_key', { channel: 'mobile' });
    });

    it('starts a fresh session per switch instead of reusing the previous choice', async () => {
        await omni.createQrLogin('qq', 'mobile');
        await omni.createQrLogin('qq', 'wechat');
        await omni.createQrLogin('qq', 'mobile');

        const channels = requestMock.mock.calls
            .filter(([operation]) => operation === 'login_qr_key')
            .map(([, params]) => params.channel);
        // 模块单例已删除：每次都由调用方明确指定，切换回来不会拿到上一次的残留值。
        expect(channels).toEqual(['mobile', 'wechat', 'mobile']);
    });
});
