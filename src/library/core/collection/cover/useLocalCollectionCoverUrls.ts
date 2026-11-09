import { useSyncExternalStore } from 'react';
import { localCollectionCovers } from './localCollectionCovers.service';

// src/library/core/collection/cover/useLocalCollectionCoverUrls.ts
// 订阅本地集合的自定义封面（键 → URL）。第一次订阅时读存储；设好、换掉、恢复默认都会让订阅者拿到新的 Map。

export const useLocalCollectionCoverUrls = (): ReadonlyMap<string, string> => useSyncExternalStore(
    localCollectionCovers.subscribe,
    localCollectionCovers.getSnapshot,
    localCollectionCovers.getSnapshot,
);
