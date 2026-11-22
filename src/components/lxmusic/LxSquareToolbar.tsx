import { useEffect, useRef, useState } from 'react';
import {
    getSquareFilter,
    setSquareFilter,
    subscribeSquareCollections,
    type LxSquareFilter,
} from '../../services/onlineMusic/lxmusic/lxSquareCollections';
import {
    lxApiPlaylistTags,
    type LxPublicPlatform,
    type LxSquareTagCatalog,
} from '../../services/onlineMusic/lxmusic/lxFacade';
import { LxPlatformPicker } from './LxPlatformPicker';
import { LxCategoryPicker } from './LxCategoryPicker';

// src/components/lxmusic/LxSquareToolbar.tsx
// 首页「歌单」页签在洛雪下的筛选条。
//
// 平台不再铺成一整排胶囊：那一排会把歌单卡片流往下压，五颗挤在一起看着乱。
// 现在第一行只留一颗「当前平台」胶囊（LxPlatformPicker），点开在浮层里选四家，
// 含「全部平台」= 四家混排；下面两行才是洛雪官方那套「一层一层点进去」：
//   · 选到某一家，它的分类组（热门标签 / 语种 / 风格 …）与组里的标签收进第二颗胶囊：
//     跟平台胶囊并排、同高，平时只显示「组 · 当前标签」，点开才铺开整棵目录，
//     两层目录都在这一个浮层里点完，页面高度一格不占（两行芯片原来会把卡流往下压）。
//
// 分类组与标签都来自那家自己的分类目录接口，不是写死的文案：
// 见 lxmusicTransport 的 lxApiPlaylistTags —— 拿到的 id 直接就是该家「按标签取歌单」的参数。

const PLATFORM_KEYS: ReadonlyArray<LxPublicPlatform | 'all'> = ['all', 'wy', 'tx', 'kg', 'kw'];

/** 标签目录每家只拉一次；空目录不缓存，下次进来还有机会重试。 */
const catalogCache = new Map<LxPublicPlatform, Promise<LxSquareTagCatalog>>();

const loadCatalog = (platform: LxPublicPlatform): Promise<LxSquareTagCatalog> => {
    const cached = catalogCache.get(platform);
    if (cached) return cached;
    const promise = lxApiPlaylistTags(platform)
        .then((catalog) => {
            if (catalog.hot.length === 0 && catalog.groups.length === 0) catalogCache.delete(platform);
            return catalog;
        })
        .catch((error) => {
            catalogCache.delete(platform);
            console.warn('[lxmusic] 分类标签加载失败：', error);
            return { hot: [], groups: [] };
        });
    catalogCache.set(platform, promise);
    return promise;
};

export const LxSquareToolbar = ({ isDaylight = false }: { isDaylight?: boolean }) => {
    const [filter, setLocalFilter] = useState<LxSquareFilter>(() => getSquareFilter());
    const [catalog, setCatalog] = useState<LxSquareTagCatalog | null>(null);
    const [groupTitle, setGroupTitle] = useState('');
    const platform = filter.platform;
    const lastPlatform = useRef(platform);

    useEffect(() => subscribeSquareCollections(() => {
        setLocalFilter(getSquareFilter());
    }), []);

    useEffect(() => {
        // 换一家平台，之前停在哪一组就不作数了：从这家自己的第一组重新开始。
        if (lastPlatform.current !== platform) {
            lastPlatform.current = platform;
            setGroupTitle('');
        }
        if (platform === 'all') {
            setCatalog(null);
            return;
        }
        let alive = true;
        setCatalog(null);
        void loadCatalog(platform).then((next) => {
            if (alive) setCatalog(next);
        });
        return () => { alive = false; };
    }, [platform]);

    // 热门标签排在第一组，后面跟那家的分组。空组不占位。
    const groups = catalog
        ? [
            { title: '热门标签', tags: catalog.hot },
            ...catalog.groups,
        ].filter((group) => group.tags.length > 0)
        : [];

    // 不额外记「当前组是否已存在」：换了平台就清空，渲染时再兜底到第一组。
    const activeGroup = groups.find((group) => group.title === groupTitle) ?? groups[0] ?? null;

    // 「全部平台」没有单一分类目录，第二颗胶囊就不出现，只留平台那行。
    const showCategory = platform !== 'all' && groups.length > 0;

    return (
        <div className="w-full flex flex-col gap-0.5 pt-0.5" data-lx-square-toolbar>
            <LxPlatformPicker
                keys={PLATFORM_KEYS}
                value={platform}
                onSelect={(key) => setSquareFilter({ platform: key as LxSquareFilter['platform'] })}
                isDaylight={isDaylight}
                trailing={showCategory ? (
                    <LxCategoryPicker
                        groups={groups}
                        groupTitle={activeGroup?.title ?? ''}
                        tagId={filter.tagId}
                        onSelectGroup={(title) => {
                            // 换组就是换一份标签表：上一组的标签 id 在新组里不存在，顺手退回「全部」。
                            setGroupTitle(title);
                            if (filter.tagId) setSquareFilter({ tagId: '' });
                        }}
                        onSelectTag={(tagId) => setSquareFilter({ tagId })}
                        isDaylight={isDaylight}
                    />
                ) : undefined}
            />
            {platform !== 'all' && catalog === null && (
                <div className="text-[11px] opacity-40 text-center py-2">正在读取分类…</div>
            )}
            {platform !== 'all' && catalog !== null && groups.length === 0 && (
                <div className="text-[11px] opacity-40 text-center py-2">这家暂时没有分类目录</div>
            )}
        </div>
    );
};

export default LxSquareToolbar;
