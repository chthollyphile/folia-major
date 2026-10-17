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

export const sodaAuth: OnlineAuthProvider = {
    async getLoginStatus() {
        const answer = await requestSoda<{ authenticated: boolean; profile: SodaProfile | null }>('status');
        return answer.authenticated ? sodaUserOf(answer.profile) : null;
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
        const state = pollToState(answer);
        if (state.state === 'confirmed' || state.state === 'expired') pendingQr.delete(key);
        return state;
    },

    async cancelLogin(key) {
        pendingQr.delete(key);
    },
};
