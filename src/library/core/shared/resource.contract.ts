import type { SongResult } from '../../../types';
import type { MediaId, ProviderCollection } from '../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';

// src/library/core/shared/resource.contract.ts
// Library Core 的公共契约：集合资源（加载状态与已取得的曲目）。能力、端口、变更动作和浏览会话的契约
// 在同目录的 capability / ports / mutations / session 里（原先都在 src/types/libraryUi.ts）。
// 这里只有数据与语义标记，不出现 ReactNode、DOM 几何或动画值；任何 renderer 都按同一份契约消费。

export type CollectionResourceKind = 'online' | 'navidrome' | 'static';

/** idle：还没开始；loading：首屏或重新加载中（已有曲目会保留）；ready / error：本轮结束。 */
export type CollectionLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * 存判别式而不是成品文案：翻译在渲染时做，切换语言才能跟着变。`cause` 是抛出来的那个错（在线集合）：renderer 可以拿它
 * 把失败分成有名字的情况再说（网格用 services/onlineMusic/failure 的 onlineFailureOf）；`message` 是那个错的原话。
 */
export type CollectionLoadError =
    | { kind: 'not-public'; cause?: unknown }
    | { kind: 'generic'; message: string; cause?: unknown };

/** 后台补页：没有 / 进行中 / 在某个上游 offset 处中断（可续传）。 */
export type CollectionSyncState =
    | { status: 'none' }
    | { status: 'syncing' }
    | { status: 'interrupted'; message: string; offset: number; cause?: unknown };

/**
 * 这次更新该怎么渲染：urgent 立即提交；background 是可打断的整表更新（大歌单的分页），
 * renderer 应放进 transition，必要时（例如拖拽中）可以暂存到合适的时机再提交。
 */
export type CollectionUpdateHint = 'urgent' | 'background';

export interface CollectionResourceSnapshot {
    readonly key: string;
    readonly kind: CollectionResourceKind;
    /** 当前加载所对应的集合版本（见 collectionRevision）。 */
    readonly revision: string;
    readonly status: CollectionLoadStatus;
    /** 已取得的曲目；每次变化都是新数组，从不原地修改。 */
    readonly tracks: SongResult[];
    readonly error: CollectionLoadError | null;
    readonly sync: CollectionSyncState;
    /** 在线集合的详情（封面、简介、总数等），没有时为 null。 */
    readonly detail: ProviderCollection | null;
    readonly hint: CollectionUpdateHint;
    /** 每次从头加载都会递增；renderer 据此丢掉暂存的旧页。 */
    readonly generation: number;
}

export type CollectionResourceContext = {
    currentUserId?: MediaId | null;
};

export interface CollectionResource {
    readonly key: string;
    readonly kind: CollectionResourceKind;
    getSnapshot(): CollectionResourceSnapshot;
    /** 返回退订函数。 */
    subscribe(listener: () => void): () => void;
    /** 让资源对齐这份集合描述；同一版本重复调用不会重复请求。 */
    ensure(descriptor: LibraryCollectionDescriptor, context: CollectionResourceContext): void;
    /** 跳过缓存从头重新加载；正在加载时忽略。 */
    reload(): void;
    /** 从中断的 offset 续传后台补页。 */
    resumeSync(): void;
    /** 释放后再次打开同一集合时，能否直接沿用这份已加载的结果。 */
    canReuse(descriptor: LibraryCollectionDescriptor): boolean;
    /** 不再有人看：停止进行中的请求与补页，保留已取得的数据。 */
    pause(): void;
    dispose(): void;
    /**
     * 权威提交：变更动作层（core/collection/mutations/collectionMutations.service）在上游确认后调用。立即记下删除
     * （后续分页不会再带回来）、立即提交并以 urgent 通知，并让缓存失效；返回的 Promise 在缓存写完后完成。
     * 界面上的退出动画是 renderer 自己的事（网格用快照门的展示保持按住当前一帧），资源不等它。
     */
    removeTracks(match: (track: SongResult) => boolean): Promise<void>;
    /**
     * 只删第 index 个条目（重复条目里的这一个，例如 Navidrome 按原始下标删歌）；该位置已不是
     * expectedKey（playback key）时拒绝并返回 false。在线资源按歌去重、按墓碑过滤后续分页，
     * 单个重复条目记不了墓碑，所以同一首还有别的条目时也拒绝（在线删除按歌走 removeTracks）。
     */
    removeAt(index: number, expectedKey: string): boolean;
    /** 把第 index 首替换为 next；该位置已不是 expectedKey 时拒绝并返回 false。 */
    replaceTrackAt(index: number, expectedKey: string, next: SongResult): boolean;
    /** 用 load 的结果整体替换曲目（例如切换每日推荐的日期），不分页、不写缓存；失败时保持原样并返回 false。 */
    replaceAll(load: () => Promise<SongResult[]>): Promise<boolean>;
}
