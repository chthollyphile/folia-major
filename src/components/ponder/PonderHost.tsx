import React, { Suspense, lazy, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { countRender } from '../../dev/renderCount';
import { usePonderStore } from '../../stores/usePonderStore';
import { usePonderHoverProbe } from '../../hooks/usePonderHoverProbe';
import { usePonderHoldToEnter } from './hold/usePonderHoldToEnter';
import { usePagePonderShortcut } from './hold/usePagePonderShortcut';
import { findPonderTarget } from './ponderRegistry';
import PonderHintCapsule from './PonderHintCapsule';
import PagePonderTouchButton from './PagePonderTouchButton';
import PonderNavigationPage from './PonderNavigationPage';
import type { Theme } from '../../types';

// src/components/ponder/PonderHost.tsx
// 思索功能的唯一挂载点：常驻的悬停探测 + 提示胶囊，以及按需懒加载的教程层。
//
// 教程层单独走 React.lazy，理由和 App.tsx:22 对 AutomixTransitionAnimation 的处理一样：
// animejs 约 38KB gz，只有真的要看教程时才该下载它。

const PonderStage = lazy(() => import('./PonderStage'));

type PonderHostProps = {
    theme?: Theme;
    isDaylight: boolean;
};

const PonderHost: React.FC<PonderHostProps> = ({ theme, isDaylight }) => {
    // 光标跟随必须一次重渲染都不产生，这个计数是那条约束唯一可验证的出口。
    countRender('PonderHost');
    const { t } = useTranslation();
    const hoveredTargetId = usePonderStore(state => state.hoveredTargetId);
    const hasSession = usePonderStore(state => state.session !== null);

    // 长按进度往这四个节点上写。节点由胶囊自己交上来（见 PonderHintCapsule）：换胶囊时页面里
    // 会有两个，这里指着的是在场的那一个的，退场的那个卸载时不会把它清掉。
    const wipeRef = useRef<HTMLDivElement | null>(null);
    const labelRef = useRef<HTMLSpanElement | null>(null);
    const holdLabelRef = useRef<HTMLSpanElement | null>(null);
    const cellRef = useRef<HTMLSpanElement | null>(null);

    const hoveredElementRef = usePonderHoverProbe();
    // 焦点在输入框里时 G 是打字，按住不会打开什么：这时不出悬停的胶囊，焦点离开再出。
    const canHoldG = usePonderHoldToEnter({ hoveredElementRef, wipeRef, labelRef, holdLabelRef, cellRef });
    // 页面级 Ctrl+G 也是长按，共用下面这一个胶囊和同一组擦除动画。
    const { isHolding: isPageHolding, targetId: pageTargetId } = usePagePonderShortcut({ wipeRef, labelRef, holdLabelRef, cellRef });

    const target = hoveredTargetId && canHoldG ? findPonderTarget(hoveredTargetId) : null;
    // 胶囊上写着「按满了会讲哪一个」。屏幕上常常同时压着好几个目标
    // （封面在面板里、标签页在标签排里），不写出来就只能靠猜。
    const namedTarget = isPageHolding
        ? (pageTargetId ? findPonderTarget(pageTargetId) : null)
        : target;

    return (
        <>
            <AnimatePresence>
                {/* 教程开着时不再显示胶囊 —— 它已经被 openPonder 清掉了，这里是第二道保险。
                    页面级长按压过悬停：Ctrl+G 讲的是整页，这时再标某个组件的名字是错的。 */}
                {(isPageHolding || target) && !hasSession && (
                    <PonderHintCapsule
                        key={isPageHolding ? 'page' : target!.id}
                        label={isPageHolding ? t('ponder.hintCapsulePage') : t('ponder.title')}
                        targetName={namedTarget ? t(namedTarget.titleKey) : undefined}
                        placement={isPageHolding ? 'page' : 'cursor'}
                        theme={theme}
                        isDaylight={isDaylight}
                        wipeRef={wipeRef}
                        labelRef={labelRef}
                        holdLabelRef={holdLabelRef}
                        cellRef={cellRef}
                    />
                )}
            </AnimatePresence>

            <PonderNavigationPage theme={theme} isDaylight={isDaylight} />

            <PagePonderTouchButton theme={theme} isDaylight={isDaylight} />

            {/* 教程层自己带进出场，AnimatePresence 负责在 session 清掉之后留住它把退场播完。 */}
            <AnimatePresence>
                {hasSession && (
                    <Suspense key="ponder-stage" fallback={null}>
                        <PonderStage theme={theme} isDaylight={isDaylight} />
                    </Suspense>
                )}
            </AnimatePresence>
        </>
    );
};

export default PonderHost;
