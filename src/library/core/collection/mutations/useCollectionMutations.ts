import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MediaId } from '../../../../types/onlineMusic';
import type { LibraryCollectionDescriptor } from '../collection.contract';
import type { CollectionResource } from '../../shared/resource.contract';
import type { LibraryMutationPort } from '../../shared/ports.contract';
import type { CollectionMutationController, CollectionMutationSnapshot } from './mutations.contract';
import { createCollectionMutationController } from './collectionMutations.service';
import { collectionMutationDeps } from './collectionMutationDeps.service';
import { collectionKey } from '../collectionIdentity';
import { EMPTY_COLLECTION_MUTATION_SNAPSHOT } from './collectionMutationCapabilities';

// src/library/core/collection/mutations/useCollectionMutations.ts
// 变更动作控制器的两端：宿主用 useCollectionMutations 按集合会话创建、更新、释放控制器（自己不订阅快照，
// 所以进行中的状态变化不会让首页这棵大树重渲染）；renderer 用 useCollectionMutationSnapshot 订阅。

type UseCollectionMutationsParams = {
    descriptor: LibraryCollectionDescriptor | null;
    resource: CollectionResource | null;
    port: LibraryMutationPort;
    currentUserId?: MediaId | null;
};

/**
 * 宿主侧：同一个集合（按集合身份）一个控制器；描述、资源、端口、用户变化只是 update。
 *
 * 释放晚一拍：StrictMode 会同步地「卸载 → 再挂载」effect，先排一个定时器，再挂载时取消，
 * 控制器就不会在还被使用时被销毁。创建本身没有副作用（取状态要等第一个订阅者），
 * 所以渲染期多算出来、被丢弃的实例不会留下任何请求。
 */
export const useCollectionMutations = ({
    descriptor,
    resource,
    port,
    currentUserId,
}: UseCollectionMutationsParams): CollectionMutationController | null => {
    const sessionKey = descriptor ? collectionKey(descriptor) : null;
    const controller = useMemo(() => (
        descriptor
            ? createCollectionMutationController({ descriptor, resource, port, currentUserId, ...collectionMutationDeps })
            : null
        // 只按会话换实例；同一会话里的输入变化由下面的 update 同步。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ), [sessionKey]);

    // 在 renderer 的被动 effect 之前同步，能力不会晚一帧。
    useLayoutEffect(() => {
        if (controller && descriptor) {
            controller.update({ descriptor, resource, port, currentUserId });
        }
    }, [controller, currentUserId, descriptor, port, resource]);

    const pendingDisposeRef = useRef<{ controller: CollectionMutationController; timer: ReturnType<typeof setTimeout> } | null>(null);
    useEffect(() => {
        if (!controller) return;
        const pending = pendingDisposeRef.current;
        if (pending?.controller === controller) {
            clearTimeout(pending.timer);
            pendingDisposeRef.current = null;
        }
        return () => {
            const timer = setTimeout(() => controller.dispose(), 0);
            pendingDisposeRef.current = { controller, timer };
        };
    }, [controller]);

    return controller;
};

const noopUnsubscribe = () => {};

/** renderer 侧：订阅控制器快照；没有控制器时是「什么都不支持」的空快照。 */
export const useCollectionMutationSnapshot = (controller: CollectionMutationController | null): CollectionMutationSnapshot => {
    const subscribe = useCallback(
        (listener: () => void) => (controller ? controller.subscribe(listener) : noopUnsubscribe),
        [controller],
    );
    const getSnapshot = useCallback(
        () => (controller ? controller.getSnapshot() : EMPTY_COLLECTION_MUTATION_SNAPSHOT),
        [controller],
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
