import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { onNetworkStatusChange } from '../utils/networkStatus';
import { omni } from '../services/onlineMusic/omni';
import { useStatusMessageStore } from '../stores/useStatusMessageStore';

// src/hooks/useNetworkRecovery.ts
// 弱网的「恢复」半环：断网时请求会快速失败降级，网络回来后页面仍停在旧数据——
// 监听 online 事件，丢弃在途请求缓存并提示用户刷新当前视图。改动刻意小：只广播，
// 不替各视图决定怎么刷（它们自己的 invalidate 路径已经存在）。
export const useNetworkRecovery = () => {
    const { t } = useTranslation();
    useEffect(() => {
        const unsubscribe = onNetworkStatusChange((online) => {
            const store = useStatusMessageStore.getState();
            if (online) {
                // 在途请求的结果可能正是网络故障期产生的陈旧错误，清掉让下次访问重新拉。
                omni.invalidateActiveRequests();
                store.setMessage({ type: 'info', text: t('status.networkRestored') });
            } else {
                store.setMessage({ type: 'error', text: t('status.networkLost') });
            }
        });
        return unsubscribe;
    }, [t]);
};
