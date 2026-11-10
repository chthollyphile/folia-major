import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { useSupportsFinePointer } from '../../hooks/useSupportsFinePointer';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { usePonderStore } from '../../stores/usePonderStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { openCurrentPagePonder } from '../../services/ponder/pagePonderTarget';
import type { Theme } from '../../types';
import { ponderMotionTokens } from './ponderMotion';
import { ponderLayerTokens, ponderWindowTokens } from './ponderTheme';

// src/components/ponder/PagePonderTouchButton.tsx
// 触屏上代替 Ctrl+G 的入口。
//
// 它贴右上角，不贴右下角：右下角是操作按钮最密的一块地方 —— 底部控制条、集合页那颗
// 列表/搜索按钮、播放页的侧边手柄都挤在那儿，一颗常驻的浮动按钮压上去就是挡路。
//
// 而且它是限时的：落地或换页时露四秒说明自己在，然后自己收起来。想再叫出来就点一下
// 右上角那块热区。这条和面板手柄在触屏上的做法是同一套（UnifiedPanel 的边缘热区）：
// 触屏没有悬停，所以屏幕的角落本身就是入口。
//
// 热区不是一个真实元素，是 window 上一个 passive 监听按坐标判的。摆一个
// pointer-events-auto 的方块在右上角，等于把「挡住右下角」这个问题原样搬到右上角。

/** 露出来之后停留多久。够读一眼，又不至于一直杵在那里。 */
const REVEAL_MS = 4000;

/** 右上角热区的边长，px。按触摸目标给，不按视觉尺寸给。 */
const HOTSPOT_SIZE_PX = 96;

type PagePonderTouchButtonProps = {
    theme?: Theme;
    isDaylight: boolean;
};

/** Touch-only equivalent of Ctrl+G. It deliberately has no component-target API. */
const PagePonderTouchButton: React.FC<PagePonderTouchButtonProps> = ({ theme, isDaylight }) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const isCoarsePointer = !useSupportsFinePointer();
    const hasSession = usePonderStore(state => state.session !== null);
    const isOnboardingOpen = useSettingsModalStore(state => state.isUserGuideModalOpen);
    const showTouchButton = usePonderStore(state => state.showPonderTouchButton);
    const view = useAppViewStore(state => state.view);

    const [isRevealed, setIsRevealed] = useState(true);
    const hideTimerRef = useRef<number | null>(null);
    // 监听器里要读当前的显隐，但它不该因为显隐变化就解绑重绑。
    const isRevealedRef = useRef(isRevealed);
    isRevealedRef.current = isRevealed;
    /**
     * 「这一下是把它叫出来的，不是按它」。
     *
     * 热区和按钮占的是同一块地方：隐藏时按钮 pointer-events-none，所以 pointerdown 落到底下，
     * 热区把它露出来；可同一次触摸的 click 是在那之后才派发的，那时按钮已经可点了，
     * 于是一下变成两件事 —— 叫出来，然后立刻进了教程。这面旗就是用来吃掉那一次 click 的。
     */
    const suppressNextClickRef = useRef(false);

    const reveal = useCallback(() => {
        setIsRevealed(true);
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setIsRevealed(false);
        }, REVEAL_MS);
    }, []);

    // 换页时重新露一次：这颗按钮讲的是「思索当前页面」，页面换了就值得再说一遍自己在。
    useEffect(() => {
        if (!isCoarsePointer || !showTouchButton) {
            return undefined;
        }
        reveal();
        return () => {
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };
    }, [isCoarsePointer, reveal, showTouchButton, view]);

    // 右上角热区。按坐标判而不是摆一个元素：摆元素就会挡住底下的东西，
    // 而「不挡路」正是这颗按钮从右下角搬过来的全部理由。
    useEffect(() => {
        if (!isCoarsePointer || !showTouchButton || typeof window === 'undefined') {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') {
                return;
            }

            const inHotspot = event.clientY <= HOTSPOT_SIZE_PX
                && event.clientX >= window.innerWidth - HOTSPOT_SIZE_PX;
            if (!inHotspot) {
                // 手指落在别处，上一面没用掉的旗就作废 —— 免得它留到下一次真正的点击上。
                suppressNextClickRef.current = false;
                return;
            }

            // 按钮已经露着的时候，这一下就是在按它，不该吃掉。
            suppressNextClickRef.current = !isRevealedRef.current;
            reveal();
        };

        window.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
        return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    }, [isCoarsePointer, reveal, showTouchButton]);

    if (!isCoarsePointer || !showTouchButton || hasSession || isOnboardingOpen) {
        return null;
    }

    return (
        <button
            type="button"
            data-testid="page-ponder-touch-button"
            data-ponder-touch-revealed={isRevealed || undefined}
            onClick={() => {
                if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                }
                openCurrentPagePonder();
            }}
            aria-label={t('ponder.openPage')}
            // 收起来之后不可点：留着可点的话，右上角会变成一块看不见却能按的地方。
            // 出来时淡入、从略小长到位；关了微动效就只淡入淡出。
            className={`fixed right-5 top-5 z-[190] h-12 w-12 rounded-full transition-[opacity,transform] active:scale-95 ${
                isRevealed ? 'pd-t-enter opacity-100' : `pd-t-base pointer-events-none opacity-0 ${calm ? '' : 'scale-[0.94]'}`
            }`}
            style={{ ...ponderLayerTokens(isDaylight, theme), ...ponderMotionTokens(calm) }}
        >
            <span
                className="grid h-full w-full place-items-center rounded-full bg-[var(--st-card)] text-[color:var(--st-t1)] shadow-[0_0_0_1px_var(--st-line),0_8px_20px_rgba(0,0,0,0.25)]"
                style={ponderWindowTokens(isDaylight, theme, calm)}
            >
                <Lightbulb size={20} aria-hidden="true" />
            </span>
        </button>
    );
};

export default PagePonderTouchButton;
