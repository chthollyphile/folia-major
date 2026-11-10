import { useEffect, useRef } from 'react';
import { useBottomDockStore } from '../../../stores/useBottomDockStore';

// src/components/app/playing-song-locator/useRegisterWallLocate.ts
// 墙（Lattice、bravais 资料库墙）把“定位正在播放的歌”登记给底部那一排。紧凑档（窗口窄于 960，progress-bar v3）
// 里墙工具按钮上方那颗定位按钮不画，改由进度条胶囊左端的封面按；宽屏照旧是那颗按钮，登记了也不用。

type WallLocateRegistration = {
    run: () => void;
    isHere: boolean;
    isSeeking: boolean;
    title: string;
};

/**
 * owner 区分是哪面墙；active 为 false 或 locate 为 null 时撤回。
 * run 每次渲染可能换身份，存进 ref 里：store 只在亮不亮、转不转圈、标题变了时才更新。
 */
export const useRegisterWallLocate = (owner: string, locate: WallLocateRegistration | null, active: boolean): void => {
    const runRef = useRef<() => void>(() => undefined);
    runRef.current = locate?.run ?? (() => undefined);
    const isOn = active && locate !== null;
    const isHere = locate?.isHere ?? false;
    const isSeeking = locate?.isSeeking ?? false;
    const title = locate?.title ?? '';
    // 状态变了就地更新，不先撤再登：撤了再登会排到最后，盖过本来在上面的那面墙。
    useEffect(() => {
        const store = useBottomDockStore.getState();
        if (!isOn) {
            store.setWallLocate(owner, null);
            return;
        }
        store.setWallLocate(owner, { run: () => runRef.current(), isHere, isSeeking, title });
    }, [owner, isOn, isHere, isSeeking, title]);
    useEffect(() => () => useBottomDockStore.getState().setWallLocate(owner, null), [owner]);
};
