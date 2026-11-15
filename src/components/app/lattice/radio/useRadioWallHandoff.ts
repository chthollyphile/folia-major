import { useEffect, type RefObject } from 'react';
import { rectCenter } from '../../../wall/wallHandoff';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../../stores/useWallHandoffStore';

// src/components/app/lattice/radio/useRadioWallHandoff.ts
// 电台墙在资料库墙 ↔ Lattice 翻牌交接里的一半（协议见 stores/useWallHandoffStore）。电台墙只有一行卡，不跟着
// 资料库墙的格子一张张翻：进来时等资料库墙翻出（closing 里卡不发），开翻那一刻把这一行发出来；离开时这一行淡出。
// 波次的起点是正在播放那张卡的中心。

export const RADIO_NOW_ATTR = 'data-radio-now';

export const useRadioWallHandoff = ({
    containerRef,
    measured,
}: {
    containerRef: RefObject<HTMLDivElement | null>;
    measured: boolean;
}) => {
    const session = useWallHandoffStore(state => state.session);
    const role = resolveWallHandoffRole(session, 'lattice');
    const phase = session?.phase ?? null;
    const sessionId = session?.id ?? null;

    useEffect(() => useWallHandoffStore.getState().registerLatticePeer({
        getOrigin: () => {
            const container = containerRef.current;
            const card = container?.querySelector(`[${RADIO_NOW_ATTR}]`) ?? container;
            if (!card) return null;
            const box = card.getBoundingClientRect();
            return rectCenter({ x: box.left, y: box.top, width: box.width, height: box.height });
        },
    }), [containerRef]);

    // 进 Lattice · closing：量好尺寸就报准备好（卡在开翻时才发，不用等它们摆好）。
    useEffect(() => {
        if (role !== 'in' || phase !== 'closing' || sessionId === null || !measured) return;
        useWallHandoffStore.getState().markLatticeReady(sessionId);
    }, [measured, phase, role, sessionId]);

    return {
        /** 进来的这一段还没开翻：这一行先不发。 */
        holdsDeal: role === 'in' && phase === 'closing',
        /** 回资料库墙已经开翻：这一行淡出。 */
        isLeaving: role === 'out' && phase !== null && phase !== 'waiting',
    };
};
