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

export const useExternalPlayerRestartConsent = (): { granted: boolean; setGranted: (granted: boolean) => void } => {
    const [granted, setGrantedState] = useState(false);

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
        // 先按按下的结果画，再把主进程记着的读回来纠正：这个开关只有那一个来源。
        setGrantedState(next);
        const answer = next ? grantExternalPlayerRestartConsent() : revokeExternalPlayerRestartConsent().then(() => false);
        void answer.then(kept => setGrantedState(kept));
    }, []);

    return { granted, setGranted };
};
