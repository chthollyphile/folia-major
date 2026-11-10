import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryArtistResource, LibraryArtistSnapshot } from './artist.contract';
import { createSnapshotGate, type SnapshotGate } from '../shared/snapshotGate';

// src/library/core/artist/useArtistResourceState.ts
// suite 订阅歌手资源的快照：紧急更新（详情、热门歌曲、状态）直接提交；专辑的后台分页放进 transition，
// holdBackground 为真时（网格拖拽中）先暂存，flushHeld 时再提交——与集合资源的 useCollectionResourceState
// 同一道门（core/shared/snapshotGate）。资源对象换了就在渲染期直接取新快照，不等 effect。

type MirroredState = {
    resource: LibraryArtistResource | null;
    snapshot: LibraryArtistSnapshot | null;
};

export const useArtistResourceState = (
    resource: LibraryArtistResource | null,
    { holdBackground }: { holdBackground?: () => boolean } = {},
) => {
    const [state, setState] = useState<MirroredState>(() => ({ resource, snapshot: resource?.getSnapshot() ?? null }));
    let current = state;
    if (state.resource !== resource) {
        current = { resource, snapshot: resource?.getSnapshot() ?? null };
        setState(current);
    }

    const holdRef = useRef(holdBackground);
    holdRef.current = holdBackground;
    const gateRef = useRef<SnapshotGate<LibraryArtistSnapshot> | null>(null);

    useEffect(() => {
        if (!resource) return;
        const commit = (snapshot: LibraryArtistSnapshot) => setState(previous => (
            previous.resource === resource && previous.snapshot === snapshot ? previous : { resource, snapshot }
        ));
        const gate = createSnapshotGate<LibraryArtistSnapshot>({
            hold: () => holdRef.current?.() ?? false,
            apply: (snapshot, mode) => {
                if (mode === 'transition') startTransition(() => commit(snapshot));
                else commit(snapshot);
            },
        });
        gateRef.current = gate;
        const unsubscribe = resource.subscribe(() => gate.offer(resource.getSnapshot()));
        // 渲染与订阅之间可能已经有更新：订阅后补读一次。
        commit(resource.getSnapshot());
        return () => {
            unsubscribe();
            if (gateRef.current === gate) gateRef.current = null;
        };
    }, [resource]);

    const flushHeld = useCallback(() => gateRef.current?.flush(), []);

    return { snapshot: current.snapshot, flushHeld };
};
