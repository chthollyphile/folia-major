import type { LibrarySuiteTransitions } from '../../../core/suite/suite.contract';
import { planForOpening, useCollectionMorphStore } from './collectionMorphStore';
import { cardOf, probeCentredCard } from './morphProbes';
import { gridBackdrop } from './gridBackdrop';

// src/library/suites/grid/transitions/gridHostTransitions.ts
// 网格交给集合宿主的转场钩子（移形换影）：压栈前给新网格提交入场计划，返回前量好正在离开的那一页中间的卡片、
// 武装飞回去的那一趟，切换 suite 时丢掉没用掉的计划。逻辑原样来自 GridViewOverlayHost 的
// handlePushCollection / handleBackCollection 与 switchLibraryRenderer；宿主只在网格渲染当前集合层、
// 且没关闭动态效果时调用（见 core/suite/suite.contract 的 LibrarySuiteTransitions）。
// 从首页打开的那一页不经过这里：它的计划随点击的采集一起提交（CollectionMorphOverlay）。

export const gridHostTransitions: Omit<LibrarySuiteTransitions, 'Overlay'> = {
    backdrop: gridBackdrop,
    beforePush: ({ depth, origin }) => {
        // Nested open (album/artist inside a playlist): the incoming grid's cards
        // cascade in, matching every other grid entrance, and the clicked card's
        // cover flies to it where a card was clicked. A page reads its entrance at its
        // first render: the plan is committed here, before the navigation, for the
        // depth the page will stand at.
        if (depth >= 1) {
            useCollectionMorphStore.getState().commitPlan(origin === 'home' ? planForOpening() : { kind: 'cascade' }, depth + 1);
        }
    },
    beforeBack: ({ depth, origin }) => {
        // Arm the flight back before the view flips: the card at the middle of the
        // page being left is measured while the page is still there.
        // - top-level back (stack depth 1) → it flies onto the card the collection
        //   was opened from;
        // - nested back (album → playlist) → the page before comes back centred on
        //   the card that was clicked, behind a stand-in the card lands on.
        const morphStore = useCollectionMorphStore.getState();
        const centred = probeCentredCard();
        if (!centred) return;
        const from = cardOf(centred);
        if (depth <= 1 && origin === 'home' && morphStore.lastHome) {
            morphStore.armExit(from);
        } else if (depth > 1) {
            morphStore.armNestedExit(from);
        }
    },
    // 切换 suite 时清掉还没用掉的转场计划（它是给网格入场准备的）。
    reset: () => useCollectionMorphStore.getState().clear(),
};
