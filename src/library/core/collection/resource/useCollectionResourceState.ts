import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionResource, CollectionResourceSnapshot, CollectionUpdateHint } from '../../shared/resource.contract';
import { createSnapshotGate, type SnapshotGate } from '../../shared/snapshotGate';

// src/library/core/collection/resource/useCollectionResourceState.ts
// renderer 订阅资源快照。紧急更新直接 setState，后台更新（大歌单分页）放进 transition；
// holdBackground 为真时（网格拖拽中）后台更新先暂存，flushHeld 时再提交。
// 资源对象换了（例如本地曲目变化后的新静态资源）就在渲染期直接取新快照，不等 effect，避免闪一帧旧数据。
// holdPresentation / releasePresentation：renderer 的动画要求界面暂时停在当前这一帧（网格删卡的退出动画）时，
// 这期间的一切更新（紧急的、后台的，连同资源对象换新）都先按住，最后一个 token 放开时提交最新的那份。

type MirroredState = {
    resource: CollectionResource | null;
    snapshot: CollectionResourceSnapshot | null;
};

/** 经过门的一次通知：hint 单独拿出来，补读的那一份可以按紧急处理。 */
type GateOffer = { hint: CollectionUpdateHint; snapshot: CollectionResourceSnapshot };

export const useCollectionResourceState = (
    resource: CollectionResource | null,
    { holdBackground }: { holdBackground?: () => boolean } = {},
) => {
    const [state, setState] = useState<MirroredState>(() => ({ resource, snapshot: resource?.getSnapshot() ?? null }));
    // 展示保持的 token 存在这里而不是某一个门上：资源换新时新门要接着按住。
    const presentationTokensRef = useRef<Set<string>>(new Set());
    let current = state;
    if (state.resource !== resource && presentationTokensRef.current.size === 0) {
        current = { resource, snapshot: resource?.getSnapshot() ?? null };
        setState(current);
    }

    const resourceRef = useRef(resource);
    resourceRef.current = resource;
    const holdRef = useRef(holdBackground);
    holdRef.current = holdBackground;
    const gateRef = useRef<SnapshotGate<GateOffer> | null>(null);

    useEffect(() => {
        if (!resource) return;
        const commit = (snapshot: CollectionResourceSnapshot) => setState(previous => (
            previous.resource === resource && previous.snapshot === snapshot ? previous : { resource, snapshot }
        ));
        const gate = createSnapshotGate<GateOffer>({
            hold: () => holdRef.current?.() ?? false,
            apply: ({ snapshot }, mode) => {
                if (mode === 'transition') startTransition(() => commit(snapshot));
                else commit(snapshot);
            },
        });
        presentationTokensRef.current.forEach(token => gate.holdPresentation(token));
        gateRef.current = gate;
        const unsubscribe = resource.subscribe(() => {
            const snapshot = resource.getSnapshot();
            gate.offer({ hint: snapshot.hint, snapshot });
        });
        // 渲染与订阅之间可能已经有更新：订阅后补读一次。展示保持期间（例如保持中资源换了新的）经由门暂存。
        const latest = resource.getSnapshot();
        if (gate.isPresentationHeld()) gate.offer({ hint: 'urgent', snapshot: latest });
        else commit(latest);
        return () => {
            unsubscribe();
            if (gateRef.current === gate) gateRef.current = null;
        };
    }, [resource]);

    const flushHeld = useCallback(() => gateRef.current?.flush(), []);

    const holdPresentation = useCallback((token: string) => {
        presentationTokensRef.current.add(token);
        gateRef.current?.holdPresentation(token);
    }, []);

    const releasePresentation = useCallback((token: string) => {
        if (!presentationTokensRef.current.delete(token)) return;
        gateRef.current?.releasePresentation(token);
        if (presentationTokensRef.current.size > 0) return;
        // 保持期间资源换了、新资源还没经门送来快照（或者换成了 null）：直接对齐到当前资源。
        setState(previous => {
            const latest = resourceRef.current;
            return previous.resource === latest ? previous : { resource: latest, snapshot: latest?.getSnapshot() ?? null };
        });
    }, []);

    return { snapshot: current.snapshot, flushHeld, holdPresentation, releasePresentation };
};
