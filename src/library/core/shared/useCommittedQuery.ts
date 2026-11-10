import { useDeferredValue, useEffect, useState } from 'react';

// src/library/core/shared/useCommittedQuery.ts
// 输入中的筛选词先防抖再降级为可打断的渲染：大歌单逐字重算命中集合时，不堵住输入和动画。
// 初值就是当前词——从会话恢复出来的筛选在第一帧就生效，不必等一次防抖。

export const useCommittedQuery = (query: string, delayMs = 80): string => {
    const [debounced, setDebounced] = useState(query);

    useEffect(() => {
        if (query === debounced) return;
        const timeout = setTimeout(() => setDebounced(query), delayMs);
        return () => clearTimeout(timeout);
    }, [debounced, delayMs, query]);

    return useDeferredValue(debounced);
};
