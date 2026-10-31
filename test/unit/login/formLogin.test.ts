import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginScene } from '@/components/login/window/loginView';
import { omni } from '@/services/onlineMusic/omni';

// test/unit/login/formLogin.test.ts
// 通用表单式登录（review 行为 11/14 与「loginScene 'form'、omni.submitLoginForm」）：
// provider 声明了 getLoginForm 就进表单，否则走扫码/浏览器流程；提交走 provider 自己。

const bridgeRequest = vi.fn();
const statusSync = vi.fn();

beforeEach(() => {
    bridgeRequest.mockReset().mockResolvedValue({ ok: true, data: { user: { guid: 'u1', name: 'Tester' } } });
    statusSync.mockReset().mockReturnValue({ available: true, configured: true, authenticated: false, base: null, username: '' });
    vi.stubGlobal('window', { electron: { fnmusicRequest: bridgeRequest, fnmusicStatusSync: statusSync } });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('loginScene form branch', () => {
    it('shows the form for a platform that declares getLoginForm, instead of auto-starting a sign-in', () => {
        const scene = loginScene({ lead: 'sign-in', phase: null, inBrowser: false, failed: false, providerId: 'fnmusic' });
        expect(scene).toBe('form');
    });

    it('does not show the form for a platform without getLoginForm; it follows the normal sign-in flow', () => {
        const scene = loginScene({ lead: 'sign-in', phase: null, inBrowser: false, failed: false, providerId: 'netease' });
        expect(scene).not.toBe('form');
        expect(scene).toBe('preparing');
    });

    it('shows a failure scene when the form sign-in failed (the window shows the failure, not the form)', () => {
        const scene = loginScene({ lead: 'sign-in', phase: null, inBrowser: false, failed: true, providerId: 'fnmusic' });
        expect(scene).toBe('failed');
    });
});

describe('omni.getLoginForm', () => {
    it('returns the declared fields for fnmusic', () => {
        const form = omni.getLoginForm('fnmusic');
        expect(form).not.toBeNull();
        expect(form?.fields.map(field => field.key)).toEqual(['base', 'username', 'password']);
    });

    it('returns null for platforms without a form', () => {
        expect(omni.getLoginForm('netease')).toBeNull();
    });
});

describe('omni.submitLoginForm', () => {
    it('submits the form through the provider itself (bridge receives a login operation)', async () => {
        await expect(omni.submitLoginForm('fnmusic', {
            base: 'http://192.168.1.10:5666',
            username: 'alice',
            password: 'secret',
        })).resolves.toBeUndefined();
        expect(bridgeRequest).toHaveBeenCalledWith('login', expect.objectContaining({
            base: 'http://192.168.1.10:5666',
            username: 'alice',
            password: 'secret',
            deviceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        }));
    });

    it('fails with unsupported for a platform without submitLoginForm', async () => {
        await expect(omni.submitLoginForm('netease', {})).rejects.toMatchObject({ code: 'unsupported' });
    });
});
