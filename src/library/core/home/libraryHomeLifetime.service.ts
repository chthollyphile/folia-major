import type { LibraryHomeResources, LibraryHomeTabKey } from './homeModel.contract';

// src/library/core/home/libraryHomeLifetime.service.ts
// 首页资源的生命周期规则（宿主 library/app/useLibraryHomeResources 按它调）：数据的寿命跟着「首页真的离开」，
// 不跟某一套 suite 的首页组件。换 suite 时旧 surface 卸载、新 surface 挂载，资源还是同一份，绑定的 ensure 不会
// 再请求；只有下面两种时刻让数据作废：
// - 首页整个离开（切到播放页后首页藏起、宿主卸载）：在线数据放掉归属（清空、作废进行中的读取），Navidrome 概览与
//   文件夹树作废——回到首页时重新读（test/ui/homeCardPosition 的「延迟专辑」用例锁着：从播放页回到首页，
//   收藏专辑在新应答到达前是空的）。
// - 离开某个页签：Navidrome 概览与文件夹树作废，下次进来重读（与原先这两个视图随页签卸载、进来时重读一致）。
//   在线数据切页签不作废（原先就是首页一份，切页签不重读）。

/** 首页整个离开：放掉在线数据的归属，让概览与文件夹树在回来时重读。 */
export const releaseLibraryHomeResources = (resources: LibraryHomeResources): void => {
    resources.favoriteAlbums.setOwner(null);
    resources.radioFeed.setOwner(null);
    resources.navidromeOverview.invalidate();
    resources.localDirectoryTrees.invalidate();
};

/** 一级页签从 previous 换到 next：离开的页签上按页签读的数据作废。 */
export const invalidateLeftHomeTab = (
    resources: LibraryHomeResources,
    previous: LibraryHomeTabKey,
    next: LibraryHomeTabKey,
): void => {
    if (previous === next) return;
    if (previous === 'navidrome') resources.navidromeOverview.invalidate();
    if (previous === 'local') resources.localDirectoryTrees.invalidate();
};
