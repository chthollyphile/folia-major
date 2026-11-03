import type { CollectionResourceKind, CollectionResourceSnapshot, CollectionUpdateHint } from '../../shared/resource.contract';

// src/library/core/collection/resource/collectionResourceState.service.ts
// 资源的不可变快照与通知。每次变化生成新快照对象；字段都没变时不通知，避免订阅者白渲染一遍。

export type CollectionResourcePatch = Partial<Omit<CollectionResourceSnapshot, 'key' | 'kind' | 'hint'>>;

export type CollectionResourceState = {
    get: () => CollectionResourceSnapshot;
    /** 合并补丁并通知；补丁里的字段与当前值全部相同时什么都不做。 */
    set: (patch: CollectionResourcePatch, hint: CollectionUpdateHint) => void;
    subscribe: (listener: () => void) => () => void;
    /** 销毁时清掉全部订阅。 */
    clear: () => void;
};

export const createCollectionResourceState = (
    key: string,
    kind: CollectionResourceKind,
    initial: CollectionResourcePatch = {},
): CollectionResourceState => {
    let snapshot: CollectionResourceSnapshot = {
        key,
        kind,
        revision: '',
        status: 'idle',
        tracks: [],
        error: null,
        sync: { status: 'none' },
        detail: null,
        hint: 'urgent',
        generation: 0,
        ...initial,
    };
    const listeners = new Set<() => void>();

    return {
        get: () => snapshot,
        set: (patch, hint) => {
            const changed = (Object.keys(patch) as Array<keyof CollectionResourcePatch>)
                .some(field => !Object.is(snapshot[field], patch[field]));
            if (!changed) return;
            snapshot = { ...snapshot, ...patch, hint };
            listeners.forEach(listener => listener());
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        clear: () => listeners.clear(),
    };
};
