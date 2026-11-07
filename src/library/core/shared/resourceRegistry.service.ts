// src/library/core/shared/resourceRegistry.service.ts
// 宿主持有的资源（集合资源、歌手资源）共用的生命周期：谁在用、什么时候停、什么时候可以复用。
//
// - peekOrCreate 在渲染期调用，只创建对象、不发请求（请求由 ensure 触发）；
// - retain 在 effect 里调用并返回释放函数。StrictMode 会同步地「挂载 → 卸载 → 挂载」，
//   所以释放后先等一个宽限期，期间重新 retain 就什么都不发生，不会重复请求；
// - 只被 peek、一直没被 retain 的实例（渲染被丢弃）过一段时间后销毁；
// - 最后一个使用者离开后资源先暂停；`retainable` 认可的放进一个有界的 LRU，其余直接销毁。
//   复用与否由资源自己判断（canReuse），所以复用不会绕过资源自己的「重进时要不要重新读」的规则。
// 原先只有集合资源用（collectionResourceRegistry），P4.1 起歌手资源用同一套纪律。

/** registry 只要求资源有这几样。 */
export type RegistryResource<TDescriptor> = {
    readonly key: string;
    pause(): void;
    dispose(): void;
    canReuse(descriptor: TDescriptor): boolean;
};

export type ResourceRegistryOptions = {
    releaseGraceMs?: number;
    orphanGraceMs?: number;
    maxRetained?: number;
};

type LiveEntry<TResource> = {
    resource: TResource;
    refs: number;
    releaseTimer?: ReturnType<typeof setTimeout>;
    orphanTimer?: ReturnType<typeof setTimeout>;
};

export type ResourceRegistry<TResource, TDescriptor> = {
    peekOrCreate: (key: string, descriptor: TDescriptor, create: () => TResource) => TResource;
    /** 返回释放函数（重复调用无害）；资源已被销毁时返回 null，调用方应重新 peek。 */
    retain: (resource: TResource) => (() => void) | null;
    /** 测试与诊断用：当前在用的资源数与 LRU 里的资源数。 */
    size: () => { live: number; retained: number };
};

export const createResourceRegistry = <TResource extends RegistryResource<TDescriptor>, TDescriptor>({
    releaseGraceMs = 0,
    orphanGraceMs = 5000,
    maxRetained = 3,
    retainable,
}: ResourceRegistryOptions & {
    /** 最后一个使用者离开后这个资源值不值得留在 LRU 里（例如只有在线集合）。 */
    retainable: (resource: TResource) => boolean;
}): ResourceRegistry<TResource, TDescriptor> => {
    const live = new Map<string, LiveEntry<TResource>>();
    const retained = new Map<string, TResource>();

    const clearTimers = (entry: LiveEntry<TResource>) => {
        if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
        if (entry.orphanTimer) clearTimeout(entry.orphanTimer);
        entry.releaseTimer = undefined;
        entry.orphanTimer = undefined;
    };

    // 最后一个使用者走了：暂停，值得留的进 LRU，超出上限的最旧那个销毁。
    const settle = (key: string, entry: LiveEntry<TResource>) => {
        if (live.get(key) !== entry || entry.refs > 0) return;
        clearTimers(entry);
        live.delete(key);
        entry.resource.pause();
        if (!retainable(entry.resource)) {
            entry.resource.dispose();
            return;
        }
        retained.delete(key);
        retained.set(key, entry.resource);
        while (retained.size > maxRetained) {
            const [oldestKey, oldest] = retained.entries().next().value as [string, TResource];
            retained.delete(oldestKey);
            oldest.dispose();
        }
    };

    const watchOrphan = (key: string, entry: LiveEntry<TResource>) => {
        entry.orphanTimer = setTimeout(() => settle(key, entry), orphanGraceMs);
    };

    return {
        peekOrCreate: (key, descriptor, create) => {
            const current = live.get(key);
            if (current) return current.resource;

            const kept = retained.get(key);
            if (kept) {
                retained.delete(key);
                if (kept.canReuse(descriptor)) {
                    const entry: LiveEntry<TResource> = { resource: kept, refs: 0 };
                    live.set(key, entry);
                    watchOrphan(key, entry);
                    return kept;
                }
                kept.dispose();
            }

            const entry: LiveEntry<TResource> = { resource: create(), refs: 0 };
            live.set(key, entry);
            watchOrphan(key, entry);
            return entry.resource;
        },
        retain: (resource) => {
            const entry = live.get(resource.key);
            if (!entry || entry.resource !== resource) return null;
            entry.refs += 1;
            clearTimers(entry);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                entry.refs -= 1;
                if (entry.refs > 0) return;
                entry.releaseTimer = setTimeout(() => settle(resource.key, entry), releaseGraceMs);
            };
        },
        size: () => ({ live: live.size, retained: retained.size }),
    };
};
