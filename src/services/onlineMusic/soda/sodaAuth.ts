import type { LoginState, OnlineAuthProvider, ProviderUser } from '../../../types/onlineMusic';
import { requestSoda } from './sodaTransport';

// src/services/onlineMusic/soda/sodaAuth.ts
//
// 汽水的登录：扫码（汽水 App 扫）。`startLogin` 要一个码并记住它的 token，`createQr` 交出二维码图片，
// `checkLogin` 轮询。真正跟 passport 打交道的是主进程里的 ly-music-source，这里只管把它的回答翻成 LoginState。

interface QrStart {
    token: string;
    qrcode: string;
    expireTime?: number;
}

interface QrPoll {
    status: string;
    message?: string;
}

interface SodaProfile {
    id?: string;
    nickname?: string;
    avatarUrl?: string;
    isVip?: boolean;
    vipLevel?: string;
}

// 每一次登录的二维码图片，token 就是 key。登录窗口关掉时 cancelLogin 会把它删掉。
const pendingQr = new Map<string, { qrcode: string; at: number }>();
const QR_TTL = 5 * 60 * 1000;

const prunePending = () => {
    const now = Date.now();
    for (const [token, entry] of pendingQr) if (now - entry.at > QR_TTL) pendingQr.delete(token);
};

export const sodaUserOf = (profile: SodaProfile | null): ProviderUser | null => {
    if (!profile?.id) return null;
    return {
        id: String(profile.id),
        nickname: String(profile.nickname || '汽水音乐'),
        ...(profile.avatarUrl ? { avatarUrl: String(profile.avatarUrl) } : {}),
        // vipType 在这个仓库里是个数字；汽水给的是 vip / svip 这样的字，压成 1 / 2。
        ...(profile.isVip ? { vipType: profile.vipLevel === 'svip' ? 2 : 1 } : {}),
    };
};

const pollToState = (answer: QrPoll): LoginState => {
    switch (answer.status) {
        case 'waiting':
            return { state: 'waiting' };
        case 'scanned':
            return { state: 'scanned' };
        case 'confirmed':
            return { state: 'confirmed' };
        case 'expired':
            return { state: 'expired' };
        default:
            return { state: 'error', message: answer.message || '汽水音乐登录失败' };
    }
};

// 从官方 PC 客户端导入的节流：客户端开着时它的 cookie 库会被锁，等它退出后下一次询问应该再试一次。
let lastPcAttempt = 0;
const PC_RETRY_MS = 15000;

export const sodaAuth: OnlineAuthProvider = {
    async getLoginStatus() {
        const answer = await requestSoda<{ authenticated: boolean; profile: SodaProfile | null }>('status');
        if (answer.authenticated) return sodaUserOf(answer.profile);
        if (Date.now() - lastPcAttempt > PC_RETRY_MS) {
            lastPcAttempt = Date.now();
            try {
                await requestSoda('pc_login');
                const retry = await requestSoda<{ authenticated: boolean; profile: SodaProfile | null }>('status');
                if (retry.authenticated) return sodaUserOf(retry.profile);
            } catch (error) {
                // 没装客户端、没登录、不是 Windows：都落在这里，不影响扫码那条路。
                console.info('[Soda] PC client session not imported:', error instanceof Error ? error.message : String(error));
            }
        }
        return null;
    },

    async logout() {
        await requestSoda('logout');
        pendingQr.clear();
    },

    // 会话存在主进程里，磁盘上的账号可以在启动时先显示出来，等平台报出同一个人再确认。
    showsKeptAccountAtStart: true,

    getLoginTexts: () => ({
        title: 'home.loginTitleSoda',
        note: 'home.loginNoteSoda',
    }),

    async startLogin() {
        prunePending();
        const answer = await requestSoda<QrStart>('login_qr_create');
        if (!answer.token) throw new Error('汽水音乐没有给出扫码 token');
        pendingQr.set(answer.token, { qrcode: answer.qrcode, at: Date.now() });
        return answer.token;
    },

    async createQr(key) {
        const entry = pendingQr.get(key);
        if (!entry) throw new Error('汽水音乐的二维码已过期');
        if (!entry.qrcode) throw new Error('汽水音乐没有给出二维码图片');
        return entry.qrcode;
    },

    async checkLogin(key) {
        const answer = await requestSoda<QrPoll>('login_qr_poll', { token: key });
        console.info('[Soda] QR poll', answer.status, answer.message ? `— ${answer.message}` : '');
        // 平台拒绝第三方客户端的几种回答：再等也不会有结果，把原话报给登录窗口。
        if (/非官方|系统繁忙|版本过低|升级应用/i.test(answer.message || '')) {
            pendingQr.delete(key);
            return { state: 'error', message: answer.message };
        }
        // 汽水在扫码后可能要求短信验证：这个流程包里没做，再等也不会有结果，直接把原因说给登录窗口。
        if (answer.status === 'scanned' && /短信|验证|verify/i.test(answer.message || '')) {
            pendingQr.delete(key);
            return { state: 'error', message: answer.message || '汽水音乐要求短信验证，当前登录流程走不下去' };
        }
        const state = pollToState(answer);
        if (state.state === 'confirmed' || state.state === 'expired') pendingQr.delete(key);
        return state;
    },

    async cancelLogin(key) {
        pendingQr.delete(key);
    },
};
