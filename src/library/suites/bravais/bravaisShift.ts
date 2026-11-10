import type { CollectionNavigationOrigin } from '../../core/collection/collection.contract';
import type { LibraryNavigationContext } from '../../core/suite/suite.contract';
import type { BravaisLayer } from './bravaisLayer';

// src/library/suites/bravais/bravaisShift.ts
// 换层的种类（设计稿 §7 转场语法，B11 补齐来源）：纯规则，useBravaisDisplay 按它选翻牌 / 波次。
// - push / back：深度变深 / 变浅，从起点磁贴 / 缝翻牌；
// - replace：同一深度换了层（首页换页签，整墙出场 → 入场）；
// - enter：从搜索页或播放页打开集合（origin 为 search / player，下面没有首页墙）——整墙入场到集合层，没有起点磁贴；
// - exit：从这样打开的集合回到来源（深度回到 0）——整墙出场（下面的首页层在搜索页 / 淡出的首页之下落回）。
// 另外判断「同一个键、不同深度」算不算换层：N1 只折叠紧邻往返，栈里可以有重复的集合（A › B › A），面包屑从第 3 层
// 跳回第 1 层时宿主不换 surface（同一个 collectionKey），层描述可能还是同一个对象，只有深度变了。

export type BravaisShiftKind = 'push' | 'back' | 'replace' | 'enter' | 'exit';

/** 从这里打开的集合下面没有首页墙（搜索页 / 播放页）。 */
export const isSourceOrigin = (origin: CollectionNavigationOrigin | null | undefined) => origin === 'search' || origin === 'player';

/** 深度变化 → 换层种类。origin 分别是换层前（显示着的那一层打开时）与换层后的导航来源。 */
export const resolveShiftKind = ({
    fromDepth,
    toDepth,
    fromOrigin,
    toOrigin,
}: {
    fromDepth: number;
    toDepth: number;
    fromOrigin: CollectionNavigationOrigin | null;
    toOrigin: CollectionNavigationOrigin | null;
}): BravaisShiftKind => {
    if (toDepth > fromDepth) return fromDepth === 0 && isSourceOrigin(toOrigin) ? 'enter' : 'push';
    if (toDepth < fromDepth) return toDepth === 0 && isSourceOrigin(fromOrigin) ? 'exit' : 'back';
    return 'replace';
};

/**
 * store 给的层正是导航此刻的那一层（首页层在深度 0；集合 / 歌手层的键等于导航栈顶的键）。只有对得上时，「键没变、
 * 深度变了」才算换层——换层交接的那一拍 store 里还是上一层的登记（键对不上），要等新层到了再换。
 * 没有 trail（旧调用方）时深度大于 0 一律对不上，保持只按键换层的旧行为。
 */
export const layerMatchesNavigation = (layer: BravaisLayer, navigation: Pick<LibraryNavigationContext, 'depth' | 'trail'>) => (
    navigation.depth === 0
        ? layer.surface === 'home'
        : layer.surface !== 'home' && navigation.trail?.[navigation.depth - 1]?.key === layer.key
);
