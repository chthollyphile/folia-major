import type { OnlineAuthProvider, ProviderUser } from '../../../types/onlineMusic';
import { requestSoda } from './sodaTransport';

// src/services/onlineMusic/soda/sodaAuth.ts
//
// 汽水的登录只有一条路：从官方 PC 客户端（SodaMusic）已登录的会话里读。
// 平台会按「非官方渠道」拒绝第三方客户端的扫码（passport 回 1049 / 2156，实测确认），
// 所以这里不再有二维码：点「登录」就是重新读一次客户端，成功即确认，失败把原因写在登录窗口里。

interface SodaProfile {
    id?: string;
    nickname?: string;
    avatarUrl?: string;
    isVip?: boolean;
    vipLevel?: string;
}

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
    },

    // 会话存在主进程里，磁盘上的账号可以在启动时先显示出来，等平台报出同一个人再确认。
    showsKeptAccountAtStart: true,

    getLoginTexts: () => ({
        title: 'home.loginTitleSoda',
        note: 'home.loginNoteSoda',
    }),

    /**
     * 「登录」在这里等于「重新读一次汽水 PC 客户端的登录态」。
     * 成功直接进登录窗口的确认状态，失败就把主进程给的原因抛出去，由界面原样显示。
     */
    async startLogin() {
        // 每次手动登录都给一次干净的重试机会（自动导入那边有 15 秒节流）。
        lastPcAttempt = 0;
        await requestSoda('pc_login');
        return 'pc-client';
    },

    // 没有二维码可画：给一张说明用的占位图，登录窗口会立刻进入确认状态。
    async createQr() {
        return PLACEHOLDER_IMAGE;
    },

    // startLogin 只有在客户端会话通过 getProfile 校验后才会返回，所以这里直接确认；
    // 再来一次请求确认反而会让窗口多等一轮。
    async checkLogin() {
        return { state: 'confirmed' as const };
    },

    async cancelLogin() {
        // 没有需要清理的会话。
    },
};
