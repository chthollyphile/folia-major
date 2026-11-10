import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/qqLoginMethod.test.ts
// 登录方式选择走 omni 的泛型契约：UI 只认 LoginMethod，不认识任何 QQ 内部概念。

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/onlineMusic/qq/qqTransport', () => ({
    getQqTransportAvailability: () => ({ configured: true }),
    hasQqSession: () => true,
    hasUsableQqSession: () => true,
    clearQqSession: vi.fn(),
    requestQq: requestMock,
}));

vi.mock('@/services/onlineMusic/providerStorage', () => ({
    writeProviderSessionValue: vi.fn(),
}));

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({
    searchQQLyrics: vi.fn(),
    searchQQSongs: vi.fn(),
    fetchQQLyrics: vi.fn(),
}));

import { omni } from '@/services/onlineMusic/omni';
import { resetQqLoginChannelCache } from '@/services/onlineMusic/qq/qqProvider';

describe('QQ login method selection', () => {
    beforeEach(() => {
        requestMock.mockReset();
        requestMock.mockResolvedValue({ code: 200, data: { unikey: 'qr-key', qrimg: 'data:image/png;base64,fixture' } });
        resetQqLoginChannelCache();
    });

    it('declares both scan methods with an i18n key and an icon key, never an asset', () => {
        const methods = omni.getLoginMethods('qq');

        expect(methods).toEqual([
            { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
            { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
        ]);
        // services 层不 import .svg：iconKey 只是字符串，映射留在 UI 层。
        for (const method of methods) {
            expect(method.iconKey).not.toMatch(/\.svg$/);
        }
    });

    it('reports no methods for providers with a single scan flow', () => {
        expect(omni.getLoginMethods('netease')).toEqual([]);
        expect(omni.getLoginMethods('kugou')).toEqual([]);
    });

    it('declares the QR lifetime only for QQ, whose session TTL we own', () => {
        // 后端 qq-music-api 的会话寿命是 180 秒，前端要早一步收手才有意义。
        expect(omni.getLoginTtlMs('qq')).toBe(175_000);
        expect(omni.getLoginTtlMs('qq')).toBeLessThan(180_000);
        // netease / kugou 的二维码能活多久我们无从得知，交给它们各自的后端去报过期。
        expect(omni.getLoginTtlMs('netease')).toBeNull();
        expect(omni.getLoginTtlMs('kugou')).toBeNull();
    });

    it('creates no QR session until a method is chosen', () => {
        omni.getLoginMethods('qq');

        // 读取方式列表只允许探测后端声明的通道，绝不能先去要一个二维码。
        const operations = requestMock.mock.calls.map(([operation]) => operation);
        expect(operations).not.toContain('login_qr_key');
        expect(operations).not.toContain('login_qr_create');
    });

    it('passes the chosen method to the backend as the channel parameter', async () => {
        await omni.startLogin('qq', 'wechat');

        expect(requestMock).toHaveBeenNthCalledWith(1, 'login_qr_key', { channel: 'wechat' });
    });

    it('falls back to the App channel when no method is given', async () => {
        await omni.startLogin('qq');

        expect(requestMock).toHaveBeenNthCalledWith(1, 'login_qr_key', { channel: 'qq' });
    });

    it('starts a fresh session per switch instead of reusing the previous choice', async () => {
        await omni.startLogin('qq', 'qq');
        await omni.startLogin('qq', 'wechat');
        await omni.startLogin('qq', 'qq');

        const channels = requestMock.mock.calls
            .filter(([operation]) => operation === 'login_qr_key')
            .map(([, params]) => params.channel);
        // 模块单例已删除：每次都由调用方明确指定，切换回来不会拿到上一次的残留值。
        expect(channels).toEqual(['qq', 'wechat', 'qq']);
    });
});

describe('QQ login channels declared by the backend', () => {
    beforeEach(() => {
        requestMock.mockReset();
        resetQqLoginChannelCache();
    });

    // 前端只显示该 runtime 真正支持的通道，不显示点进去必定失败的那个。
    const declare = (channels: string[]) => {
        requestMock.mockImplementation(async (operation: string) => (
            operation === 'login_channels'
                ? { code: 200, data: { channels, sessionMode: 'sealed', configured: true } }
                : { code: 200, data: {} }
        ));
    };

    it('hides the selector entirely when the backend serves a single channel', async () => {
        declare(['wechat']);

        const methods = await omni.resolveLoginMethods('qq');

        // 登录流程等待能力发现，用这同一份结果决定是否显示选择器与是否直接创建二维码。
        expect(methods).toEqual([]);
        expect(omni.getLoginMethods('qq')).toEqual([]);
    });

    it('uses the only declared channel when the hidden selector supplies no method', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'login_channels') {
                return { code: 200, data: { channels: ['wechat'], sessionMode: 'sealed', configured: true } };
            }
            if (operation === 'login_qr_key') return { code: 200, data: { unikey: 'qr-key' } };
            return { code: 200, data: { qrimg: 'data:image/png;base64,fixture' } };
        });

        omni.getLoginMethods('qq');
        await vi.waitFor(() => expect(requestMock).toHaveBeenCalledWith('login_channels'));
        await omni.startLogin('qq');

        expect(requestMock).toHaveBeenCalledWith('login_qr_key', { channel: 'wechat' });
    });

    it('keeps both methods when the backend declares both', async () => {
        declare(['qq', 'wechat']);

        omni.getLoginMethods('qq');
        await vi.waitFor(() => expect(requestMock).toHaveBeenCalledWith('login_channels'));

        expect(omni.getLoginMethods('qq').map(method => method.id)).toEqual(['qq', 'wechat']);
    });

    it('keeps the hardcoded methods when the route is missing on an older backend', async () => {
        requestMock.mockRejectedValue(new Error('404'));

        const methods = await omni.resolveLoginMethods('qq');

        // 旧后端没有这条路由，向后兼容的定义就是「行为和今天完全一样」。
        expect(methods.map(method => method.id)).toEqual(['qq', 'wechat']);
    });

    it('waits for delayed channel discovery before deriving the login flow', async () => {
        let finishProbe: ((value: unknown) => void) | undefined;
        requestMock.mockImplementation((operation: string) => (
            operation === 'login_channels'
                ? new Promise(resolve => { finishProbe = resolve; })
                : Promise.resolve({ code: 200, data: {} })
        ));

        let settled = false;
        const resolving = omni.resolveLoginMethods('qq').then(methods => {
            settled = true;
            return methods;
        });
        await vi.waitFor(() => expect(requestMock).toHaveBeenCalledWith('login_channels'));
        expect(settled).toBe(false);

        finishProbe?.({ code: 200, data: { channels: ['wechat'] } });

        await expect(resolving).resolves.toEqual([]);
    });

    it('retries a failed discovery when the user opens login later', async () => {
        requestMock
            .mockRejectedValueOnce(new Error('temporary network failure'))
            .mockResolvedValueOnce({ code: 200, data: { channels: ['wechat'] } });

        await expect(omni.resolveLoginMethods('qq')).resolves.toHaveLength(2);
        await expect(omni.resolveLoginMethods('qq')).resolves.toEqual([]);

        const probes = requestMock.mock.calls.filter(([operation]) => operation === 'login_channels');
        expect(probes).toHaveLength(2);
    });

    it('offers the QQ Music app scan only when the backend declares it', async () => {
        declare(['qq', 'wechat', 'qqmusic']);

        const methods = await omni.resolveLoginMethods('qq');

        expect(methods).toEqual([
            { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
            { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
            { id: 'qqmusic', labelKey: 'home.qqLoginMethodQqMusic', iconKey: 'qqmusic' },
        ]);
    });

    it('leaves the QQ Music app scan out where the backend does not declare it', async () => {
        // Serverless 没配中继：后端只有手机 QQ 与微信。
        declare(['qq', 'wechat']);
        await expect(omni.resolveLoginMethods('qq')).resolves.not.toContainEqual(expect.objectContaining({ id: 'qqmusic' }));

        // 旧后端没有 /login/channels：照旧只有两种，没宣告的通道不显示。
        resetQqLoginChannelCache();
        requestMock.mockReset();
        requestMock.mockRejectedValue(new Error('404'));
        expect(omni.getLoginMethods('qq').map(method => method.id)).toEqual(['qq', 'wechat']);
    });

    it('asks for a QQ Music app code with the qqmusic channel', async () => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'login_channels') {
                return { code: 200, data: { channels: ['qq', 'wechat', 'qqmusic'], sessionMode: 'stored', configured: true } };
            }
            return { code: 200, data: { unikey: 'qr-key', qrimg: 'data:image/png;base64,fixture' } };
        });

        await omni.startLogin('qq', 'qqmusic');

        expect(requestMock).toHaveBeenCalledWith('login_qr_key', { channel: 'qqmusic' });
    });

    it('has an icon file and a label in every language for each method', async () => {
        declare(['qq', 'wechat', 'qqmusic']);
        const methods = await omni.resolveLoginMethods('qq');
        const { existsSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const locales = await Promise.all(['en', 'in', 'zh-CN'].map(name => import(`@/i18n/locales/${name}.ts`)));

        for (const method of methods) {
            expect(existsSync(resolve(process.cwd(), 'src/assets/providers', `${method.iconKey}.svg`))).toBe(true);
            const [group, key] = method.labelKey.split('.');
            for (const locale of locales) {
                const table = locale.default ?? Object.values(locale)[0];
                expect(table?.[group]?.[key]).toEqual(expect.any(String));
            }
        }
    });

    it('tells a person who scanned with the wrong app what to do here, by the channels the backend has', async () => {
        // 登录文字在通道问到之前就被拿走了：显示时才按通道说。
        const texts = omni.getLoginTexts('qq');
        expect(texts?.caseNotes?.['wrong-scan-app']).toBe('home.loginCaseQqWrongScanAppMobileOnly');

        declare(['qq', 'wechat', 'qqmusic']);
        await omni.resolveLoginMethods('qq');
        expect(texts?.caseNotes?.['wrong-scan-app']).toBe('home.loginCaseQqWrongScanApp');

        resetQqLoginChannelCache();
        declare(['qq', 'wechat']);
        await omni.resolveLoginMethods('qq');
        expect(texts?.caseNotes?.['wrong-scan-app']).toBe('home.loginCaseQqWrongScanAppMobileOnly');

        // 两句在三种语言里都有。
        const locales = await Promise.all(['en', 'in', 'zh-CN'].map(name => import(`@/i18n/locales/${name}.ts`)));
        for (const locale of locales) {
            expect(locale.default.home.loginCaseQqWrongScanApp).toEqual(expect.any(String));
            expect(locale.default.home.loginCaseQqWrongScanAppMobileOnly).toEqual(expect.any(String));
            expect(locale.default.login.caseWrongScanApp).toEqual(expect.any(String));
            expect(locale.default.login.noteWrongScanApp).toEqual(expect.any(String));
        }
    });

    it('tells a person whose account has no device left where to remove one in the QQ Music app', async () => {
        // 共用那一句只说「在手机上退出不用的设备」；QQ 的设备是在 QQ 音乐 App 的设置最下面「设备管理」里移除。
        expect(omni.getLoginTexts('qq')?.caseNotes?.['device-limit']).toBe('home.loginCaseQqDeviceLimit');
        const locales = await Promise.all(['en', 'in', 'zh-CN'].map(name => import(`@/i18n/locales/${name}.ts`)));
        for (const locale of locales) expect(locale.default.home.loginCaseQqDeviceLimit).toEqual(expect.any(String));
    });

    it('probes the backend only once however often the methods are read', async () => {
        declare(['qq', 'wechat']);

        omni.getLoginMethods('qq');
        omni.getLoginMethods('qq');
        await vi.waitFor(() => expect(requestMock).toHaveBeenCalledWith('login_channels'));
        omni.getLoginMethods('qq');

        const probes = requestMock.mock.calls.filter(([operation]) => operation === 'login_channels');
        expect(probes).toHaveLength(1);
    });
});

describe('QQ Music app scan only, where the backend keeps the session', () => {
    beforeEach(() => {
        requestMock.mockReset();
        resetQqLoginChannelCache();
    });

    // 桌面版、Docker、Node 的后端（3.3.2 起）宣告三个通道、会话存在后端。
    const declare = (channels: string[], sessionMode?: string) => {
        requestMock.mockImplementation(async (operation: string) => {
            if (operation === 'login_channels') {
                return { code: 200, data: { channels, ...(sessionMode ? { sessionMode } : {}), configured: true } };
            }
            if (operation === 'login_qr_key') return { code: 200, data: { unikey: 'qr-key' } };
            return { code: 200, data: { qrimg: 'data:image/png;base64,fixture' } };
        });
    };

    it('shows no picker and asks for a QQ Music app code straight away', async () => {
        declare(['qq', 'wechat', 'qqmusic'], 'stored');

        await expect(omni.resolveLoginMethods('qq')).resolves.toEqual([]);
        expect(omni.getLoginMethods('qq')).toEqual([]);
        await omni.startLogin('qq');

        expect(requestMock).toHaveBeenCalledWith('login_qr_key', { channel: 'qqmusic' });
    });

    it('treats a backend that does not say how it keeps the session like one that keeps it', async () => {
        declare(['qq', 'wechat', 'qqmusic']);

        await expect(omni.resolveLoginMethods('qq')).resolves.toEqual([]);
    });

    it('keeps the choice on a serverless backend, with or without the QQ Music app scan', async () => {
        declare(['qq', 'wechat', 'qqmusic'], 'sealed');
        await expect(omni.resolveLoginMethods('qq')).resolves.toHaveLength(3);

        resetQqLoginChannelCache();
        declare(['qq', 'wechat'], 'sealed');
        await expect(omni.resolveLoginMethods('qq')).resolves.toHaveLength(2);
    });

    it('keeps mobile QQ and WeChat where the backend has no QQ Music app scan, or has not answered', async () => {
        // 3.3.1：会话存在后端，但只有这两个通道。
        declare(['qq', 'wechat'], 'stored');
        expect((await omni.resolveLoginMethods('qq')).map(method => method.id)).toEqual(['qq', 'wechat']);
        await omni.startLogin('qq', 'wechat');
        expect(requestMock).toHaveBeenCalledWith('login_qr_key', { channel: 'wechat' });

        resetQqLoginChannelCache();
        requestMock.mockReset();
        requestMock.mockRejectedValue(new Error('404'));
        expect((await omni.resolveLoginMethods('qq')).map(method => method.id)).toEqual(['qq', 'wechat']);
    });

    it('says the three apps can scan the code, and goes back to the usual words elsewhere', async () => {
        const texts = omni.getLoginTexts('qq');
        expect(texts).toMatchObject({ title: 'home.loginTitleQq', note: 'home.loginNoteQq' });

        // 文字在通道问到之前就被拿走了：显示时才按通道说。
        declare(['qq', 'wechat', 'qqmusic'], 'stored');
        await omni.resolveLoginMethods('qq');
        expect(texts).toMatchObject({ title: 'home.loginTitleQqAppScan', note: 'home.loginNoteQqAppScan' });

        resetQqLoginChannelCache();
        // Serverless 带 QQ 音乐 App 扫码：选择器有三种，说明也说三种。
        declare(['qq', 'wechat', 'qqmusic'], 'sealed');
        await omni.resolveLoginMethods('qq');
        expect(texts).toMatchObject({ title: 'home.loginTitleQq', note: 'home.loginNoteQqWithApp' });

        resetQqLoginChannelCache();
        declare(['qq', 'wechat'], 'sealed');
        await omni.resolveLoginMethods('qq');
        expect(texts).toMatchObject({ title: 'home.loginTitleQq', note: 'home.loginNoteQq' });

        const locales = await Promise.all(['en', 'in', 'zh-CN'].map(name => import(`@/i18n/locales/${name}.ts`)));
        for (const locale of locales) {
            expect(locale.default.home.loginTitleQqAppScan).toEqual(expect.any(String));
            expect(locale.default.home.loginNoteQqAppScan).toEqual(expect.any(String));
            expect(locale.default.home.loginNoteQqWithApp).toEqual(expect.any(String));
        }
    });

    it('names the method the window offers in the report', async () => {
        const shown = async () => (await omni.getLoginDiagnostics('qq'))
            .map(line => line.text)
            .find(text => text.startsWith('login methods shown:'));

        declare(['qq', 'wechat', 'qqmusic'], 'stored');
        await omni.resolveLoginMethods('qq');
        expect(await shown()).toBe('login methods shown: qqmusic (no picker)');

        resetQqLoginChannelCache();
        declare(['qq', 'wechat', 'qqmusic'], 'sealed');
        await omni.resolveLoginMethods('qq');
        expect(await shown()).toBe('login methods shown: qq, wechat, qqmusic');
    });

    it('keeps the window texts on the methods this login resolved when a later probe finds more', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            // 打开窗口时探测失败：窗口给的是回落的 QQ 扫码与微信扫码。
            requestMock.mockRejectedValue(new Error('temporary network failure'));
            const texts = omni.getLoginTexts('qq');
            expect((await omni.resolveLoginMethods('qq')).map(method => method.id)).toEqual(['qq', 'wechat']);

            // 30 秒后别处的读取重新探测，这次后端宣告了 QQ 音乐 App 扫码。
            declare(['qq', 'wechat', 'qqmusic'], 'stored');
            vi.advanceTimersByTime(31_000);
            omni.getLoginMethods('qq');
            await vi.waitFor(() => expect(omni.getLoginMethods('qq')).toEqual([]));

            // 窗口上还是那个选择器给的码：文字照这一次登录解析出的方式说。
            expect(texts).toMatchObject({ title: 'home.loginTitleQq', note: 'home.loginNoteQq' });
            expect(texts?.caseNotes?.['wrong-scan-app']).toBe('home.loginCaseQqWrongScanAppMobileOnly');
        } finally {
            vi.useRealTimers();
        }
    });
});
