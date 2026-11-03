import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryArtistLocalLibrary, LibraryArtistResource } from './artist.contract';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import { createArtistResource } from './artistResource.service';
import { createArtistResourceDeps } from './artistResourceDeps.service';
import { artistResourceRegistry } from './artistResourceRegistry.service';

// src/library/core/artist/useArtistResource.ts
// 宿主用：为当前打开的歌手页拿到歌手资源并持有它（与 useCollectionResource 同一套做法）。渲染期只 peek / 创建
// 对象，effect 里 retain 与 ensure；宿主自己不订阅快照（专辑分页到达不会让首页这棵大树重渲染），suite 经
// useArtistResourceState 订阅。本地歌手的 catalog 与歌曲每次变化都交给资源（资源按引用去重、同步重算）。

type UseArtistResourceParams = {
    /** 资源的身份（宿主用导航栈里那一层的 collectionKey；本地描述的 id 会在 catalog 就绪后被改写，不能拿它算）。 */
    key: string | null;
    /** 当前的歌手描述（非歌手时传 null）。 */
    descriptor: LibraryCollectionDescriptor | null;
    local: LibraryArtistLocalLibrary;
};

export const useArtistResource = ({ key, descriptor, local }: UseArtistResourceParams): LibraryArtistResource | null => {
    const { t } = useTranslation();
    // 资源被 registry 回收时（例如长时间只 peek 未 retain），换一代重新拿。
    const [peekEpoch, setPeekEpoch] = useState(0);
    const active = Boolean(key && descriptor);

    const resource = useMemo(() => {
        if (!key || !descriptor) return null;
        return artistResourceRegistry.peekOrCreate(key, descriptor, () => (
            createArtistResource(key, descriptor, createArtistResourceDeps(t))
        ));
        // descriptor / t 不进依赖：同一个 key 下的描述变化由 ensure 处理；翻译函数在调用时读当前语言。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, active, peekEpoch]);

    useEffect(() => {
        if (!resource) return;
        const release = artistResourceRegistry.retain(resource);
        if (!release) {
            setPeekEpoch(epoch => epoch + 1);
            return;
        }
        return release;
    }, [resource]);

    useEffect(() => {
        if (resource && descriptor) resource.ensure(descriptor, local);
    }, [descriptor, local, resource]);

    return resource;
};
