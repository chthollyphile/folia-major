import { useEffect, useState } from 'react';
import {
    LX_PUBLIC_PLATFORM_KEYS,
    LX_PUBLIC_PLATFORMS,
    lxApiCharts,
    type LxApiChart,
    type LxPublicPlatform,
} from '../../../../../services/onlineMusic/lxmusic/lxFacade';
import { useLxWorkspaceStore } from '../../../../../stores/useLxWorkspaceStore';
import { Grid3DSlider, type Grid3DSliderItem } from '../Grid3DSlider';
import { LxPlatformPicker, type LxPlatformKey } from '../../../../../components/lxmusic/LxPlatformPicker';

// src/library/suites/grid/home/lx/LxChartBoard.tsx
// 首页「推荐」页签在洛雪下的形态：洛雪的排行榜。
//
// 卡片流跟歌单页是同一套东西——直接复用首页那个 Grid3DSlider（居中那张放大、两侧渐小变暗、
// 一样的卡大小、一样的滑动惯性），不再自己维护一条导轨。差别只在数据：
//   · 第一行只有一颗「当前平台」胶囊，点开在浮层里选四家（不再铺成一整排）；
//   · 点某一家，这条卡流换成那家的榜单海报卡（封面 + 榜名 + 平台）；
//   · 点榜单直接进那一屏的曲目，走的是 Folia 自己的集合页，不跳洛雪工作台
//     （工作台是另一套界面，点一下像换了个软件，用户明确否掉了）。
//
// 榜单清单不是写死的几条：每家都是该家自己的目录接口（网易云/酷我是固定榜表，
// QQ/酷狗直接读它们的榜单目录），四家合计一百多个榜，见 lxmusicTransport 的 lxApiCharts。

export type LxChartTarget = { platform: LxPublicPlatform; id: string; name: string; coverUrl?: string };

const PLATFORM_KEYS: ReadonlyArray<LxPlatformKey> = ['all', ...LX_PUBLIC_PLATFORM_KEYS];

const platformLabel = (key: LxPublicPlatform): string => (
    LX_PUBLIC_PLATFORMS.find((item) => item.key === key)?.label ?? key
);

/** 榜单目录十分钟内不重复拉：来回切页签不该每次都打一遍四家接口。 */
const CACHE_TTL = 10 * 60 * 1000;
const chartCache = new Map<LxPublicPlatform, { at: number; items: LxApiChart[] }>();

const loadCharts = async (platform: LxPublicPlatform): Promise<LxApiChart[]> => {
    const cached = chartCache.get(platform);
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.items;
    try {
        const items = await lxApiCharts(platform);
        if (items.length > 0) chartCache.set(platform, { at: Date.now(), items });
        return items;
    } catch (error) {
        console.warn('[lxmusic] 榜单目录拉取失败：', platform, error);
        return cached?.items ?? [];
    }
};

/**
 * 网易云与酷我这两家的榜表是写死的 id+名字，平台不给封面。
 * 没有封面就只用文字卡片，一屏看过去全是灰方块，跟首页那排卡片差得远。
 * 这里按榜名散列出一张纯渐变的唱片底图（data URI 不走网络、不进封面缓存），
 * 每个榜颜色都不一样，四家混排时也能一眼分清。
 */
const hashText = (text: string): number => {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 31 + text.charCodeAt(index)) % 1000003;
    }
    return hash;
};

const chartCoverUrl = (chart: LxApiChart): string | undefined => {
    if (chart.coverUrl) return chart.coverUrl;
    const hue = hashText(`${chart.platform}:${chart.name}`) % 360;
    const second = (hue + 44) % 360;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">'
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue},58%,44%)"/>`
        + `<stop offset="100%" stop-color="hsl(${second},52%,16%)"/></linearGradient></defs>`
        + '<rect width="320" height="320" fill="url(#g)"/>'
        + '<circle cx="268" cy="52" r="132" fill="rgba(255,255,255,0.07)"/>'
        + '<circle cx="160" cy="160" r="86" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="10"/>'
        + '<circle cx="160" cy="160" r="30" fill="rgba(255,255,255,0.22)"/>'
        + '</svg>';
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

type ChartGroup = { platform: LxPublicPlatform; items: LxApiChart[] };

interface LxChartBoardProps {
    /** 点榜单之后去哪：由首页交给 Folia 自己的集合页（album/playlist/chart 那套路由）。 */
    onOpenChart?: (chart: LxChartTarget) => void;
    /** 日间/夜间：跟首页同一个主题，卡面与平台胶囊都靠它取色。 */
    isDaylight?: boolean;
    hasFloatingPlayer?: boolean;
    isInteractive?: boolean;
}

export const LxChartBoard = ({
    onOpenChart,
    isDaylight = false,
    hasFloatingPlayer = false,
    isInteractive = true,
}: LxChartBoardProps) => {
    // 照洛雪那套层级：先选平台，再一条卡流看这家的榜单。
    // 默认落在「全部平台」，进来就有一条能滑的榜单卡流，而不是一片空白等人点。
    const [platform, setPlatform] = useState<LxPlatformKey>('all');
    const [groups, setGroups] = useState<ChartGroup[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(0);

    useEffect(() => {
        let alive = true;
        setGroups(null);
        setFailed(false);
        // 换了平台就是换了一条卡流：焦点回到正中第一张，别停在上一家的第 12 个榜。
        setFocusedIndex(0);
        const targets = platform === 'all' ? [...LX_PUBLIC_PLATFORM_KEYS] : [platform];
        void Promise.all(targets.map(async (key) => ({ platform: key, items: await loadCharts(key) })))
            .then((result) => {
                if (!alive) return;
                const kept = result.filter((group) => group.items.length > 0);
                setGroups(kept);
                setFailed(kept.length === 0);
            });
        return () => { alive = false; };
    }, [platform]);

    const openChart = (key: LxPublicPlatform, item: LxApiChart): void => {
        if (onOpenChart) {
            onOpenChart({ platform: key, id: item.id, name: item.name, coverUrl: chartCoverUrl(item) });
            return;
        }
        // 兜底：没有集合页可去时仍然落到工作台，至少不是点了没反应。
        useLxWorkspaceStore.getState().open('chart', { platform: key, chartId: item.id });
    };

    // 一条卡流装完：选一家就是这家的榜，选「全部平台」就是四家混排这一条。
    // 不再分平台立小标题、叠好几条卡流——那是自造的层级，官方是点一家看一家。
    const items: Grid3DSliderItem[] = (groups ?? []).flatMap((group) => group.items.map((item) => ({
        id: `${group.platform}:${item.id}`,
        name: item.name,
        description: platformLabel(group.platform),
        coverUrl: chartCoverUrl(item),
    })));

    const openByKey = (key: string): void => {
        const parts = key.split(':');
        const group = (groups ?? []).find((entry) => entry.platform === parts[0]);
        const item = group?.items.find((entry) => entry.id === parts.slice(1).join(':'));
        if (group && item) openChart(group.platform, item);
    };

    return (
        <div className="w-full h-full flex-1 flex flex-col min-h-0" data-lx-chart-board>
            <div className="shrink-0 pt-1">
                <LxPlatformPicker
                    keys={PLATFORM_KEYS}
                    value={platform}
                    onSelect={(key) => setPlatform(key)}
                    isDaylight={isDaylight}
                />
            </div>
            <Grid3DSlider
                key={platform}
                items={items}
                focusedIndex={focusedIndex}
                onFocusedIndexChange={setFocusedIndex}
                onSelect={(item) => openByKey(String(item.id))}
                isInteractive={isInteractive}
                isLoading={groups === null}
                emptyMessage={failed ? '榜单没取到，稍后再试。' : '这家暂时没有榜单目录'}
                isDaylight={isDaylight}
                hasFloatingPlayer={hasFloatingPlayer}
            />
        </div>
    );
};

export default LxChartBoard;
