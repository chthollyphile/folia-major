import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { navidromePlayAccount, recentPlayRecordsOf, watchRecentPlays, type PlayScope, type RecentPlay } from '../home/explore/recentPlays';
import { omni } from '../../../services/onlineMusic/omni';
import { getNavidromeConfig } from '../../../services/navidromeService';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { mergeRecentPlays } from './historyDays';

// src/components/app/scratchpad/useScratchpadHistory.ts
// 速记簿「播放历史」页的数据：每个在线平台按它此刻登录的账户（没有账户的平台是空账户）、本地文件、此刻连着的
// Navidrome（服务器上的那个用户）各读最近七天的播放记录，合成一条。和录的时候是同一个账户键（useRecentPlaysRecorder）。
// 放了一首、换了账户、平台增减时重读（换了 Navidrome 服务器没有通知，下一首播放时跟上）。
// 平台列表经 omni 读（界面层不碰 provider 注册表，omniArchitecture 单测守着）。

const subscribeProviders = (listener: () => void) => omni.subscribeProviders(listener);
const providerRegistryVersion = () => omni.getProviderRegistryVersion();

export const useScratchpadHistory = (): RecentPlay[] => {
    // 记录变了只是通知（watchRecentPlays），读取在下面的 useMemo 里：用一个计数让它重算。
    const [version, setVersion] = useState(0);
    useEffect(() => watchRecentPlays(() => setVersion(current => current + 1)), []);
    const registryVersion = useSyncExternalStore(subscribeProviders, providerRegistryVersion);
    // 平台摘要里的 user 来自账户 store：换了账户也重读。
    const accounts = useOnlineProviderAccountStore(state => state.accounts);
    return useMemo(() => {
        // version、registryVersion、accounts 不在式子里，只在依赖里：它们一变就重读。
        const navidromeAccount = navidromePlayAccount(getNavidromeConfig());
        const scopes: PlayScope[] = [
            ...omni.getProviderSummaries().map((summary): PlayScope => (
                { kind: 'online', providerId: summary.providerId, accountId: String(summary.user?.id ?? '') }
            )),
            { kind: 'local' },
            ...(navidromeAccount ? [{ kind: 'navidrome', accountId: navidromeAccount } as const] : []),
        ];
        const lists = scopes.map(recentPlayRecordsOf);
        return mergeRecentPlays(lists, play => getPlaybackSongKey(play.song));
    }, [accounts, registryVersion, version]);
};
