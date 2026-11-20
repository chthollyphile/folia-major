import { useCallback, useRef, useState } from 'react';
import i18n from '../../i18n/config';
import type { ProviderCollection } from '../../types/onlineMusic';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import type { LibraryHomeOpenCollection } from '../core/home/homeModel.contract';
import { buildOnlinePlaylistCards } from '../core/home/homeCards';
import { createLibraryHomeActions } from '../core/home/libraryHomeActions.service';
import { createLibraryHomePort } from './createLibraryHomePort';

// 探索墙使用与首页相同的集合动作：命名电台直接连续播放，日推和普通集合交给集合宿主。

export const useExploreCollectionAction = (surface: HomeSurfaceProps, open: LibraryHomeOpenCollection) => {
    const latest = useRef({ surface, open });
    latest.current = { surface, open };
    const [actions] = useState(() => createLibraryHomeActions(createLibraryHomePort(() => latest.current.surface)));

    return useCallback((collection: ProviderCollection) => {
        const card = buildOnlinePlaylistCards([collection], i18n.t)[0];
        void actions.openOnlineCard(card, collection.providerId, latest.current.open);
    }, [actions]);
};
