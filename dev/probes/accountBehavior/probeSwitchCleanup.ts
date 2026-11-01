import type { LibraryProviderSwitchCleanupPort } from '../../../src/library/core/account/account.contract';
import { createLibraryAccountSwitchCleanupPort } from '../../../src/library/app/createLibraryAccountPort';
import { recordAccountCall } from './fakeAuthProviders';

// dev/probes/accountBehavior/probeSwitchCleanup.ts
// 账户探针的平台端口：就是应用的那一个（createLibraryAccountSwitchCleanupPort：切换时退出私人 FM、收起集合导航，
// 退出登录时移出那个平台的歌），外面包一层记账（switch-cleanup 带目标平台，drop-songs 带退出的平台）。
// 探针没有 audio 元素与 automix，App 的句柄给空引用。

const realCleanup = createLibraryAccountSwitchCleanupPort(() => ({
    audioRef: { current: null },
    automixRef: { current: null },
    shouldAutoPlay: { current: false },
    setLyrics: () => {},
    setIsLyricsLoading: () => {},
}));

export const probeSwitchCleanup: LibraryProviderSwitchCleanupPort = {
    leaveProvider: (previousProviderId, nextProviderId) => {
        recordAccountCall({ op: 'switch-cleanup', providerId: nextProviderId });
        return realCleanup.leaveProvider(previousProviderId, nextProviderId);
    },
    holdsSongsOf: providerId => realCleanup.holdsSongsOf(providerId),
    dropSongsOf: providerId => {
        recordAccountCall({ op: 'drop-songs', providerId });
        return realCleanup.dropSongsOf(providerId);
    },
};
