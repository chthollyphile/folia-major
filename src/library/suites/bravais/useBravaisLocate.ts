import { useEffect, type MutableRefObject } from 'react';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { answerLocateRequest } from '../../../components/app/playing-song-locator/playingSongLocator';
import { resolveLocateStep } from '../../../components/app/playing-song-locator/resolveLocateStep';
import { usePlayingSongLocatorStore } from '../../../stores/usePlayingSongLocatorStore';
import { findItemSlotNear, type BravaisDisplay } from './bravaisDisplay';
import { findNowPlayingKey } from './bravaisProjection';
import type { BravaisFrameState } from './useBravaisFrame';
import { seamPointOf } from './bravaisAnchor';

// src/library/suites/bravais/useBravaisLocate.ts
// bravais 在「定位正在播放」（app/playing-song-locator）里的那一份：集合层与网格的集合页一样被问（同一个页键，见层描述的
// locate），用同一条规则回答（resolveLocateStep）。在墙上就展开离缝最近的那一份的聚焦卡（stage 的 showSlot，与列表面板的定位同一个做法）；
// 不在就由定位器说「这里没有」或「列表还不全」。播放页的「正在播放自」打开的层等曲目到齐再答。首页层不被问（没有 locate）。

/** 这首歌（条目 key）在墙上离缝最近的那一份（无限拼贴上有好几份）。 */
export const findItemSlotNearSeam = (
    display: BravaisDisplay,
    itemKey: string,
    frame: BravaisFrameState,
): WallSlot | null => findItemSlotNear(
    display,
    itemKey,
    seamPointOf(frame),
);

export const useBravaisLocate = ({
    display,
    active,
    isSettling,
    frameRef,
    showSlot,
}: {
    display: BravaisDisplay | null;
    /** stage 此刻可交互（当前层归 bravais、没在交接）。 */
    active: boolean;
    /** 墙还在翻牌 / 入场：落定了再找那一份。 */
    isSettling: boolean;
    frameRef: MutableRefObject<BravaisFrameState>;
    showSlot: (slot: WallSlot) => void;
}) => {
    const request = usePlayingSongLocatorStore(state => state.request);

    useEffect(() => {
        const locate = display?.layer.locate;
        if (!request || !display || !locate || !active || isSettling || request.collectionKey !== locate.pageKey) return;
        const itemKey = findNowPlayingKey(display.layer.items, request.songKey);
        const slot = itemKey ? findItemSlotNearSeam(display, itemKey, frameRef.current) : null;
        const step = resolveLocateStep({
            isHere: slot !== null,
            isFiltered: locate.isFiltered,
            waits: request.waits,
            cardsStillArriving: locate.cardsStillArriving,
            hasReadFailed: locate.hasReadFailed,
        });
        if (step.kind === 'wait') return;
        if (step.kind === 'unfilter') {
            locate.clearFilter();
            return;
        }
        if (slot) showSlot(slot);
        console.log(`[Locate] The bravais wall (${locate.pageKey}, ${display.layer.items.length} items) answered ${step.answer}`);
        answerLocateRequest(request.nonce, step.answer);
    }, [active, display, frameRef, isSettling, request, showSlot]);
};
