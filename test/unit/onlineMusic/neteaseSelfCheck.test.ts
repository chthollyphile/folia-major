import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNeteaseCore } from '../helpers/neteaseSource';

// test/unit/onlineMusic/neteaseSelfCheck.test.ts
// 网易云模组的登录自检（core/neteaseSelfCheck.ts，auth@1.runLoginSelfCheck）。迁之前是宿主的 loginSelfCheck.ts：桌面版交给
// main 入口（现在经 rpc `selfCheck`），网页版只探测配置的远端 API。

const loadSelfCheck = async ({ desktop = false }: { desktop?: boolean } = {}) => {
    vi.resetModules();
    const core = await createNeteaseCore({ desktop });
    const selfCheck = await import('../../../sources/netease/core/neteaseSelfCheck');
    return { core, ...selfCheck };
};

describe('NetEase login self-check', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('hands the check to the main entry on the desktop build', async () => {
        const { core, canRunNeteaseSelfCheck, runNeteaseSelfCheck } = await loadSelfCheck();
        const result = { runtime: 'electron', startedAt: 1, durationMs: 2, backend: null, proxy: null, hosts: [] };
        const { selfCheck } = core.desktop();
        selfCheck.mockReturnValue(result);

        expect(canRunNeteaseSelfCheck()).toBe(true);
        await expect(runNeteaseSelfCheck()).resolves.toEqual(result);
        expect(selfCheck).toHaveBeenCalledTimes(1);
    });

    it('answers null when the main entry cannot be asked', async () => {
        const { core, runNeteaseSelfCheck } = await loadSelfCheck();
        const { selfCheck } = core.desktop();
        selfCheck.mockImplementation(() => {
            throw new Error('main entry gone');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(runNeteaseSelfCheck()).resolves.toBeNull();
    });

    it('probes the configured remote API on the web build', async () => {
        vi.stubGlobal('window', {});
        const fetchMock = vi.fn().mockResolvedValue({ status: 0 });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('VITE_NETEASE_API_BASE', '');
        const { canRunNeteaseSelfCheck, runNeteaseSelfCheck } = await loadSelfCheck();

        expect(canRunNeteaseSelfCheck()).toBe(false);
        await expect(runNeteaseSelfCheck()).resolves.toBeNull();

        vi.stubEnv('VITE_NETEASE_API_BASE', 'https://api.example.test/');
        expect(canRunNeteaseSelfCheck()).toBe(true);
        const result = await runNeteaseSelfCheck();
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/', expect.objectContaining({ mode: 'no-cors', cache: 'no-store' }));
        // no-cors 的不透明响应没有状态码，但能拿到它就说明远端可达。
        expect(result).toMatchObject({
            runtime: 'web',
            backend: { status: 'remote', url: 'https://api.example.test/', probe: { ok: true, httpStatus: null, error: null } },
            proxy: null,
            hosts: [],
        });
    });

    it('records an unreachable remote API instead of throwing', async () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        vi.stubEnv('VITE_NETEASE_API_BASE', 'https://api.example.test');
        const { runNeteaseSelfCheck } = await loadSelfCheck();

        await expect(runNeteaseSelfCheck()).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: null, message: 'Failed to fetch' } } },
        });
    });

    it('flags an API address on this device when no API can run here, without probing it', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 0 });
        vi.stubGlobal('fetch', fetchMock);
        const page = (href: string, userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150') => {
            vi.stubGlobal('window', { location: new URL(href) });
            vi.stubGlobal('navigator', { userAgent });
        };
        const { runNeteaseSelfCheck } = await loadSelfCheck();
        const check = (apiBase: string) => {
            vi.stubEnv('VITE_NETEASE_API_BASE', apiBase);
            return runNeteaseSelfCheck();
        };

        page('https://folia.example.com/');
        await expect(check('http://localhost:3000')).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: 'ELOOPBACK' } } },
        });
        // 打包进安卓 App 的页面自己可能就在 localhost 上，但手机上不会有 API 服务。
        page('http://localhost/', 'Mozilla/5.0 (Linux; Android 16; wv) Chrome/153 Mobile Safari/537.36');
        await expect(check('http://127.0.0.1:3000')).resolves.toMatchObject({
            backend: { probe: { ok: false, error: { code: 'ELOOPBACK' } } },
        });
        expect(fetchMock).not.toHaveBeenCalled();

        // 本机开发：页面和 API 都在本机，照常探测。
        page('http://localhost:5173/');
        await expect(check('http://localhost:3000')).resolves.toMatchObject({ backend: { probe: { ok: true } } });
        // 相对地址（Docker 的 /netease）跟着页面走，不算本机。
        page('https://folia.example.com/');
        await expect(check('/netease')).resolves.toMatchObject({ backend: { probe: { ok: true } } });
    });
});
