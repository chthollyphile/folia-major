import type { MediaId, ProviderUser } from '../../../types/onlineMusic';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqAccount.ts
// QQ 音乐账号的两样补充资料（qq-music-api 3.3.3）：会员等级，和喜欢清单没读完整时逐首确认的红心。

// `/user/vip` 的三级会员换成 ProviderUser.vipType：免费 0、绿钻 1、超级会员 2。判断不出来（unknown）不填，不当成免费。
const QQ_VIP_TYPES: Readonly<Record<string, number>> = { free: 0, green: 1, super: 2 };

// 登录状态最多为会员等级等这么久；没读完的接着读，读到了下一次检查就有。
const VIP_WAIT_MS = 3_000;
// 读到过的账号的等级（判断不出来的记成没有等级）：一个账号这次运行里只读一次。没有账号 id 的不记，每次检查都读。
const vipKnown = new Map<string, { vipType?: number }>();
// 正在读的账号：等不及的那次检查之后，下一次检查接着等同一个请求，不再发一个。
const vipReading = new Map<string, Promise<void>>();

/** 测试与重置运行时缓存用：忘掉读到过的等级。 */
export const resetQqVipMemory = (): void => {
    vipKnown.clear();
    vipReading.clear();
};

const readVipType = (account: string): Promise<void> => {
    const reading = vipReading.get(account);
    if (reading) return reading;
    const settle = async (): Promise<void> => {
        try {
            const response = await requestQq<any>('user_vip');
            const level = String(response?.vipLevel);
            const vipType = Object.hasOwn(QQ_VIP_TYPES, level) ? QQ_VIP_TYPES[level] : undefined;
            console.info('[QQProvider] vip-level', { level: vipType === undefined ? 'unknown' : level });
            // 读的时候记忆被清掉了（resetQqVipMemory）：这次的结果不再算数。
            if (account && vipReading.get(account) === read) vipKnown.set(account, vipType === undefined ? {} : { vipType });
        } catch (error) {
            // 读不到不记：下一次登录检查再读。
            console.warn('[QQProvider] vip-level:failed', error);
        }
    };
    const read: Promise<void> = settle().finally(() => {
        if (vipReading.get(account) === read) vipReading.delete(account);
    });
    vipReading.set(account, read);
    return read;
};

/**
 * 补上会员等级。一个账号只读一次、记住；登录状态最多等 VIP_WAIT_MS，慢了或读不到就用这个账号上次读到的
 * （没读到过就没有），下一次检查再读。读不到只是少了等级，不影响登录。
 */
export const withQqVipType = async (user: ProviderUser): Promise<ProviderUser> => {
    const account = String(user.id ?? '');
    if (!vipKnown.has(account)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const slow = new Promise<'slow'>(resolve => { timer = setTimeout(() => resolve('slow'), VIP_WAIT_MS); });
        const answer = await Promise.race([readVipType(account), slow]);
        clearTimeout(timer);
        if (answer === 'slow') console.info('[QQProvider] vip-level:slow', { waitedMs: VIP_WAIT_MS });
    }
    const vipType = vipKnown.get(account)?.vipType;
    return vipType === undefined ? user : { ...user, vipType };
};

/**
 * 这几首歌是不是红心（一次一个请求，按 songmid 问）。只在喜欢清单没读完整时才被问到（account/likedChecks.ts）。
 * 后端说 `unknown` 的、和没有 songmid 的歌（mediaId 退成了数字 id）都不回答，不当成「没喜欢」。
 */
export const areQqSongsLiked = async (ids: MediaId[]): Promise<Record<string, boolean>> => {
    const mids = [...new Set(ids.map(id => String(id).trim()).filter(id => id && !/^\d+$/.test(id)))];
    if (mids.length === 0) return {};
    const response = await requestQq<any>('user_subscription_status', { type: 'song', ids: mids.join(',') });
    const answer: Record<string, boolean> = {};
    for (const item of Array.isArray(response?.items) ? response.items : []) {
        const id = String(item?.id ?? '');
        if (!mids.includes(id)) continue;
        if (item.status === 'subscribed') answer[id] = true;
        else if (item.status === 'not-subscribed') answer[id] = false;
    }
    return answer;
};
