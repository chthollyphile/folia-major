import type { CollectionNavigationSnapshot, GridViewCollectionDescriptor } from './collection.contract';
import type { LibraryNavigationCrumb } from '../suite/suite.contract';
import { collectionKey } from './collectionIdentity';

// src/library/core/collection/collectionNavigation.ts
// 集合导航栈的纯规则（N1）：进入一个集合时栈怎么变（只折叠紧邻往返），面包屑跳层之后的栈，以及历史日志比较记录用的
// 「同一个位置 / 同一次浏览」。store 的 push、宿主（安排转场）与导航层（hooks/useAppNavigation）共用同一份判断。
//
// 为什么只折叠紧邻往返、不无条件去环：在歌手页和专辑页之间来回点（X → Y → X）是最常见的「越点越深」，折成一次返回
// 就够了；而 A → B → C → D → E 再点 B 时退回 B 会丢掉 C、D、E，用户接着按返回期待回到 E。所以只有要进入的集合正好
// 是上一层（倒数第二层）时当作返回，其余照常压栈——栈里可以有重复的集合，深度不设上限。

/**
 * 进入一个集合的结果：
 * - push：压一层，snapshot 是压完之后的栈；
 * - back：它正好是上一层（stack[depth-2]），当作一次返回。to 是返回之后的栈（弹掉栈顶）；导航层走应用内返回的路径
 *   （有历史就 history.back()），store 自己不动；
 * - noop：没有打开的栈，或它就是栈顶（详情页里指向自己所属集合的链接）。
 */
export type CollectionPushDecision =
    | { kind: 'push'; snapshot: CollectionNavigationSnapshot }
    | { kind: 'back'; to: CollectionNavigationSnapshot }
    | { kind: 'noop' };

const NOOP: CollectionPushDecision = Object.freeze({ kind: 'noop' });

/** 进入 collection 时导航栈该怎么变（按 collectionKey 比较）：栈顶相同 → noop，倒数第二层相同 → back，其余 → push。 */
export const resolveCollectionPush = (
    snapshot: CollectionNavigationSnapshot | null,
    collection: GridViewCollectionDescriptor,
): CollectionPushDecision => {
    if (!snapshot || snapshot.stack.length === 0) return NOOP;
    const key = collectionKey(collection);
    const depth = snapshot.stack.length;
    if (collectionKey(snapshot.stack[depth - 1]) === key) return NOOP;
    if (depth >= 2 && collectionKey(snapshot.stack[depth - 2]) === key) {
        return { kind: 'back', to: { ...snapshot, stack: snapshot.stack.slice(0, -1) } };
    }
    return {
        kind: 'push',
        snapshot: { ...snapshot, stack: [...snapshot.stack, collection] },
    };
};

/**
 * 跳到第 depth 层（面包屑点击）之后的栈：depth 是保留的层数，0 表示整个关掉（结果为 null）。栈里有重复的集合时，
 * 按位置算：点哪一项就退到哪一层。depth 不是比当前更浅的整数（等于或深于当前、负数、小数）时返回 undefined，
 * 调用方什么都不做。
 */
export const resolveCollectionPopTo = (
    snapshot: CollectionNavigationSnapshot | null,
    depth: number,
): CollectionNavigationSnapshot | null | undefined => {
    if (!snapshot || !Number.isInteger(depth) || depth < 0 || depth >= snapshot.stack.length) return undefined;
    if (depth === 0) return null;
    return { ...snapshot, stack: snapshot.stack.slice(0, depth) };
};

/**
 * 导航栈投影成面包屑（B11）：每一层的 collectionKey、名字与类型，自底向上按位置排列（重复的集合各占一项）。
 * 没有打开的栈时是空数组。纯投影，名字取描述里的 name（缺了就是空串，由 suite 决定怎么显示）。
 */
export const projectNavigationTrail = (
    snapshot: CollectionNavigationSnapshot | null | undefined,
): LibraryNavigationCrumb[] => (snapshot?.stack ?? []).map(collection => ({
    key: collectionKey(collection),
    name: typeof collection.name === 'string' ? collection.name : '',
    type: collection.type,
}));

/** 两份快照是不是同一个位置：都为空，或同 origin、同深度、逐层 collectionKey 一致（描述里的其它字段不比）。 */
export const isSameCollectionPath = (
    a: CollectionNavigationSnapshot | null | undefined,
    b: CollectionNavigationSnapshot | null | undefined,
): boolean => {
    const aEmpty = !a || a.stack.length === 0;
    const bEmpty = !b || b.stack.length === 0;
    if (aEmpty || bEmpty) return aEmpty && bEmpty;
    return a.origin === b.origin
        && a.stack.length === b.stack.length
        && a.stack.every((collection, index) => collectionKey(collection) === collectionKey(b.stack[index]));
};

/** 两份快照是不是同一次集合浏览：同 origin、同一个根集合（深度不论）。 */
export const isSameCollectionVisit = (
    a: CollectionNavigationSnapshot | null | undefined,
    b: CollectionNavigationSnapshot | null | undefined,
): boolean => Boolean(
    a && b && a.stack.length > 0 && b.stack.length > 0
    && a.origin === b.origin
    && collectionKey(a.stack[0]) === collectionKey(b.stack[0]),
);
