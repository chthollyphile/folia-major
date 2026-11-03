import { create } from 'zustand';
import type { OnlineProviderId } from '../../types/onlineMusic';

// src/components/login/loginWindowStore.ts
// 登录窗口开没开、打开时选中哪个平台、是从哪里打开的。任何界面要打开登录窗口都调 openLoginWindow：
// 这是唯一的入口；关它也只有 closeLoginWindow 这一个关法。
// 窗口本身（LoginHost）挂在 App 最外层，哪个界面打开它都是同一个窗口。

/** 按下去打开窗口的那个东西：中心在哪，多大（像素），窗口开在哪个平台上（没有选就是 null）。 */
export type LoginOrigin = { x: number; y: number; size: number; providerId: OnlineProviderId | null };

type LoginWindowState = {
    isOpen: boolean;
    // 打开时选中的平台；null 是不替用的人选。
    providerId: OnlineProviderId | null;
    // 每打开一次加一：同一个平台连着打开两次也是两次。
    requestId: number;
    // 按下去打开窗口的那个东西在哪：窗口从那一边出来，平台的记号从那里走进标题。不知道就是 null。
    origin: LoginOrigin | null;
    // 一次登录确认了，登录成功的动画还没放完：这个平台的头像要飞向切换器，切换器画的是它的时候先不画自己的那一个。
    landing: OnlineProviderId | null;
};

export const useLoginWindowStore = create<LoginWindowState>(() => ({ isOpen: false, providerId: null, requestId: 0, origin: null, landing: null }));

/** 打开登录窗口。`pressed` 是按下去的那个东西（按钮、头像），给了窗口就从它那一边出来。 */
export const openLoginWindow = (providerId: OnlineProviderId | null = null, pressed?: Element | null): void => {
    const box = pressed?.getBoundingClientRect();
    const origin = box && box.width > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2, size: Math.min(box.width, box.height), providerId } : null;
    useLoginWindowStore.setState(state => ({ isOpen: true, providerId, origin, requestId: state.requestId + 1 }));
};

export const closeLoginWindow = (): void => {
    useLoginWindowStore.setState({ isOpen: false });
};

// 挂着的 host 有几个。
let hosts = 0;

/**
 * host 挂上时调；回的那个函数在它卸下时调。最后一个 host 真的卸下了，窗口的开关才关：开关不比窗口活得久，
 * 下一次主页出来时它不会自己开着。开发时 React.StrictMode 会把新挂上的 effect 收一次、当场再装一次：
 * 那不是卸下，所以收的时候先不关，等一个微任务，那时又有 host 挂着就什么都不做（窗口可能是在 host 挂上
 * 之前打开的，不能被这一下关掉）。
 */
export const loginHostMounted = (): (() => void) => {
    hosts += 1;
    return () => {
        hosts -= 1;
        queueMicrotask(() => {
            if (hosts === 0) closeLoginWindow();
        });
    };
};

export const setLoginLanding = (landing: OnlineProviderId | null): void => {
    if (useLoginWindowStore.getState().landing !== landing) useLoginWindowStore.setState({ landing });
};
