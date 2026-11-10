import { useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { useCollectionNavigationStore } from '../../../../stores/useCollectionNavigationStore';
import { useMorphPlanFor } from './collectionMorphStore';
import type { CollectionMorphPlan } from './morphGeometry';

// src/library/suites/grid/transitions/useGridMorphPlan.ts
// 网格集合层读自己的入场计划。原先由宿主订阅转场 store 再当 props 传下来；R3 起这是网格专属的输入，
// 不进 surface 契约，由网格的 surface 组件自己读。
// 三点与原来一致：关闭「降低动态效果」里的移形换影时没有计划；计划只给它是为之提交的那一层（导航里第几层，
// 见 collectionMorphStore 的 planDepth：经浏览器历史退回的上一页不是那一页）；正在退场的那一层不再跟着 store 变
// （AnimatePresence 里退场的子树拿到的一直是最后一次的 props，宿主重渲染也不会更新它）。

export const useGridMorphPlan = (): CollectionMorphPlan | null => {
    const isPresent = useIsPresent();
    const morphEnabled = !useReducedMotionFor('collectionMorph');
    // The plan of the page on show, which is not every plan there is: see `planDepth`.
    const depth = useCollectionNavigationStore(state => state.snapshot?.stack.length ?? 0);
    const plan = useMorphPlanFor(depth);
    const live = morphEnabled ? plan : null;
    const frozenRef = useRef(live);
    if (isPresent) frozenRef.current = live;
    return frozenRef.current;
};
