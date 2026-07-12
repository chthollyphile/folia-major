import { useCallback, useRef } from 'react';

// Tracks first presentation per collection without causing React updates on viewport movement.
export const useProgressiveItemEntrance = (scopeKey: string) => {
    const stateRef = useRef<{ scopeKey: string; seen: Set<string>; }>({
        scopeKey,
        seen: new Set(),
    });

    if (stateRef.current.scopeKey !== scopeKey) {
        stateRef.current = { scopeKey, seen: new Set() };
    }

    return useCallback((itemKey: string) => {
        if (stateRef.current.seen.has(itemKey)) return false;
        stateRef.current.seen.add(itemKey);
        return true;
    }, []);
};
