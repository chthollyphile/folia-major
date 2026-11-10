import { useEffect } from 'react';
import { WALL_HANDOFF_TIMING } from '../../wall/wallHandoff';
import { libraryStageHandsOffWall } from '../../../library/registry';
import { useLibrarySuiteStore } from '../../../library/core/suite/useLibrarySuiteStore';
import { useAppViewStore, type AppView } from '../../../stores/useAppViewStore';
import { resolveReducedMotion, useMotionSettingsStore } from '../../../stores/useMotionSettingsStore';
import { useWallHandoffStore } from '../../../stores/useWallHandoffStore';

// src/components/app/presentation/wallHandoffDirector.ts
// 翻牌交接的 director：在视图切换的**同一刻**（zustand 的 subscribe 在 setState 里同步回调，早于 React 重渲染）决定
// 要不要开一次交接会话，这样 App 在切到新视图的第一次渲染里就知道首页层 / Lattice 要不要留着，不会先卸载再补救。
// - 首页 → Lattice：首页墙登记了 peer 且此刻能交接（bravais 的 stage 正画着、可交互）才开；否则（grid、grid 回退的层、
//   设置弹窗盖着）照旧。
// - Lattice → 首页：生效 suite 的 stage 声明了 stageWallHandoff、Lattice 正挂着才开；grid / TUI 照旧（Lattice 整层淡出）。
// - 交接途中视图又切走（回到原处、去播放页）：放弃这次交接，两边各自复原，不在途中再开一次。
// 播放页 ↔ Lattice 不经过这里。降低动态效果（Lattice 一面，或首页墙自己的换层转场降级）时会话是淡入淡出交叉。

const isLatticeReduced = () => resolveReducedMotion(useMotionSettingsStore.getState(), 'lattice');

/** 一次视图切换（from → to）要不要开 / 放弃交接。 */
export const handleWallHandoffViewChange = (from: AppView, to: AppView) => {
    const store = useWallHandoffStore.getState();
    const { session } = store;
    if (session) {
        const target: AppView = session.direction === 'to-lattice' ? 'lattice' : 'home';
        if (to !== target) store.abort();
        return;
    }
    if (from === 'home' && to === 'lattice') {
        const peer = store.homePeer;
        if (!peer?.canHandoff()) return;
        store.begin({
            direction: 'to-lattice',
            mode: isLatticeReduced() || peer.reduced() ? 'fade' : 'flip',
            seeThrough: peer.seeThrough(),
            timing: WALL_HANDOFF_TIMING,
        });
        return;
    }
    if (from === 'lattice' && to === 'home') {
        if (!store.latticePeer || !libraryStageHandsOffWall(useLibrarySuiteStore.getState().suite)) return;
        store.begin({
            direction: 'from-lattice',
            mode: isLatticeReduced() ? 'fade' : 'flip',
            seeThrough: null,
            timing: WALL_HANDOFF_TIMING,
        });
    }
};

/** App 装一次：订阅视图 store 的切换。 */
export const useWallHandoffDirector = () => {
    useEffect(() => {
        const unsubscribe = useAppViewStore.subscribe((state, previous) => {
            if (state.view !== previous.view) handleWallHandoffViewChange(previous.view, state.view);
        });
        return () => {
            unsubscribe();
            useWallHandoffStore.getState().abort();
        };
    }, []);
};
