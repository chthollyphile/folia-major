import type { LibraryDirectoryBatchConfig, LibraryHiddenScope } from '../../../src/library/core/directory/directory.contract';
import type { LibraryHomeCard } from '../../../src/library/core/home/homeModel.contract';
import BravaisHomeDirectory from '../../../src/library/suites/bravais/BravaisHomeDirectory';
import { closeBravaisPanel, openBravaisPanel } from '../../../src/library/suites/bravais/bravaisPanelHistory';
import { useBravaisUiStore } from '../../../src/library/suites/bravais/bravaisUiStore';
import { useBravaisSeamStore } from '../../../src/library/suites/bravais/bravaisSeamLevel';
import { findPresentComponent, propsOf } from './reactFiberProbe';

// dev/probes/homeBehavior/bravaisHomeProbe.ts
// `window.__homeProbe` 在 bravais 首页上的那几处（B9）。读的是 BravaisHomeDirectory（每个来源的墙）的 props：
// directoryKey、items、hiddenScope、batchConfig、layerKey、onOpen。网格专属概念在 bravais 上的对应：
// - 墙就是目录（与 TUI 一样，显示哪个目录就打开哪个）：isMapOpen 在墙在场时为 true；visibleItems / open 按浏览视图
//   （去掉隐藏的）找，open 调 onOpen——与点卡片同一个回调（不经 stage 的起点记录）。
// - 「地图」的筛选与批量 = 目录树面板（本地有批量的几行）：openMap / openPanel 打开面板（与窄缝的 ▤ 同一个入口：
//   面板 history + 缝拉回完整），batchOpen = 面板开着；没有批量的目录（在线、Navidrome、本地歌单）openMap 什么都不做。
//   当前页过滤（设计稿 §7.6）：每个页签的墙都注册过滤（目录会话的 query），在线页签上 setQuery 同样生效；面板里的输入位
//   是同一个过滤。
// - closeMap = 关面板（退出批量模式）+ 关闭目录（与 TUI 一样丢掉会话再打开一个空的，getQuery 是 ''）。

export type BravaisDirectoryProbeProps = {
    layerKey: string;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    items: LibraryHomeCard[];
    batchConfig?: LibraryDirectoryBatchConfig;
    onOpen: (card: LibraryHomeCard) => void;
};

export const bravaisDirectoryProps = () => propsOf<BravaisDirectoryProbeProps>(findPresentComponent(BravaisHomeDirectory));

export const isBravaisPanelOpen = (props: BravaisDirectoryProbeProps) => (
    Boolean(props.batchConfig) && useBravaisUiStore.getState().panelFor === props.layerKey
);

/** 打开目录树面板（窄缝 ▤ 的同一个入口）；没有批量的目录什么都不做。 */
export const openBravaisDirectoryPanel = (props: BravaisDirectoryProbeProps) => {
    if (!props.batchConfig) return;
    if (useBravaisSeamStore.getState().level !== 'full') useBravaisSeamStore.getState().setLevel('full');
    openBravaisPanel(props.layerKey);
};

export const closeBravaisDirectoryPanel = (props: BravaisDirectoryProbeProps) => {
    if (useBravaisUiStore.getState().panelFor === props.layerKey) closeBravaisPanel();
};
