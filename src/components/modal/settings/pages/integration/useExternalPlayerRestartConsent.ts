import { useCallback, useEffect, useState } from 'react';
import {
    grantExternalPlayerRestartConsent,
    readExternalPlayerRestartConsent,
    revokeExternalPlayerRestartConsent,
} from '../../../../../services/onlineMusic/failure/externalPlayerConsent';

// src/components/modal/settings/pages/integration/useExternalPlayerRestartConsent.ts
// 设置里那一行「已允许 Folia 重启外部播放器」读的就是这里：同意只在第一次遇到时问一次
// （status.externalPlayerRestartTitle 那个弹窗），问过之后一直有效，直到有人在这里撤销。
// 状态由主进程记着（electron/restartConsent.cjs），这里只是它的一个开关。
//
// 画的是主进程**现在记着什么**，不是刚才按了什么：撤销要按它答回来的状态画，主进程没能删掉那次
// 同意时开关仍然是开着的——否则开关显示关、而 Folia 之后照样不问你。问不到主进程（不是设置行的那个
// 窗口、通道抛了）时不给开关机会，`granted` 为 null，行照常说出它做的事。

export const useExternalPlayerRestartConsent = (): {
    granted: boolean | null;
    setGranted: (granted: boolean) => void;
} => {
    const [granted, setGrantedState] = useState<boolean | null>(null);

    useEffect(() => {
        let live = true;
        void readExternalPlayerRestartConsent().then(answer => {
            if (live) setGrantedState(answer);
        });
        return () => {
            live = false;
        };
    }, []);

    const setGranted = useCallback((next: boolean) => {
        const answer = next ? grantExternalPlayerRestartConsent() : revokeExternalPlayerRestartConsent();
        void answer.then(kept => {
            // 主进程答的才是它的状态；只认 true / false，问不到就保持「不知道」。
            setGrantedState(typeof kept === 'boolean' ? kept : null);
        });
    }, []);

    return { granted, setGranted };
};
