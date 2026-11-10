import { useEffect, useSyncExternalStore } from 'react';
import type { ProviderCollection } from '../../../../types/onlineMusic';
import {
    ensureSquareCollections,
    getSquareCollections,
    subscribeSquareCollections,
} from '../../../../services/onlineMusic/lxmusic/lxSquareCollections';

// src/library/core/home/online/useLxSquareCollections.ts
// 洛雪选中时的「歌单」内容：四家平台的歌单广场。只有洛雪在用时才去取。
// 未取到时给空数组，页面退回「这个平台没有账户歌单」的原状态，不挡首次渲染。

const EMPTY: ProviderCollection[] = [];

export const useLxSquareCollections = (active: boolean): ProviderCollection[] => {
    const collections = useSyncExternalStore(
        subscribeSquareCollections,
        () => (active ? getSquareCollections() : EMPTY),
        () => EMPTY,
    );
    useEffect(() => {
        if (active) void ensureSquareCollections();
    }, [active]);
    return collections;
};
